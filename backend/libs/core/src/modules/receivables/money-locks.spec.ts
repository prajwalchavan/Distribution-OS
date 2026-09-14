import { sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { businessDate, uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  featureFlags,
  memberships,
  retailers,
  tenants,
  users,
} from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { BillingModule } from '../billing/index.js'
import { DeliveryModule } from '../delivery/index.js'
import { FilesModule } from '../files/index.js'
import { InventoryModule } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { SyncModule } from '../sync/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { ReceivablesModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/** The one sentence every door answers for money that reaches the office after its trip settled (DOS-169 (l)). */
const TRIP_SETTLED =
  'this trip has already settled; hand this money to the cashier and record it at the office, not on the trip'

interface Refusal {
  message: string
  data?: { code?: string; tripId?: string }
}
interface UploadReply {
  accepted: number
  replayed: number
  rejected: { opId: string; code: string; messageEn: string }[]
}
interface SettleReply {
  tripState?: string
  message?: string
  data?: { code?: string }
}

/**
 * A receipt moves once (QA DOS-168, DOS-169, DOS-170). Banking, undoing and counting a receipt each hold its
 * row `FOR UPDATE` and read the trip's state only under that lock; a receipt for a trip that has already
 * handed its cash over is refused at every door. The races are forced, never hoped for: a third connection
 * holds the receipt row while both desks' requests queue behind it, `pg_stat_activity` shows them waiting,
 * and only then is the row let go.
 */
describeDb('receivables — a receipt moves once (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const driverId = uuidv7()
  const shopId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }

  let app: NestFastifyApplication
  let chequeNo = 780_000

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `ml-${run}`, legalName: 'Money Lock Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91978${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91978${run}2`, name: 'Manager desk' },
      { id: accountantId, phone: `+91978${run}3`, name: 'Accountant desk' },
      { id: driverId, phone: `+91978${run}4`, name: 'Driver' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
    ])
    await bootstrapTenant(db, tenantId)
    await db
      .insert(featureFlags)
      .values({ tenantId, flag: 'van_sales', enabled: true })
      .onConflictDoUpdate({
        target: [featureFlags.tenantId, featureFlags.flag],
        set: { enabled: true },
      })
    await db.insert(retailers).values({
      id: shopId,
      tenantId,
      code: `ML-${run}`,
      name: `Money lock shop ${run}`,
      phone: `+9197${run}8`,
      stateCode: '27',
      tier: 'C',
      creditDays: 15,
    })
    app = await bootTestApp([
      DeliveryModule,
      WarehouseModule,
      BillingModule,
      OrdersModule,
      InventoryModule,
      ReceivablesModule,
      FilesModule,
      SyncModule,
    ])
    const consent = await call(app, driver, 'POST', '/delivery/consents', {
      idempotencyKey: `ml-consent-${run}`,
      id: uuidv7(),
      granted: true,
      noticeVersion: 'gps-2026-09',
    })
    expect(consent.status).toBe(200)
  })

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  // ---------------------------------------------------------------------------------------------------------------
  // helpers: money on the desk, the books, and the forced interleaving

  /** A receipt the desk records at the office, with no trip: cash, or a cheque with its number and bank. */
  const officeReceipt = async (
    mode: 'cash' | 'cheque',
    amountPaise: number,
  ): Promise<{ id: string; receiptNo: string }> => {
    const id = uuidv7()
    chequeNo += 1
    const res = await call<{ item: { receiptNo: string | null; tripId: string | null } }>(
      app,
      accountant,
      'POST',
      '/receipts',
      {
        idempotencyKey: `ml-rcpt-${id}`,
        id,
        retailerId: shopId,
        mode,
        amountPaise,
        ...(mode === 'cheque'
          ? { reference: String(chequeNo), bankName: 'Bank of Maharashtra' }
          : {}),
      },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.item.tripId).toBeNull()
    return { id, receiptNo: res.body.item.receiptNo ?? id }
  }

  const deposit = (actor: Actor, batchId: string, receiptIds: string[], depositRef: string) =>
    call<Refusal & { updated?: number; totalPaise?: number }>(
      app,
      actor,
      'POST',
      '/receipts/deposit',
      {
        idempotencyKey: `ml-dep-${batchId}`,
        id: batchId,
        receiptIds,
        depositedAt: new Date().toISOString(),
        depositRef,
      },
    )

  /** Net per account over the named journal entries; accounts that net to zero are left out. */
  const accountNet = async (
    refs: readonly (readonly [refType: string, refId: string])[],
  ): Promise<Record<string, number>> => {
    const which = sql.join(
      refs.map(([refType, refId]) => sql`(e.ref_type = ${refType} and e.ref_id = ${refId})`),
      sql` or `,
    )
    const rows = (
      await db.execute(sql`
        select a.code, sum(l.amount_paise)::bigint as amount
          from journal_lines l
          join journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
          join accounts a on a.id = l.account_id
         where e.tenant_id = ${tenantId} and (${which})
         group by a.code`)
    ).rows as { code: string; amount: string }[]
    return Object.fromEntries(
      rows.map((r) => [r.code, Number(r.amount)] as const).filter(([, amount]) => amount !== 0),
    )
  }

  const entryCount = async (refType: string, refIds: readonly string[]): Promise<number> => {
    const ids = sql.join(
      refIds.map((id) => sql`${id}`),
      sql`, `,
    )
    const [row] = (
      await db.execute(sql`
        select count(*)::int as n from journal_entries
         where tenant_id = ${tenantId} and ref_type = ${refType} and ref_id in (${ids})`)
    ).rows as { n: number }[]
    return row?.n ?? 0
  }

  /** Entries among the named ones whose lines do not add up to zero (the commit trigger should make this empty). */
  const unbalanced = async (
    refs: readonly (readonly [refType: string, refId: string])[],
  ): Promise<string[]> => {
    const which = sql.join(
      refs.map(([refType, refId]) => sql`(e.ref_type = ${refType} and e.ref_id = ${refId})`),
      sql` or `,
    )
    return (
      (
        await db.execute(sql`
          select e.id from journal_entries e
            join journal_lines l on l.entry_id = e.id and l.tenant_id = e.tenant_id
           where e.tenant_id = ${tenantId} and (${which})
           group by e.id having sum(l.amount_paise) <> 0`)
      ).rows as { id: string }[]
    ).map((r) => r.id)
  }

  const depositedEvents = async (receiptId: string): Promise<number> => {
    const [row] = (
      await db.execute(sql`
        select count(*)::int as n from outbox_events
         where tenant_id = ${tenantId} and aggregate_id = ${receiptId} and event_type = 'ChequeDeposited'`)
    ).rows as { n: number }[]
    return row?.n ?? 0
  }

  const receiptRow = async (
    id: string,
  ): Promise<{ status: string; deposit_ref: string | null } | undefined> =>
    (
      (
        await db.execute(
          sql`select status::text as status, deposit_ref from receipts where tenant_id = ${tenantId} and id = ${id}`,
        )
      ).rows as { status: string; deposit_ref: string | null }[]
    )[0]

  /**
   * A third connection takes the receipt rows `FOR UPDATE` and keeps them until the returned function commits.
   * The function is safe to call twice, so a `finally` can always let go.
   */
  const holdRows = async (ids: readonly string[]): Promise<() => Promise<void>> => {
    const client = await pool.connect()
    let open = true
    await client.query('begin')
    await client.query(
      'select id from receipts where tenant_id = $1 and id = any($2::text[]) order by id for update',
      [tenantId, ids],
    )
    return async () => {
      if (!open) return
      open = false
      try {
        await client.query('commit')
      } finally {
        client.release()
      }
    }
  }

  /** Backends of THIS database waiting on a heavyweight lock right now (autocommit: a fresh snapshot per read). */
  const lockWaiters = async (): Promise<number> => {
    const res = await pool.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    )
    return res.rows[0]?.n ?? 0
  }

  const until = async (what: string, ready: () => Promise<boolean>): Promise<void> => {
    const deadline = Date.now() + 15_000
    while (!(await ready())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  /**
   * A planned trip with no stops and van sales on, the DOS-112 `closingTrip` shape. Each trip has a vehicle and a
   * date of its own, so the one-open-trip-per-driver-per-date rule never meets another test's.
   */
  const plannedTrip = async (
    label: string,
    daysAhead: number,
    plate: string,
    openingCashPaise: number,
  ): Promise<string> => {
    const vehicleId = uuidv7()
    const vehicle = await call(app, owner, 'POST', '/delivery/vehicles', {
      idempotencyKey: `${label}-vehicle-${run}`,
      id: vehicleId,
      regNo: `MH-05-${plate}-${run.slice(-4)}`,
      name: `Tempo ${plate}`,
    })
    expect(vehicle.status, JSON.stringify(vehicle.body)).toBe(200)
    const tripId = uuidv7()
    const today = businessDate().date
    const planned = await call(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `${label}-trip-${run}`,
      id: tripId,
      tripDate: new Date(Date.parse(today) + daysAhead * 86_400_000).toISOString().slice(0, 10),
      vehicleId,
      driverId,
      vanSalesEnabled: true,
      openingCashPaise,
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    return tripId
  }

  /**
   * That trip on the road (planned → loading → active): nothing is billed or loaded, so it survives DOS-172's
   * depart gate (design Step 5).
   */
  const tripOnTheRoad = async (
    label: string,
    daysAhead: number,
    plate: string,
    openingCashPaise: number,
  ): Promise<string> => {
    const tripId = await plannedTrip(label, daysAhead, plate, openingCashPaise)
    for (const step of ['start-loading', 'depart']) {
      const moved = await call(app, driver, 'POST', `/delivery/trips/${tripId}/${step}`, {
        idempotencyKey: `${label}-${step}-${run}`,
      })
      expect(moved.status, `${step} → ${JSON.stringify(moved.body)}`).toBe(200)
    }
    return tripId
  }

  const returnTrip = async (label: string, tripId: string): Promise<void> => {
    const returned = await call(app, driver, 'POST', `/delivery/trips/${tripId}/return`, {
      idempotencyKey: `${label}-return-${run}`,
    })
    expect(returned.status, JSON.stringify(returned.body)).toBe(200)
  }

  const settle = (
    actor: Actor,
    tripId: string,
    settlementId: string,
    handedOverCashPaise: number,
    extra: Record<string, unknown> = {},
  ) =>
    call<SettleReply>(app, actor, 'POST', `/delivery/trips/${tripId}/settle`, {
      idempotencyKey: `settle-${settlementId}`,
      id: settlementId,
      tripId,
      handedOverCashPaise,
      ...extra,
    })

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-168: two desks bank the same money

  it('DOS-168 two desks banking the same receipt at the same moment: one 200, one 409, one deposit entry, one event', async () => {
    const amountPaise = 10_000
    for (const mode of ['cash', 'cheque'] as const) {
      const receipt = await officeReceipt(mode, amountPaise)
      const batchA = uuidv7()
      const batchB = uuidv7()
      const refA = `DEP-A-${mode}-${run}`
      const refB = `DEP-B-${mode}-${run}`
      const release = await holdRows([receipt.id])
      let replies: Awaited<ReturnType<typeof deposit>>[]
      try {
        const accountantBanks = deposit(accountant, batchA, [receipt.id], refA)
        const managerBanks = deposit(manager, batchB, [receipt.id], refB)
        await until(
          `both desks to wait on the ${mode} receipt row`,
          async () => (await lockWaiters()) >= 2,
        )
        await release()
        replies = await Promise.all([accountantBanks, managerBanks])
      } finally {
        await release()
      }
      const [a, b] = replies
      expect(
        [a?.status, b?.status].sort(),
        `${mode}: ${JSON.stringify([a?.body, b?.body])}`,
      ).toEqual([200, 409])
      const loser = a?.status === 409 ? a : b
      expect(loser?.body.message).toBe(`receipt ${receipt.receiptNo} is deposited, not collected`)
      expect(await entryCount('deposit', [batchA, batchB])).toBe(1)
      const source = mode === 'cash' ? 'CASH' : 'CHEQUES'
      expect(
        await accountNet([
          ['deposit', batchA],
          ['deposit', batchB],
        ]),
      ).toEqual({ BANK: amountPaise, [source]: -amountPaise })
      expect(await depositedEvents(receipt.id)).toBe(1)
      expect(await receiptRow(receipt.id)).toEqual({
        status: 'deposited',
        deposit_ref: a?.status === 200 ? refA : refB,
      })
    }
  }, 60_000)

  it('DOS-168 overlapping batches lock in one order: no deadlock, the loser is refused whole', async () => {
    const amountPaise = 10_000
    const taken = [
      await officeReceipt('cash', amountPaise),
      await officeReceipt('cash', amountPaise),
      await officeReceipt('cash', amountPaise),
    ].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
    const [r1, r2, r3] = taken as [(typeof taken)[0], (typeof taken)[0], (typeof taken)[0]]
    const batchA = uuidv7()
    const batchB = uuidv7()
    const release = await holdRows([r2.id])
    let replies: Awaited<ReturnType<typeof deposit>>[]
    try {
      const first = deposit(accountant, batchA, [r1.id, r2.id], `DEP-12-${run}`)
      const second = deposit(manager, batchB, [r2.id, r3.id], `DEP-23-${run}`)
      await until(
        'both batches to wait on the shared receipt',
        async () => (await lockWaiters()) >= 2,
      )
      await release()
      replies = await Promise.all([first, second])
    } finally {
      await release()
    }
    const [a, b] = replies
    // a deadlock (40P01) would surface as a 500 on one side, never as this pair
    expect([a?.status, b?.status].sort(), JSON.stringify([a?.body, b?.body])).toEqual([200, 409])
    const firstWon = a?.status === 200
    expect((firstWon ? b : a)?.body.message).toBe(
      `receipt ${r2.receiptNo} is deposited, not collected`,
    )
    // the shared receipt and the winner's other receipt are banked once; the loser's other receipt is untouched
    expect(await entryCount('deposit', [batchA, batchB])).toBe(1)
    expect(
      await accountNet([
        ['deposit', batchA],
        ['deposit', batchB],
      ]),
    ).toEqual({ BANK: 2 * amountPaise, CASH: -2 * amountPaise })
    const winnersOther = firstWon ? r1 : r3
    const losersOther = firstWon ? r3 : r1
    expect((await receiptRow(r2.id))?.status).toBe('deposited')
    expect((await receiptRow(winnersOther.id))?.status).toBe('deposited')
    expect(await receiptRow(losersOther.id)).toEqual({ status: 'collected', deposit_ref: null })
    expect(await depositedEvents(r2.id)).toBe(1)
    expect(await depositedEvents(winnersOther.id)).toBe(1)
    expect(await depositedEvents(losersOther.id)).toBe(0)
  }, 60_000)

  it('DOS-168/170 a reversal racing a deposit on the same receipt: whichever commits second sees the other', async () => {
    const amountPaise = 10_000
    const receipt = await officeReceipt('cash', amountPaise)
    const batch = uuidv7()
    const reversalId = uuidv7()
    const release = await holdRows([receipt.id])
    let banked: Awaited<ReturnType<typeof deposit>>
    let undone: { status: number; body: unknown }
    try {
      const banking = deposit(accountant, batch, [receipt.id], `DEP-REV-${run}`)
      const undoing = call(app, manager, 'POST', `/receipts/${receipt.id}/reverse`, {
        idempotencyKey: `ml-rev-${reversalId}`,
        id: receipt.id,
        reversalId,
        reason: 'entered against the wrong shop',
      })
      await until(
        'the deposit and the reversal to wait on the receipt row',
        async () => (await lockWaiters()) >= 2,
      )
      await release()
      ;[banked, undone] = await Promise.all([banking, undoing])
    } finally {
      await release()
    }
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    const reversal = await accountNet([['receipt_reversal', reversalId]])
    if (banked.status === 200) {
      // the deposit committed first: the undo found the money in the bank and takes it from there
      expect(reversal).toEqual({ AR: amountPaise, BANK: -amountPaise })
      expect(await accountNet([['deposit', batch]])).toEqual({
        BANK: amountPaise,
        CASH: -amountPaise,
      })
    } else {
      // the undo committed first: the deposit re-reads a cancelled receipt and banks nothing
      expect(banked.status, JSON.stringify(banked.body)).toBe(409)
      expect(banked.body.message).toBe(`receipt ${receipt.receiptNo} is cancelled, not collected`)
      expect(reversal).toEqual({ AR: amountPaise, CASH: -amountPaise })
      expect(await entryCount('deposit', [batch])).toBe(0)
    }
    // either way the money moved once: taken, then banked or undone, never both a CASH undo and a deposit
    expect(
      await accountNet([
        ['receipt', receipt.id],
        ['deposit', batch],
        ['receipt_reversal', reversalId],
      ]),
    ).toEqual({})
  }, 60_000)

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-169: money for a trip that has already handed its cash over

  it('DOS-169 a receipt for a settled trip is refused trip_settled at every door and posts nothing', async () => {
    const floatPaise = 50_000
    const tripId = await tripOnTheRoad('ml-t4', 11, 'TA', floatPaise)
    await returnTrip('ml-t4', tripId)
    const settled = await settle(accountant, tripId, uuidv7(), floatPaise)
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    expect(settled.body.tripState).toBe('settled')

    const receiptExists = async (id: string): Promise<boolean> =>
      (await receiptRow(id)) !== undefined

    // the desk, POST /receipts: cash and a cheque naming the settled trip are refused and nothing is written
    for (const mode of ['cash', 'cheque'] as const) {
      const id = uuidv7()
      chequeNo += 1
      const refused = await call<Refusal>(app, accountant, 'POST', '/receipts', {
        idempotencyKey: `ml-t4-desk-${id}`,
        id,
        retailerId: shopId,
        mode,
        amountPaise: 7_000,
        tripId,
        ...(mode === 'cheque' ? { reference: String(chequeNo), bankName: 'Bank of Baroda' } : {}),
      })
      expect(refused.status, `${mode}: ${JSON.stringify(refused.body)}`).toBe(409)
      expect(refused.body.data?.code).toBe('trip_settled')
      expect(refused.body.data?.tripId).toBe(tripId)
      expect(refused.body.message).toBe(TRIP_SETTLED)
      expect(await receiptExists(id)).toBe(false)
      expect(await entryCount('receipt', [id])).toBe(0)
    }

    // the phone, POST /sync/upload: the `receipts` op a doorstep payment queues with no signal
    const deviceId = `ml-t4-phone-${run}`
    const at = new Date().toISOString()
    const receiptOp = (mode: 'cash' | 'upi', book: string) => ({
      opId: uuidv7(),
      op: 'PUT',
      table: 'receipts',
      id: uuidv7(),
      data: {
        retailer_id: shopId,
        trip_id: tripId,
        mode,
        amount_paise: 7_000,
        received_at: at,
        received_by: driverId,
        device_id: deviceId,
        status: 'collected',
        client_receipt_no: `${book}-${run}`,
        ...(mode === 'upi' ? { reference: `UTR${run}` } : {}),
      },
      clientTime: at,
    })
    const cashOp = receiptOp('cash', 'T4C')
    const upload = (ops: unknown[]) =>
      call<UploadReply>(app, driver, 'POST', '/sync/upload', { protocol: 1, deviceId, ops })
    const syncErrorsOf = async (opId: string) =>
      (
        await db.execute(
          sql`select code, message_en from sync_errors where tenant_id = ${tenantId} and op_id = ${opId}`,
        )
      ).rows as { code: string; message_en: string }[]

    const first = await upload([cashOp])
    expect(first.status).toBe(200)
    expect(first.body.accepted, JSON.stringify(first.body)).toBe(0)
    expect(first.body.rejected.map((r) => [r.opId, r.code, r.messageEn])).toEqual([
      [cashOp.opId, 'trip_settled', TRIP_SETTLED],
    ])
    expect(await syncErrorsOf(cashOp.opId)).toEqual([
      { code: 'trip_settled', message_en: TRIP_SETTLED },
    ])
    expect(await receiptExists(cashOp.id)).toBe(false)
    expect(await entryCount('receipt', [cashOp.id])).toBe(0)

    // the same op again (the phone lost the response) replays the refusal and still writes nothing
    const again = await upload([cashOp])
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ accepted: 0, replayed: 1 })
    expect(again.body.rejected.map((r) => [r.opId, r.code, r.messageEn])).toEqual([
      [cashOp.opId, 'trip_settled', TRIP_SETTLED],
    ])
    expect(await syncErrorsOf(cashOp.opId)).toHaveLength(1)
    expect(await receiptExists(cashOp.id)).toBe(false)

    // founder answer A (2026-09-14): UPI and a bank transfer are already in the account, so they are accepted
    // after the settlement and post as today
    const upiOp = receiptOp('upi', 'T4U')
    const upi = await upload([upiOp])
    expect(upi.status).toBe(200)
    expect(upi.body, JSON.stringify(upi.body)).toMatchObject({ accepted: 1, rejected: [] })
    expect(await accountNet([['receipt', upiOp.id]])).toEqual({ UPI: 7_000, AR: -7_000 })
    const bankId = uuidv7()
    const bank = await call(app, accountant, 'POST', '/receipts', {
      idempotencyKey: `ml-t4-bank-${bankId}`,
      id: bankId,
      retailerId: shopId,
      mode: 'bank_transfer',
      amountPaise: 7_000,
      reference: `NEFT${run}`,
      tripId,
    })
    expect(bank.status, JSON.stringify(bank.body)).toBe(200)
    expect(await accountNet([['receipt', bankId]])).toEqual({ BANK: 7_000, AR: -7_000 })

    // The third door, a `collections` PUT (delivery.sync.ts, design Step 3): cash or a cheque naming the settled trip
    // is refused `trip_settled` in the same sentence as the two doors above, so is its replay, and nothing is written.
    const collectionOp = (onTripId: string, mode: 'cash' | 'cheque' | 'upi', book: string) => ({
      opId: uuidv7(),
      op: 'PUT',
      table: 'collections',
      id: uuidv7(),
      data: {
        receipt_id: uuidv7(),
        trip_id: onTripId,
        retailer_id: shopId,
        mode,
        amount_paise: 7_000,
        collected_at: at,
        device_id: deviceId,
        client_receipt_no: `${book}-${run}`,
        ...(mode === 'cash' ? {} : { reference: `${book}${run}` }),
        ...(mode === 'cheque'
          ? { bank_name: 'Bank of Baroda', cheque_date: businessDate().date }
          : {}),
      },
      clientTime: at,
    })
    const collectionExists = async (id: string): Promise<boolean> =>
      (
        await db.execute(
          sql`select 1 from collections where tenant_id = ${tenantId} and id = ${id}`,
        )
      ).rows.length > 0
    for (const mode of ['cash', 'cheque'] as const) {
      const collectionOnSettled = collectionOp(tripId, mode, mode === 'cash' ? 'T4K' : 'T4Q')
      for (const attempt of ['first', 'replay'] as const) {
        const sent = await upload([collectionOnSettled])
        expect(sent.status).toBe(200)
        expect(sent.body, `${mode} ${attempt}: ${JSON.stringify(sent.body)}`).toMatchObject({
          accepted: 0,
          replayed: attempt === 'first' ? 0 : 1,
        })
        expect(sent.body.rejected.map((r) => [r.opId, r.code, r.messageEn])).toEqual([
          [collectionOnSettled.opId, 'trip_settled', TRIP_SETTLED],
        ])
        expect(await syncErrorsOf(collectionOnSettled.opId)).toEqual([
          { code: 'trip_settled', message_en: TRIP_SETTLED },
        ])
        expect(await collectionExists(collectionOnSettled.id)).toBe(false)
        expect(await receiptExists(collectionOnSettled.data.receipt_id)).toBe(false)
        expect(await entryCount('receipt', [collectionOnSettled.data.receipt_id])).toBe(0)
      }
    }

    // UPI through this door is not money for the cashier (founder answer A): a phone's UPI after the settlement
    // reaches the office as the `receipts` op above, which accepts it. This door takes money only while the trip is
    // out, so a UPI collection on the settled trip still answers `trip_not_open` and writes nothing.
    const upiOnSettled = collectionOp(tripId, 'upi', 'T4V')
    const upiRefused = await upload([upiOnSettled])
    expect(upiRefused.status).toBe(200)
    expect(upiRefused.body.accepted, JSON.stringify(upiRefused.body)).toBe(0)
    expect(upiRefused.body.rejected.map((r) => [r.opId, r.code])).toEqual([
      [upiOnSettled.opId, 'trip_not_open'],
    ])
    expect(await collectionExists(upiOnSettled.id)).toBe(false)
    expect(await receiptExists(upiOnSettled.data.receipt_id)).toBe(false)

    // The control: the same op naming a trip that has not left yet is still `trip_not_open` (Step 3 refuses only a
    // trip that has handed its cash over), which also shows the op above passes the collection's input schema.
    const notLeftId = await plannedTrip('ml-t4p', 13, 'TC', floatPaise)
    const collectionOnPlanned = collectionOp(notLeftId, 'cash', 'T4P')
    const notOpen = await upload([collectionOnPlanned])
    expect(notOpen.status).toBe(200)
    expect(notOpen.body.accepted, JSON.stringify(notOpen.body)).toBe(0)
    expect(notOpen.body.rejected.map((r) => [r.opId, r.code])).toEqual([
      [collectionOnPlanned.opId, 'trip_not_open'],
    ])
    expect(await collectionExists(collectionOnPlanned.id)).toBe(false)
    expect(await receiptExists(collectionOnPlanned.data.receipt_id)).toBe(false)
  }, 120_000)

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-170: an undo racing the settlement of the trip that carries the money

  it('DOS-170 a reversal racing the settlement on the same trip: the loser sees the winner', async () => {
    const floatPaise = 50_000
    // above the default 10 000 paise tolerance, so an undo that wins leaves a real variance for the owner
    const cashPaise = 20_000
    const tripId = await tripOnTheRoad('ml-t10', 12, 'TB', floatPaise)
    const receiptId = uuidv7()
    const collected = await call(app, driver, 'POST', '/delivery/collections', {
      idempotencyKey: `ml-t10-collect-${run}`,
      id: uuidv7(),
      receiptId,
      tripId,
      retailerId: shopId,
      mode: 'cash',
      amountPaise: cashPaise,
    })
    expect(collected.status, JSON.stringify(collected.body)).toBe(200)
    await returnTrip('ml-t10', tripId)

    const settlementId = uuidv7()
    const reversalId = uuidv7()
    const release = await holdRows([receiptId])
    let settled: Awaited<ReturnType<typeof settle>>
    let undone: { status: number; body: unknown }
    try {
      let finished = 0
      const settling = settle(owner, tripId, settlementId, floatPaise + cashPaise, {
        acceptVariance: true,
        note: 'counted with the crew',
      }).finally(() => {
        finished += 1
      })
      const undoing = call(app, accountant, 'POST', `/receipts/${receiptId}/reverse`, {
        idempotencyKey: `ml-t10-rev-${reversalId}`,
        id: receiptId,
        reversalId,
        reason: 'the shop paid twice',
      }).finally(() => {
        finished += 1
      })
      // the undo always queues on the receipt row; the settlement either queues there too or has already finished
      await until(
        'the undo to wait on the receipt row beside the settlement',
        async () => (await lockWaiters()) + finished >= 2,
      )
      await release()
      ;[settled, undone] = await Promise.all([settling, undoing])
    } finally {
      await release()
    }
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(['settled', 'settled_with_variance']).toContain(settled.body.tripState)

    const refs = [
      ['receipt', receiptId],
      ['receipt_reversal', reversalId],
      ['trip_settlement', settlementId],
    ] as const
    const books = await accountNet(refs)
    // the van's cash is credited exactly once, by whichever of the two saw the money there
    expect(books.CASH_VAN ?? 0, JSON.stringify(books)).toBe(0)
    // whatever the office counted in, the undo or the variance takes back out
    expect((books.CASH ?? 0) + (books.CASH_SHORT ?? 0), JSON.stringify(books)).toBe(0)
    // taken and undone: the shop's account is where it was
    expect(books.AR ?? 0).toBe(0)
    expect((await accountNet([['receipt_reversal', reversalId]])).AR).toBe(cashPaise)
    expect(await unbalanced(refs)).toEqual([])
  }, 120_000)
})
