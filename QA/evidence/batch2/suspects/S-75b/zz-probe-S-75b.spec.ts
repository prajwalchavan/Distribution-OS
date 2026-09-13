// TEMPORARY QA PROBE for suspect S-75b. Not product code; deleted after the run.
import { sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  memberships,
  retailers,
  tenants,
  users,
} from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bearer, bootTestApp, call, type Actor } from '../../testing/app.js'
import { SyncModule } from '../sync/index.js'
import { ReceivablesModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type Books = {
  status: string
  deposit_ref: string | null
  entries: number
  bank: string
  source: string
  events: number
}

describeDb('PROBE S-75b: two desks bank the same receipt at the same moment', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const shopId = uuidv7()
  let app: NestFastifyApplication
  let hAccountant: Record<string, string>
  let hManager: Record<string, string>
  let chequeNo = 750000
  const say = (line: string): void => {
    console.log(`[S-75b] ${line}`)
    process
      .getBuiltinModule('node:fs')
      .appendFileSync(
        '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/suspects/S-75b/probe-log.txt',
        `[S-75b] ${line}\n`,
      )
  }

  beforeAll(async () => {
    const dbName = await db.execute(sql`select current_database() as d, current_setting('transaction_isolation') as iso`)
    say(`database=${JSON.stringify(dbName.rows[0])}`)
    await db.insert(tenants).values({
      id: tenantId,
      slug: `s75b-${run}`,
      legalName: 'S-75b probe distributor',
      stateCode: '27',
    })
    await db.insert(users).values([
      { id: ownerId, phone: `+91975${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91975${run}2`, name: 'Manager desk' },
      { id: accountantId, phone: `+91975${run}3`, name: 'Accountant desk' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
    ])
    await bootstrapTenant(db, tenantId)
    await db.insert(retailers).values({
      id: shopId,
      tenantId,
      code: `S75B-${run}`,
      name: `Probe shop ${run}`,
      phone: `+9197${run}0`,
      stateCode: '27',
      tier: 'C',
      creditDays: 15,
    })
    app = await bootTestApp([ReceivablesModule, SyncModule])
    hAccountant = await bearer(accountant)
    hManager = await bearer(manager)
    say(`tenant=${tenantId} slug=s75b-${run} shop=${shopId}`)
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  /** An office receipt (no trip) recorded at the desk, exactly as the manager app's Record payment does. */
  const take = async (mode: 'cash' | 'cheque', amountPaise: number): Promise<string> => {
    const id = uuidv7()
    chequeNo += 1
    const res = await call<{ item: { tripId: string | null; status: string } }>(
      app,
      accountant,
      'POST',
      '/receipts',
      {
        idempotencyKey: `rcpt-s75b-${id}`,
        id,
        retailerId: shopId,
        mode,
        amountPaise,
        ...(mode === 'cheque'
          ? { reference: String(chequeNo), bankName: 'Bank of Maharashtra' }
          : {}),
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.item.tripId).toBeNull()
    expect(res.body.item.status).toBe('collected')
    return id
  }

  /** POST /receipts/deposit through the service's HTTP stack with a pre-signed desk token. */
  const deposit = async (
    headers: Record<string, string>,
    batchId: string,
    receiptIds: string[],
    ref: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const res = await app.inject({
      method: 'POST',
      url: '/receipts/deposit',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: JSON.stringify({
        idempotencyKey: `dep-s75b-${batchId}`,
        id: batchId,
        receiptIds,
        depositedAt: new Date().toISOString(),
        depositRef: ref,
      }),
    })
    return { status: res.statusCode, body: res.json() }
  }

  const booksFor = async (receiptId: string, batchIds: string[]): Promise<Books> => {
    const batches = sql.join(
      batchIds.map((b) => sql`${b}`),
      sql`, `,
    )
    const result = await db.execute(sql`
      select r.status::text as status, r.deposit_ref,
             (select count(*) from journal_entries je
               where je.tenant_id = r.tenant_id and je.ref_type = 'deposit' and je.ref_id in (${batches}))::int as entries,
             (select coalesce(sum(jl.amount_paise), 0) from journal_entries je
                join journal_lines jl on jl.entry_id = je.id and jl.tenant_id = je.tenant_id
                join accounts a on a.id = jl.account_id
               where je.tenant_id = r.tenant_id and je.ref_type = 'deposit' and je.ref_id in (${batches})
                 and a.code = 'BANK')::bigint as bank,
             (select coalesce(sum(jl.amount_paise), 0) from journal_entries je
                join journal_lines jl on jl.entry_id = je.id and jl.tenant_id = je.tenant_id
                join accounts a on a.id = jl.account_id
               where je.tenant_id = r.tenant_id and je.ref_type = 'deposit' and je.ref_id in (${batches})
                 and a.code in ('CASH', 'CHEQUES'))::bigint as source,
             (select count(*) from outbox_events o
               where o.tenant_id = r.tenant_id and o.aggregate_id = r.id
                 and o.event_type = 'ChequeDeposited')::int as events
        from receipts r
       where r.tenant_id = ${tenantId} and r.id = ${receiptId}`)
    return result.rows[0] as Books
  }

  const brief = (res: { status: number; body: Record<string, unknown> }): string =>
    res.status === 200
      ? `200(updated=${String(res.body.updated)},total=${String(res.body.totalPaise)})`
      : `${String(res.status)}(${String(res.body.message)})`

  it('A: unassisted - 30 pairs of simultaneous deposits of ONE receipt, accountant and manager, different keys', async () => {
    let both = 0
    let oneRefused = 0
    let other = 0
    for (let i = 1; i <= 30; i += 1) {
      const mode = i % 2 === 0 ? 'cheque' : 'cash'
      const rid = await take(mode, 10_000)
      const batchA = uuidv7()
      const batchB = uuidv7()
      const [a, b] = await Promise.all([
        deposit(hAccountant, batchA, [rid], `DEP-A-${String(i)}`),
        deposit(hManager, batchB, [rid], `DEP-B-${String(i)}`),
      ])
      const books = await booksFor(rid, [batchA, batchB])
      if (a.status === 200 && b.status === 200) both += 1
      else if ([a.status, b.status].sort().join('/') === '200/409') oneRefused += 1
      else other += 1
      say(
        `A run ${String(i).padStart(2, '0')} ${mode.padEnd(6)} receipt=${rid} accountant=${brief(a)} manager=${brief(b)} | receipt.status=${books.status} deposit_ref=${String(books.deposit_ref)} depositEntries=${String(books.entries)} BANK=${books.bank} ${mode === 'cash' ? 'CASH' : 'CHEQUES'}=${books.source} ChequeDepositedEvents=${String(books.events)}`,
      )
    }
    say(`A summary: runs=30 bothSucceeded=${String(both)} oneRefused409=${String(oneRefused)} other=${String(other)}`)
  }, 300_000)

  it('B: forced interleave - a third connection holds the receipt row lock 1.5 s so both desks read before either writes', async () => {
    let both = 0
    for (let i = 1; i <= 5; i += 1) {
      const rid = await take('cash', 10_000)
      const gate = await pool.connect()
      await gate.query('begin')
      await gate.query('select id from receipts where id = $1 for update', [rid])
      const batchA = uuidv7()
      const batchB = uuidv7()
      const pa = deposit(hAccountant, batchA, [rid], `DEP-BA-${String(i)}`)
      const pb = deposit(hManager, batchB, [rid], `DEP-BB-${String(i)}`)
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      const waiting = await gate.query<{ n: number; q: string[] }>(
        `select count(*)::int as n, array_agg(left(query, 40)) as q from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
      )
      await gate.query('commit')
      gate.release()
      const [a, b] = await Promise.all([pa, pb])
      const books = await booksFor(rid, [batchA, batchB])
      if (a.status === 200 && b.status === 200) both += 1
      say(
        `B run ${String(i)} cash receipt=${rid} backendsWaitingOnLock=${String(waiting.rows[0]?.n)} ${JSON.stringify(waiting.rows[0]?.q)} accountant=${brief(a)} manager=${brief(b)} | receipt.status=${books.status} deposit_ref=${String(books.deposit_ref)} depositEntries=${String(books.entries)} BANK=${books.bank} CASH=${books.source} ChequeDepositedEvents=${String(books.events)}`,
      )
    }
    say(`B summary: runs=5 bothSucceeded=${String(both)}`)
  }, 120_000)

  it('C: control - the same receipt banked twice ONE AFTER THE OTHER: the second call is refused', async () => {
    const rid = await take('cash', 10_000)
    const batchA = uuidv7()
    const batchB = uuidv7()
    const a = await deposit(hAccountant, batchA, [rid], 'DEP-C-A')
    const b = await deposit(hManager, batchB, [rid], 'DEP-C-B')
    const books = await booksFor(rid, [batchA, batchB])
    say(
      `C sequential receipt=${rid} first=${brief(a)} second=${brief(b)} | receipt.status=${books.status} depositEntries=${String(books.entries)} BANK=${books.bank} CASH=${books.source}`,
    )
  }, 60_000)

  it('D: the probe tenant books after A, B and C', async () => {
    const receipts = await db.execute(sql`
      select mode::text as mode, count(*)::int as n, sum(amount_paise)::bigint as collected,
             count(*) filter (where status = 'deposited')::int as deposited
        from receipts where tenant_id = ${tenantId} group by mode order by mode`)
    say(`D receipts by mode: ${JSON.stringify(receipts.rows)}`)
    const accounts = await db.execute(sql`
      select a.code, sum(jl.amount_paise)::bigint as balance
        from journal_lines jl join accounts a on a.id = jl.account_id
       where jl.tenant_id = ${tenantId} and a.code in ('BANK', 'CASH', 'CHEQUES', 'AR', 'ADVANCES')
       group by a.code order by a.code`)
    say(`D account balances (paise): ${JSON.stringify(accounts.rows)}`)
    const entries = await db.execute(sql`
      select ref_type, count(*)::int as n from journal_entries where tenant_id = ${tenantId}
       group by ref_type order by ref_type`)
    say(`D journal entries by ref_type: ${JSON.stringify(entries.rows)}`)
    const balanced = await db.execute(sql`
      select count(*)::int as unbalanced from (
        select je.id from journal_entries je join journal_lines jl on jl.entry_id = je.id
         where je.tenant_id = ${tenantId} group by je.id having sum(jl.amount_paise) <> 0) x`)
    say(`D unbalanced entries: ${JSON.stringify(balanced.rows[0])}`)
  }, 60_000)
})
