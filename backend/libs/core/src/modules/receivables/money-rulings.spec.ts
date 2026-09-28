import { sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { businessDate, financialYear, invoiceStateShown, uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  creditNotes,
  invoices,
  locations,
  memberships,
  retailers,
  tenants,
  trips,
  users,
  vehicles,
  withTenant,
  type ActorRole,
  type Db,
  type TenantContext,
} from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { TRIP_PREDICATES } from '../delivery/index.js'
import { SyncModule } from '../sync/index.js'
import { ReceivablesModule, ReceivablesService } from './index.js'

/**
 * The architect's rulings on money coming in (docs/22 §8, 2026-09-28, "money and credit" (1)–(3) and DOS-256),
 * each pinned by the QA money lane's own request (QA/findings/15-money.md):
 *
 *   DOS-310  a payment reference is used once — at the desk, at the crew's door and through the offline upload;
 *   DOS-311  money received after a write-off recovers the write-off first, booked against Bad debts;
 *   DOS-312  money on account is applied to the oldest open bills — at a receipt's remainder, a credit note on a
 *            paid bill, a new bill, and the desk's "Apply money on account";
 *   DOS-256  UPI receipts are confirmed at Day-end through the deposit's own movement, UPI clearing → Bank;
 *   DOS-320  a bill closed by credit notes alone reads "Credited".
 *
 * Every case ends on the identity the reconcile holds each shop to: open bills + bills on a van − money on account
 * = the shop's AR in the journal, and the trial balance at zero.
 */

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

function day(offset: number): string {
  const iso = businessDate().date
  const at = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  )
  const d = new Date(at + offset * 86_400_000)
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

type Receipt = {
  id: string
  receiptNo: string | null
  amountPaise: number
  allocatedPaise: number
  unallocatedPaise: number
  status: string
}
type Outstanding = { outstandingPaise: number; unallocatedCreditPaise: number; openBills: number }
type Recovery = {
  invoiceId: string
  invoiceNo: string | null
  writtenOffOn: string
  amountPaise: number
}
type ReceiptReply = {
  item: Receipt
  allocations: { id: string; invoiceId: string; amountPaise: number }[]
  invoices: { id: string; state: string; openPaise: number }[]
  unallocatedPaise: number
  outstanding: Outstanding
  recoveries?: Recovery[]
}
type Refusal = {
  message: string
  data?: {
    code?: string
    earlier?: { receiptNo: string | null; retailerName: string; amountPaise: number }
  }
}

describeDb('money coming in — the rulings of 2026-09-28 (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const fy = financialYear()

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const accountantId = uuidv7()
  const crewId = uuidv7()
  const vanId = uuidv7()
  const tripId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const crew: Actor = { tenantId, actorId: crewId, role: 'delivery' }

  let app: NestFastifyApplication
  let receivables: ReceivablesService
  let shopCount = 0
  let billCount = 0

  const ctxFor = (role: ActorRole, actorId: string): TenantContext => ({
    tenantId,
    actorId,
    actorRole: role,
  })
  const asOwner = <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
    const ctx = ctxFor('owner', ownerId)
    return tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
  }

  async function newShop(name: string): Promise<{ id: string; name: string }> {
    shopCount += 1
    const id = uuidv7()
    const full = `${name} ${run}`
    await db.insert(retailers).values({
      id,
      tenantId,
      code: `M${String(shopCount)}-${run}`,
      name: full,
      phone: `+9195${run}${String(shopCount).padStart(2, '0')}`,
      stateCode: '27',
      tier: 'C',
      creditDays: 15,
    })
    return { id, name: full }
  }

  /** A bill as billing hands it over at pack: the row, then `postInvoiceIssued` in the same way. */
  async function issueBill(
    retailerId: string,
    totalPaise: number,
    dueOffsetDays = 5,
  ): Promise<{ id: string; invoiceNo: string }> {
    billCount += 1
    const id = uuidv7()
    const invoiceNo = `MR/${run}/${String(billCount).padStart(3, '0')}`
    const dueDate = day(dueOffsetDays)
    const invoiceDate = day(dueOffsetDays - 15)
    await db.insert(invoices).values({
      id,
      tenantId,
      invoiceNo,
      seriesCode: 'INV',
      fy,
      invoiceDate,
      retailerId,
      state: 'issued',
      buyerName: `Shop ${run}`,
      placeOfSupplyState: '27',
      subtotalPaise: totalPaise,
      taxablePaise: totalPaise,
      totalPaise,
      dueDate,
    })
    await asOwner((tx) =>
      receivables.postInvoiceIssued(tx, {
        id,
        retailerId,
        invoiceDate,
        subtotalPaise: totalPaise,
        discountPaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        cessPaise: 0,
        roundOffPaise: 0,
        totalPaise,
        dueDate,
      }),
    )
    return { id, invoiceNo }
  }

  async function creditNote(
    invoiceId: string,
    retailerId: string,
    totalPaise: number,
  ): Promise<string> {
    const id = uuidv7()
    await db.insert(creditNotes).values({
      id,
      tenantId,
      creditNoteNo: `CN/${run}/${id.slice(-4)}`,
      seriesCode: 'CN',
      fy,
      noteDate: day(0),
      invoiceId,
      retailerId,
      reason: 'rate_difference',
      state: 'issued',
      taxablePaise: totalPaise,
      totalPaise,
    })
    await asOwner((tx) =>
      receivables.postCreditNoteIssued(tx, {
        id,
        invoiceId,
        retailerId,
        noteDate: day(0),
        taxablePaise: totalPaise,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        cessPaise: 0,
        roundOffPaise: 0,
        totalPaise,
      }),
    )
    return id
  }

  function pay(
    actor: Actor,
    retailerId: string,
    amountPaise: number,
    extra: Record<string, unknown> = {},
  ): Promise<{ status: number; body: ReceiptReply & Refusal }> {
    return call<ReceiptReply & Refusal>(app, actor, 'POST', '/receipts', {
      idempotencyKey: uuidv7(),
      id: uuidv7(),
      retailerId,
      mode: 'cash',
      amountPaise,
      ...extra,
    })
  }

  async function arBalance(retailerId: string): Promise<number> {
    const result = await db.execute(sql`
      select coalesce(sum(jl.amount_paise), 0) as ar
        from journal_lines jl join accounts a on a.id = jl.account_id
       where jl.tenant_id = ${tenantId} and a.code = 'AR'
         and jl.party_type = 'retailer' and jl.party_id = ${retailerId}`)
    return Number((result.rows[0] as { ar: string }).ar)
  }

  async function accountBalance(code: string): Promise<number> {
    const result = await db.execute(sql`
      select coalesce(sum(jl.amount_paise), 0) as b
        from journal_lines jl join accounts a on a.id = jl.account_id
       where jl.tenant_id = ${tenantId} and a.code = ${code}`)
    return Number((result.rows[0] as { b: string }).b)
  }

  async function trialBalance(): Promise<number> {
    const result = await db.execute(
      sql`select coalesce(sum(amount_paise), 0) as t from journal_lines where tenant_id = ${tenantId}`,
    )
    return Number((result.rows[0] as { t: string }).t)
  }

  async function invoiceState(id: string): Promise<string> {
    const result = await db.execute(sql`select state::text as state from invoices where id = ${id}`)
    return (result.rows[0] as { state: string }).state
  }

  async function outstanding(retailerId: string): Promise<Outstanding> {
    const res = await call<Outstanding>(
      app,
      accountant,
      'GET',
      `/receivables/outstanding/${retailerId}`,
      { includeBills: false },
    )
    expect(res.status).toBe(200)
    return res.body
  }

  /** The reconcile's R2a for one shop: open bills − money on account = AR, from the summary the screens read. */
  async function expectBooksAgree(retailerId: string): Promise<void> {
    const dues = await outstanding(retailerId)
    expect(dues.outstandingPaise - dues.unallocatedCreditPaise).toBe(await arBalance(retailerId))
    expect(await trialBalance()).toBe(0)
  }

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `mr-${run}`, legalName: 'Money rulings', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91915${run}1`, name: 'Owner' },
      { id: accountantId, phone: `+91915${run}2`, name: 'Accountant' },
      { id: crewId, phone: `+91915${run}3`, name: 'Crew' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: crewId, role: 'delivery' },
    ])
    await bootstrapTenant(db, tenantId)
    app = await bootTestApp([ReceivablesModule, SyncModule])
    receivables = app.get(ReceivablesService)
    receivables.registerTripPredicates(TRIP_PREDICATES)
    const godown = (
      await db
        .select()
        .from(locations)
        .where(sql`${locations.tenantId} = ${tenantId}`)
    ).find((l) => l.kind === 'warehouse')
    await db.insert(vehicles).values({
      id: vanId,
      tenantId,
      regNo: `MH-05-MR-${run.slice(-4)}`,
      name: 'Rulings tempo',
      locationId: godown?.id ?? '',
    })
    await db.insert(trips).values({
      id: tripId,
      tenantId,
      tripNo: `TRIP-MR-${run}`,
      tripDate: businessDate().date,
      vehicleId: vanId,
      driverId: crewId,
      state: 'active',
      startedAt: new Date(),
    })
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  // =============================================================================================================
  // DOS-310 — a payment reference is used once

  describe('DOS-310: a payment reference is used once', () => {
    it('refuses a UPI reference already on a live receipt, whoever the shop, and names the earlier receipt', async () => {
      const pb7 = await newShop('QA P7 PB7')
      const pb5 = await newShop('QA P7 PB5')
      await issueBill(pb7.id, 50_000)
      const utr = `UTR17905${run}`
      const first = await pay(accountant, pb7.id, 10_500, { mode: 'upi', reference: utr })
      expect(first.status).toBe(200)

      // the same UTR again with a NEW id and key — what a second desk sends (A9b)
      const again = await pay(accountant, pb7.id, 10_500, { mode: 'upi', reference: utr })
      expect(again.status).toBe(409)
      expect(again.body.data?.code).toBe('reference_already_recorded')
      expect(again.body.message).toContain(first.body.item.receiptNo ?? '')
      expect(again.body.message).toContain(pb7.name)
      expect(again.body.message).toContain('₹105.00')
      expect(again.body.data?.earlier?.receiptNo).toBe(first.body.item.receiptNo)

      // the same UTR against a DIFFERENT shop, and written with spaces in lower case: still the same transfer
      const other = await pay(accountant, pb5.id, 10_500, {
        mode: 'upi',
        reference: ` ${utr.toLowerCase().slice(0, 6)} ${utr.toLowerCase().slice(6)} `,
      })
      expect(other.status).toBe(409)
      expect(other.body.data?.code).toBe('reference_already_recorded')

      // a UTR is unique per transfer whatever it was keyed as: a bank transfer with it is refused too
      const neft = await pay(accountant, pb5.id, 10_500, { mode: 'bank_transfer', reference: utr })
      expect(neft.status).toBe(409)

      const count = await db.execute(sql`
        select count(*)::int as n from receipts
         where tenant_id = ${tenantId}
           and dos_normalise_reference(reference) = dos_normalise_reference(${utr})`)
      expect((count.rows[0] as { n: number }).n).toBe(1)
      await expectBooksAgree(pb7.id)
    })

    it('replays the first result for the same request under the same key; that is not a duplicate', async () => {
      const shop = await newShop('Replay')
      const body = {
        idempotencyKey: `replay-${run}`,
        id: uuidv7(),
        retailerId: shop.id,
        mode: 'upi',
        amountPaise: 20_000,
        reference: `UTRREPLAY${run}`,
      }
      const first = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', body)
      const second = await call<ReceiptReply>(app, accountant, 'POST', '/receipts', body)
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(second.body.item.id).toBe(first.body.item.id)
      expect(second.body.item.receiptNo).toBe(first.body.item.receiptNo)
    })

    it('refuses a cheque number already recorded for the same shop; asks before taking it from another shop', async () => {
      const pb5 = await newShop('Cheque PB5')
      const other = await newShop('Cheque other')
      await issueBill(pb5.id, 59_500)
      const cheque = { mode: 'cheque', reference: `CHQ08${run}`, bankName: 'Cosmos Bank' }
      const first = await pay(accountant, pb5.id, 59_500, cheque)
      expect(first.status).toBe(200)

      // A9: the same cheque, a new id and key → was RCPT-9022, ₹595.00 of money never paid
      const twice = await pay(accountant, pb5.id, 59_500, cheque)
      expect(twice.status).toBe(409)
      expect(twice.body.data?.code).toBe('cheque_already_recorded')
      expect(twice.body.message).toContain(first.body.item.receiptNo ?? '')

      // another shop's cheque with the same number: the desk is shown the earlier receipt and asked
      const asked = await pay(accountant, other.id, 12_000, cheque)
      expect(asked.status).toBe(409)
      expect(asked.body.data?.code).toBe('cheque_number_seen_elsewhere')
      expect(asked.body.data?.earlier?.retailerName).toBe(pb5.name)
      expect(asked.body.message).toContain('confirm')
      const confirmed = await pay(accountant, other.id, 12_000, {
        ...cheque,
        confirmReference: true,
      })
      expect(confirmed.status).toBe(200)
      await expectBooksAgree(pb5.id)
      await expectBooksAgree(other.id)
    })

    it('frees the reference of a receipt that was reversed or bounced', async () => {
      const shop = await newShop('Freed')
      const utr = `UTRFREE${run}`
      const first = await pay(accountant, shop.id, 7_000, { mode: 'upi', reference: utr })
      expect(first.status).toBe(200)
      const undone = await call(
        app,
        accountant,
        'POST',
        `/receipts/${first.body.item.id}/reverse`,
        {
          idempotencyKey: uuidv7(),
          id: first.body.item.id,
          reversalId: uuidv7(),
          reason: 'keyed against the wrong shop',
        },
      )
      expect(undone.status).toBe(200)
      const again = await pay(accountant, shop.id, 7_000, { mode: 'upi', reference: utr })
      expect(again.status).toBe(200)

      const cheque = { mode: 'cheque', reference: `BNC${run}`, bankName: 'Bank of Baroda' }
      const bouncing = await pay(accountant, shop.id, 3_000, cheque)
      expect(bouncing.status).toBe(200)
      const bounced = await call(
        app,
        accountant,
        'POST',
        `/receipts/${bouncing.body.item.id}/bounce`,
        {
          idempotencyKey: uuidv7(),
          id: bouncing.body.item.id,
          reversalId: uuidv7(),
          bouncedAt: new Date().toISOString(),
          reason: 'funds insufficient',
        },
      )
      expect(bounced.status).toBe(200)
      expect((await pay(accountant, shop.id, 3_000, cheque)).status).toBe(200)
      await expectBooksAgree(shop.id)
    })

    it("refuses the same UTR at the crew's door and through the offline upload, keeping the money in the tray", async () => {
      const shop = await newShop('Door')
      const utr = `UTRDOOR${run}`
      const desk = await pay(accountant, shop.id, 5_000, { mode: 'upi', reference: utr })
      expect(desk.status).toBe(200)

      const door = await pay(crew, shop.id, 5_000, { mode: 'upi', reference: utr, tripId })
      expect(door.status).toBe(409)
      expect(door.body.data?.code).toBe('reference_already_recorded')

      const deviceId = `phone-${run}`
      const opId = `op-dup-${run}`
      const upload = await call<{
        accepted: number
        rejected: { opId: string; code: string; messageEn: string }[]
      }>(app, crew, 'POST', '/sync/upload', {
        protocol: 1,
        deviceId,
        ops: [
          {
            opId,
            op: 'PUT',
            table: 'receipts',
            id: uuidv7(),
            data: {
              retailer_id: shop.id,
              mode: 'upi',
              amount_paise: 5_000,
              reference: utr,
              trip_id: tripId,
              device_id: deviceId,
              client_receipt_no: `B-${run}`,
            },
          },
        ],
      })
      expect(upload.status).toBe(200)
      expect(upload.body.accepted).toBe(0)
      expect(upload.body.rejected[0]?.code).toBe('reference_already_recorded')
      expect(upload.body.rejected[0]?.messageEn).toContain(desk.body.item.receiptNo ?? '')
      const kept = await db.execute(sql`
        select code from sync_errors where tenant_id = ${tenantId} and op_id = ${opId}`)
      expect((kept.rows[0] as { code: string } | undefined)?.code).toBe(
        'reference_already_recorded',
      )
      await expectBooksAgree(shop.id)
    })
  })

  // =============================================================================================================
  // DOS-311 — money received after a write-off recovers the write-off first

  describe('DOS-311: money after a write-off recovers the write-off first', () => {
    it('books the ₹395.00 as bad debt recovered, not as the shop credit, and the next bill stays owed in full', async () => {
      const pb6 = await newShop('QA P7 PB6')
      const bill = await issueBill(pb6.id, 59_500, -30)
      expect((await pay(accountant, pb6.id, 20_000)).status).toBe(200)
      for (const [amount, reason] of [
        [1_000, 'rounding'],
        [38_500, 'bad_debt'],
      ] as const) {
        const w = await call(app, owner, 'POST', '/receivables/write-offs', {
          idempotencyKey: uuidv7(),
          id: uuidv7(),
          invoiceId: bill.id,
          amountPaise: amount,
          reason,
        })
        expect(w.status).toBe(200)
      }
      expect(await invoiceState(bill.id)).toBe('written_off')
      const badDebtsBefore = await accountBalance('BAD_DEBTS')

      // A13: the shop turns up and pays the ₹395.00 it owed
      const paid = await pay(accountant, pb6.id, 39_500)
      expect(paid.status).toBe(200)
      expect(paid.body.recoveries).toEqual([
        {
          invoiceId: bill.id,
          invoiceNo: bill.invoiceNo,
          writtenOffOn: businessDate().date,
          amountPaise: 39_500,
        },
      ])
      expect(paid.body.unallocatedPaise).toBe(0)
      expect(paid.body.outstanding.unallocatedCreditPaise).toBe(0)
      expect(await invoiceState(bill.id)).toBe('written_off')
      expect(await accountBalance('BAD_DEBTS')).toBe(badDebtsBefore - 39_500)
      expect(await arBalance(pb6.id)).toBe(0)
      await expectBooksAgree(pb6.id)

      // the receipt says what it recovered on the desk's read too
      const read = await call<{ recoveries?: Recovery[] }>(
        app,
        accountant,
        'GET',
        `/receipts/${paid.body.item.id}`,
      )
      expect(read.body.recoveries?.[0]?.amountPaise).toBe(39_500)

      // the next bill stays owed in full: nothing sits on account to eat into it
      const next = await issueBill(pb6.id, 59_500)
      const dues = await outstanding(pb6.id)
      expect(dues.outstandingPaise).toBe(59_500)
      expect(dues.unallocatedCreditPaise).toBe(0)
      expect(await invoiceState(next.id)).toBe('issued')

      // a second payment goes to the new bill: the write-off is recovered already, nothing is taken twice
      const later = await pay(accountant, pb6.id, 59_500)
      expect(later.body.recoveries).toEqual([])
      expect(await invoiceState(next.id)).toBe('paid')
      await expectBooksAgree(pb6.id)
    })

    it("recovers the write-offs first even when an open bill is waiting, oldest write-off first; the crew's money too", async () => {
      const shop = await newShop('Recover first')
      const old = await issueBill(shop.id, 10_000, -90)
      const w = await call(app, owner, 'POST', '/receivables/write-offs', {
        idempotencyKey: uuidv7(),
        id: uuidv7(),
        invoiceId: old.id,
        amountPaise: 10_000,
        reason: 'bad_debt',
      })
      expect(w.status).toBe(200)
      const open = await issueBill(shop.id, 30_000)
      const door = await pay(crew, shop.id, 25_000, { tripId })
      expect(door.status).toBe(200)
      expect(door.body.recoveries?.map((r) => r.amountPaise)).toEqual([10_000])
      // what is left goes to the open bill
      expect(door.body.allocations.find((a) => a.invoiceId === open.id)?.amountPaise).toBe(15_000)
      expect(await invoiceState(open.id)).toBe('partially_paid')
      await expectBooksAgree(shop.id)
    })

    it('puts the write-off back when the money that recovered it is reversed or bounced, and keeps it off the desk', async () => {
      const shop = await newShop('Recovery undone')
      const bill = await issueBill(shop.id, 20_000, -60)
      await call(app, owner, 'POST', '/receivables/write-offs', {
        idempotencyKey: uuidv7(),
        id: uuidv7(),
        invoiceId: bill.id,
        amountPaise: 20_000,
        reason: 'bad_debt',
      })
      const badDebts = await accountBalance('BAD_DEBTS')
      const cheque = await pay(accountant, shop.id, 20_000, {
        mode: 'cheque',
        reference: `REC${run}`,
        bankName: 'SBI',
      })
      expect(cheque.body.recoveries?.[0]?.amountPaise).toBe(20_000)
      const recoveryAllocation = cheque.body.allocations.find((a) => a.invoiceId === bill.id)
      // the money on a written-off bill is part of how it closed: it is not taken off by hand
      const removed = await call<Refusal>(
        app,
        accountant,
        'POST',
        `/allocations/${recoveryAllocation?.id ?? ''}/remove`,
        { idempotencyKey: uuidv7(), id: recoveryAllocation?.id ?? '', reason: 'test' },
      )
      expect(removed.status).toBe(409)
      expect(removed.body.data?.code).toBe('bill_written_off')

      const bounced = await call(
        app,
        accountant,
        'POST',
        `/receipts/${cheque.body.item.id}/bounce`,
        {
          idempotencyKey: uuidv7(),
          id: cheque.body.item.id,
          reversalId: uuidv7(),
          bouncedAt: new Date().toISOString(),
          reason: 'refer to drawer',
        },
      )
      expect(bounced.status).toBe(200)
      expect(await accountBalance('BAD_DEBTS')).toBe(badDebts)
      expect(await invoiceState(bill.id)).toBe('written_off')
      const standing = await db.execute(sql`
        select coalesce(sum(amount_paise), 0) as s from write_offs
         where tenant_id = ${tenantId} and invoice_id = ${bill.id}`)
      expect(Number((standing.rows[0] as { s: string }).s)).toBe(20_000)
      await expectBooksAgree(shop.id)

      // and the next money recovers it again
      const cash = await pay(accountant, shop.id, 20_000)
      expect(cash.body.recoveries?.[0]?.amountPaise).toBe(20_000)
      await expectBooksAgree(shop.id)
    })
  })

  // =============================================================================================================
  // DOS-312 — money on account is applied to the oldest open bills

  describe('DOS-312: money on account is used', () => {
    it('meets a new bill with the advance the shop paid (R-9034: ₹1,000.00 advance, ₹595.00 bill)', async () => {
      const pb3 = await newShop('QA P7 PB3')
      const advance = await pay(accountant, pb3.id, 100_000)
      expect(advance.status).toBe(200)
      expect(advance.body.unallocatedPaise).toBe(100_000)
      const bill = await issueBill(pb3.id, 59_500)
      expect(await invoiceState(bill.id)).toBe('paid')
      const dues = await outstanding(pb3.id)
      expect(dues.outstandingPaise).toBe(0)
      expect(dues.unallocatedCreditPaise).toBe(40_500)
      // visible on the receipt it came from, like a hand allocation
      const read = await call<{ allocations: { invoiceId: string; amountPaise: number }[] }>(
        app,
        accountant,
        'GET',
        `/receipts/${advance.body.item.id}`,
      )
      expect(read.body.allocations).toEqual([
        expect.objectContaining({ invoiceId: bill.id, amountPaise: 59_500 }),
      ])
      await expectBooksAgree(pb3.id)
    })

    it('applies a credit note on a paid bill to the oldest open bill', async () => {
      const shop = await newShop('Note on paid')
      const paidBill = await issueBill(shop.id, 10_000, -10)
      expect((await pay(accountant, shop.id, 10_000)).status).toBe(200)
      const open = await issueBill(shop.id, 8_000)
      await creditNote(paidBill.id, shop.id, 3_000)
      expect(await invoiceState(open.id)).toBe('partially_paid')
      const dues = await outstanding(shop.id)
      expect(dues.outstandingPaise).toBe(5_000)
      expect(dues.unallocatedCreditPaise).toBe(0)
      await expectBooksAgree(shop.id)
    })

    it('sends what an explicit split leaves over to the oldest open bill', async () => {
      const shop = await newShop('Explicit remainder')
      const older = await issueBill(shop.id, 4_000, -20)
      const newer = await issueBill(shop.id, 6_000, 5)
      const res = await pay(accountant, shop.id, 9_000, {
        strategy: 'explicit',
        allocations: [{ id: uuidv7(), invoiceId: newer.id, amountPaise: 6_000 }],
      })
      expect(res.status).toBe(200)
      expect(res.body.unallocatedPaise).toBe(0)
      expect(await invoiceState(newer.id)).toBe('paid')
      expect(await invoiceState(older.id)).toBe('partially_paid')
      await expectBooksAgree(shop.id)
    })

    it('"Apply money on account" applies money that already sat on account, per shop and for all, and it can be undone', async () => {
      const shop = await newShop('Mangal Traders')
      const bill = await issueBill(shop.id, 86_700, -20)
      // money left on account the old way, beside the overdue bill (14 seeded shops hold ₹35,380 like this)
      const onAccount = await pay(accountant, shop.id, 500_000, { strategy: 'none' })
      expect(onAccount.body.unallocatedPaise).toBe(500_000)
      expect((await outstanding(shop.id)).outstandingPaise).toBe(86_700)

      const second = await newShop('Second shop')
      const secondBill = await issueBill(second.id, 10_000, -3)
      await pay(accountant, second.id, 4_000, { strategy: 'none' })

      const one = await call<{
        shops: { retailerId: string; appliedPaise: number; allocations: { id: string }[] }[]
        appliedPaise: number
        allocationCount: number
        more: boolean
      }>(app, accountant, 'POST', '/allocations/apply-on-account', {
        idempotencyKey: uuidv7(),
        id: uuidv7(),
        retailerId: shop.id,
      })
      expect(one.status).toBe(200)
      expect(one.body.appliedPaise).toBe(86_700)
      expect(one.body.shops.map((s) => s.retailerId)).toEqual([shop.id])
      expect(await invoiceState(bill.id)).toBe('paid')
      const dues = await outstanding(shop.id)
      expect(dues.outstandingPaise).toBe(0)
      expect(dues.unallocatedCreditPaise).toBe(500_000 - 86_700)
      await expectBooksAgree(shop.id)

      const all = await call<{ shops: { retailerId: string; appliedPaise: number }[] }>(
        app,
        accountant,
        'POST',
        '/allocations/apply-on-account',
        { idempotencyKey: uuidv7(), id: uuidv7() },
      )
      expect(all.status).toBe(200)
      expect(all.body.shops).toEqual([
        expect.objectContaining({ retailerId: second.id, appliedPaise: 4_000 }),
      ])
      expect(await invoiceState(secondBill.id)).toBe('partially_paid')

      // reversible the way a hand allocation is
      const applied = one.body.shops[0]?.allocations[0]?.id ?? ''
      const undo = await call(app, accountant, 'POST', `/allocations/${applied}/remove`, {
        idempotencyKey: uuidv7(),
        id: applied,
        reason: 'the shop asked to keep it as an advance',
      })
      expect(undo.status).toBe(200)
      expect(await invoiceState(bill.id)).toBe('issued')
      await expectBooksAgree(shop.id)
    })
  })

  // =============================================================================================================
  // DOS-256 — UPI is confirmed at Day-end

  describe('DOS-256: UPI receipts are confirmed at Day-end', () => {
    it('moves confirmed UPI from UPI clearing to the bank, the deposit way; a bank transfer is refused; nothing confirms itself', async () => {
      const shop = await newShop('UPI day-end')
      const office = await pay(accountant, shop.id, 12_300, {
        mode: 'upi',
        reference: `UTRDE1${run}`,
      })
      // taken by the crew on a trip that has not settled: UPI was never in the van, so it confirms all the same
      const road = await pay(crew, shop.id, 4_500, {
        mode: 'upi',
        reference: `UTRDE2${run}`,
        tripId,
      })
      const transfer = await pay(accountant, shop.id, 1_000, {
        mode: 'bank_transfer',
        reference: `NEFTDE${run}`,
      })
      expect(office.body.item.status).toBe('collected')
      expect(road.body.item.status).toBe('collected')

      const unconfirmed = await call<{ items: { id: string }[] }>(
        app,
        accountant,
        'GET',
        '/receipts',
        {
          mode: 'upi',
          status: 'collected',
          retailerId: shop.id,
          from: day(0),
          to: day(0),
        },
      )
      expect(unconfirmed.body.items.map((r) => r.id).sort()).toEqual(
        [office.body.item.id, road.body.item.id].sort(),
      )

      const upiBefore = await accountBalance('UPI')
      const bankBefore = await accountBalance('BANK')
      const confirm = await call<{ updated: number; totalPaise: number }>(
        app,
        accountant,
        'POST',
        '/receipts/deposit',
        {
          idempotencyKey: uuidv7(),
          id: uuidv7(),
          receiptIds: unconfirmed.body.items.map((r) => r.id),
          depositedAt: new Date().toISOString(),
        },
      )
      expect(confirm.status).toBe(200)
      expect(confirm.body.totalPaise).toBe(16_800)
      expect(await accountBalance('UPI')).toBe(upiBefore - 16_800)
      expect(await accountBalance('BANK')).toBe(bankBefore + 16_800)
      const banked = await call<{ totals: { countedPaise: number } }>(
        app,
        owner,
        'GET',
        '/receipts',
        {
          status: 'deposited',
          retailerId: shop.id,
          from: day(0),
          to: day(0),
        },
      )
      expect(banked.body.totals.countedPaise).toBe(16_800)

      const refused = await call<Refusal>(app, accountant, 'POST', '/receipts/deposit', {
        idempotencyKey: uuidv7(),
        id: uuidv7(),
        receiptIds: [transfer.body.item.id],
        depositedAt: new Date().toISOString(),
      })
      expect(refused.status).toBe(409)
      expect(refused.body.data?.code).toBe('not_bankable')
      expect(await trialBalance()).toBe(0)
    })
  })

  // =============================================================================================================
  // DOS-320 — a bill closed by credit notes alone reads "Credited"

  describe('DOS-320: what closed a bill', () => {
    it('reads credited for a bill closed by a credit note alone, paid for money, paid with the credit beside it for both', async () => {
      const shop = await newShop('Came back')
      const refused = await issueBill(shop.id, 59_500)
      await creditNote(refused.id, shop.id, 59_500)
      const mixed = await issueBill(shop.id, 10_000)
      await creditNote(mixed.id, shop.id, 2_000)
      await pay(accountant, shop.id, 8_000)
      const settled = await asOwner((tx) =>
        receivables.invoiceSettlementMany(tx, [refused.id, mixed.id]),
      )
      const r = settled.get(refused.id)
      const m = settled.get(mixed.id)
      expect(r).toEqual({ paidPaise: 0, creditedPaise: 59_500, recoveredPaise: 0 })
      expect(m).toEqual({ paidPaise: 8_000, creditedPaise: 2_000, recoveredPaise: 0 })
      expect(await invoiceState(refused.id)).toBe('paid')
      expect(invoiceStateShown({ state: await invoiceState(refused.id), ...r })).toBe('credited')
      expect(invoiceStateShown({ state: await invoiceState(mixed.id), ...m })).toBe('paid')
    })
  })
})
