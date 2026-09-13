// TEMPORARY QA SKEPTIC PROBE for suspect S-75b. Not product code; deleted after the run.
// Runs inside backend/manager-service so the REAL service compositions are booted (createServiceApp with the
// manager and owner definitions: real TenantGuard, SERVICE_INFO role gate, permission matrix, DbModule), as
// three separate Nest app instances, each with its own DbModule.
import { appendFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { createServiceApp, ownerServiceDefinition } from '@dos/core'
import { bearer } from '@dos/core/testing'
import {
  bootstrapTenant,
  createDb,
  createPool,
  memberships,
  retailers,
  tenants,
  users,
} from '@dos/db'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { service as managerService } from './service.js'

const LOG =
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/suspects/S-75b/skeptic/skeptic-probe-log-E5E6.txt'
const say = (line: string): void => {
  console.log(`[S-75b-skeptic] ${line}`)
  appendFileSync(LOG, `[S-75b-skeptic] ${line}\n`)
}

/** UUIDv7 (48-bit ms timestamp + version 7 + variant), the shape the api-client generates. */
const uuidv7 = (): string => {
  const b = randomBytes(16)
  const ts = BigInt(Date.now())
  for (let i = 0; i < 6; i += 1) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn)
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type Res = { status: number; body: Record<string, unknown>; ms: number }

describeDb('SKEPTIC S-75b: two desks bank the same receipt through the real services', () => {
  const pool = createPool(url ?? '', 3)
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const shopId = uuidv7()
  let mgrA: NestFastifyApplication
  let mgrB: NestFastifyApplication
  let own: NestFastifyApplication
  let hOwner: Record<string, string>
  let hManager: Record<string, string>
  let hAccountant: Record<string, string>
  let chequeNo = 880000

  beforeAll(async () => {
    const info = await db.execute(
      sql`select current_database() as d, current_setting('transaction_isolation') as iso`,
    )
    say(`database=${JSON.stringify(info.rows[0])}`)
    await db.insert(tenants).values({
      id: tenantId,
      slug: `s75bsk-${run}`,
      legalName: 'S-75b skeptic distributor',
      stateCode: '27',
    })
    await db.insert(users).values([
      { id: ownerId, phone: `+91976${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91976${run}2`, name: 'Manager desk' },
      { id: accountantId, phone: `+91976${run}3`, name: 'Accountant desk' },
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
      code: `S75BSK-${run}`,
      name: `Skeptic shop ${run}`,
      phone: `+9196${run}0`,
      stateCode: '27',
      tier: 'C',
      creditDays: 15,
    })
    const boot = async (
      def: typeof managerService | typeof ownerServiceDefinition,
    ): Promise<NestFastifyApplication> => {
      const app = await createServiceApp(def, { logger: false })
      await app.init()
      await app.getHttpAdapter().getInstance().ready()
      return app
    }
    mgrA = await boot(managerService)
    mgrB = await boot(managerService)
    own = await boot(ownerServiceDefinition)
    hOwner = await bearer({ tenantId, actorId: ownerId, role: 'owner' })
    hManager = await bearer({ tenantId, actorId: managerId, role: 'manager' })
    hAccountant = await bearer({ tenantId, actorId: accountantId, role: 'accountant' })
    say(`tenant=${tenantId} slug=s75bsk-${run} apps: manager-service x2 (A, B) + owner-service x1`)
  }, 120_000)

  afterAll(async () => {
    await mgrA.close()
    await mgrB.close()
    await own.close()
    await pool.end()
  })

  const post = async (
    app: NestFastifyApplication,
    headers: Record<string, string>,
    path: string,
    body: Record<string, unknown>,
  ): Promise<Res> => {
    const t0 = performance.now()
    const res = await app.inject({
      method: 'POST',
      url: path,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    })
    return { status: res.statusCode, body: res.json(), ms: Math.round(performance.now() - t0) }
  }

  /** An office receipt recorded at the desk (manager app Record payment), accountant on manager-service A. */
  const take = async (mode: 'cash' | 'cheque', amountPaise: number): Promise<string> => {
    const id = uuidv7()
    chequeNo += 1
    const res = await post(mgrA, hAccountant, '/receipts', {
      idempotencyKey: uuidv7(),
      id,
      retailerId: shopId,
      mode,
      amountPaise,
      ...(mode === 'cheque' ? { reference: String(chequeNo), bankName: 'Bank of Maharashtra' } : {}),
    })
    if (res.status !== 200) throw new Error(`take failed ${res.status} ${JSON.stringify(res.body)}`)
    return id
  }

  /** Exactly the body the three screens build: meta.id, meta.idempotencyKey, receiptIds, depositedAt at call time, ref. */
  const depositBody = (
    receiptIds: string[],
    ref: string,
    meta = { id: uuidv7(), idempotencyKey: uuidv7() },
  ): Record<string, unknown> => ({
    id: meta.id,
    idempotencyKey: meta.idempotencyKey,
    receiptIds,
    depositedAt: new Date().toISOString(),
    depositRef: ref,
  })

  const brief = (r: Res): string =>
    r.status === 200
      ? `200(${String(r.ms)}ms)`
      : `${String(r.status)}(${String(r.ms)}ms ${String(r.body.message).slice(0, 70)})`

  /** Per receipt: status, deposit_ref, ChequeDeposited events (one per deposit call that banked it). */
  const receiptState = async (
    id: string,
  ): Promise<{ status: string; ref: string | null; events: number }> => {
    const r = await db.execute(sql`
      select r.status::text as status, r.deposit_ref as ref,
             (select count(*) from outbox_events o where o.tenant_id = r.tenant_id and o.aggregate_id = r.id
                and o.event_type = 'ChequeDeposited')::int as events
        from receipts r where r.tenant_id = ${tenantId} and r.id = ${id}`)
    return r.rows[0] as { status: string; ref: string | null; events: number }
  }

  const entriesFor = async (refIds: string[]): Promise<{ n: number; lines: Record<string, number> }> => {
    const ids = sql.join(
      refIds.map((b) => sql`${b}`),
      sql`, `,
    )
    const n = await db.execute(
      sql`select count(*)::int as n from journal_entries where tenant_id = ${tenantId} and ref_id in (${ids})`,
    )
    const lines = await db.execute(sql`
      select a.code, sum(jl.amount_paise)::bigint as amt from journal_entries je
        join journal_lines jl on jl.entry_id = je.id and jl.tenant_id = je.tenant_id
        join accounts a on a.id = jl.account_id
       where je.tenant_id = ${tenantId} and je.ref_id in (${ids}) group by a.code order by a.code`)
    const out: Record<string, number> = {}
    for (const row of lines.rows as { code: string; amt: string }[]) out[row.code] = Number(row.amt)
    return { n: (n.rows[0] as { n: number }).n, lines: out }
  }

  it('E1: real services, separate app instances - 20 simultaneous pairs (accountant@mgrA vs manager@mgrB, manager@mgrA vs owner@owner-service)', async () => {
    let doubled = 0
    let single = 0
    let other = 0
    for (let i = 1; i <= 20; i += 1) {
      const mode = i % 4 === 1 || i % 4 === 2 ? 'cash' : 'cheque'
      const rid = await take(mode, 10_000)
      const odd = i % 2 === 1
      const a = depositBody([rid], `SK-E1-A-${String(i)}`)
      const b = depositBody([rid], `SK-E1-B-${String(i)}`)
      const [ra, rb] = await Promise.all([
        odd ? post(mgrA, hAccountant, '/receipts/deposit', a) : post(mgrA, hManager, '/receipts/deposit', a),
        odd ? post(mgrB, hManager, '/receipts/deposit', b) : post(own, hOwner, '/receipts/deposit', b),
      ])
      const e = await entriesFor([String(a.id), String(b.id)])
      const st = await receiptState(rid)
      if (ra.status === 200 && rb.status === 200) doubled += 1
      else if ([ra.status, rb.status].sort().join('/') === '200/409') single += 1
      else other += 1
      say(
        `E1 ${String(i).padStart(2, '0')} ${mode.padEnd(6)} ${odd ? 'accountant@mgrA/manager@mgrB' : 'manager@mgrA/owner@owner '} A=${brief(ra)} B=${brief(rb)} | status=${st.status} ref=${String(st.ref)} depositEntries=${String(e.n)} lines=${JSON.stringify(e.lines)} events=${String(st.events)}`,
      )
    }
    say(`E1 summary: pairs=20 bothBanked=${String(doubled)} one200one409=${String(single)} other=${String(other)}`)
  }, 300_000)

  it('E2: how close must the second desk be? B starts d ms after A, 4 pairs per d', async () => {
    const delays = [0, 5, 10, 20, 40, 80, 160, 320]
    for (const d of delays) {
      let doubled = 0
      const aMs: number[] = []
      for (let k = 1; k <= 4; k += 1) {
        const rid = await take('cash', 10_000)
        const a = depositBody([rid], `SK-E2-A-${String(d)}-${String(k)}`)
        const pa = post(mgrA, hAccountant, '/receipts/deposit', a)
        if (d > 0) await sleep(d)
        const b = depositBody([rid], `SK-E2-B-${String(d)}-${String(k)}`)
        const pb = post(mgrB, hManager, '/receipts/deposit', b)
        const [ra, rb] = await Promise.all([pa, pb])
        aMs.push(ra.ms)
        const e = await entriesFor([String(a.id), String(b.id)])
        if (ra.status === 200 && rb.status === 200) doubled += 1
        say(
          `E2 d=${String(d).padStart(3)}ms k=${String(k)} A=${brief(ra)} B=${brief(rb)} depositEntries=${String(e.n)} BANK=${String(e.lines.BANK ?? 0)}`,
        )
      }
      say(`E2 summary d=${String(d)}ms: bothBanked=${String(doubled)}/4 A durations ms=${JSON.stringify(aMs)}`)
    }
  }, 300_000)

  it('E3: Day-end "Bank this batch" of 200 cash receipts (manager@mgrA) while the accountant presses "Bank it" on single receipts (accountant@mgrB) at offsets', async () => {
    const ids: string[] = []
    for (let i = 0; i < 200; i += 1) ids.push(await take('cash', 10_000))
    const offsets = [0, 25, 50, 100, 150, 200, 300, 450, 700, 1000]
    const picks = offsets.map((_, j) => ids[j * 20 + 7] ?? '')
    const before = await db.execute(sql`
      select coalesce(sum(jl.amount_paise), 0)::bigint as bank from journal_lines jl join accounts a on a.id = jl.account_id
       where jl.tenant_id = ${tenantId} and a.code = 'BANK'`)
    const batch = depositBody(ids, 'SK-E3-DAYEND')
    const t0 = performance.now()
    const pBatch = post(mgrA, hManager, '/receipts/deposit', batch)
    const singles = offsets.map(async (off, j) => {
      await sleep(off)
      const body = depositBody([picks[j] ?? ''], `SK-E3-ONE-${String(off)}`)
      const sentAt = Math.round(performance.now() - t0)
      const r = await post(mgrB, hAccountant, '/receipts/deposit', body)
      return { off, sentAt, r, batchId: String(body.id) }
    })
    const rBatch = await pBatch
    const batchEndedAt = Math.round(performance.now() - t0)
    const results = await Promise.all(singles)
    say(`E3 batch of 200: ${brief(rBatch)} updated=${String(rBatch.body.updated)} total=${String(rBatch.body.totalPaise)} replyAt=${String(batchEndedAt)}ms`)
    let doubled = 0
    for (const [j, x] of results.entries()) {
      const st = await receiptState(picks[j] ?? '')
      if (x.r.status === 200) doubled += 1
      say(
        `E3 single offset=${String(x.off)}ms sentAt=${String(x.sentAt)}ms -> ${brief(x.r)} | receipt status=${st.status} ref=${String(st.ref)} events=${String(st.events)}`,
      )
    }
    const after = await db.execute(sql`
      select coalesce(sum(jl.amount_paise), 0)::bigint as bank from journal_lines jl join accounts a on a.id = jl.account_id
       where jl.tenant_id = ${tenantId} and a.code = 'BANK'`)
    say(
      `E3 summary: singles banked a second time=${String(doubled)}/${String(offsets.length)}; BANK moved by ${String(Number((after.rows[0] as { bank: string }).bank) - Number((before.rows[0] as { bank: string }).bank))} paise for 2 000 000 paise of receipts`,
    )
  }, 300_000)

  it('E4: one desk double-taps the confirm the way useMutation sends it (same id + key, depositedAt built per call) - 10 pairs, plus 5 byte-identical pairs', async () => {
    let refused = 0
    let doubled = 0
    for (let i = 1; i <= 10; i += 1) {
      const rid = await take('cash', 10_000)
      const meta = { id: uuidv7(), idempotencyKey: uuidv7() }
      const first = depositBody([rid], `SK-E4-${String(i)}`, meta)
      await sleep(2)
      const second = depositBody([rid], `SK-E4-${String(i)}`, meta)
      const [r1, r2] = await Promise.all([
        post(mgrA, hManager, '/receipts/deposit', first),
        post(mgrB, hManager, '/receipts/deposit', second),
      ])
      const e = await entriesFor([meta.id])
      const st = await receiptState(rid)
      if (r1.status === 200 && r2.status === 200) doubled += 1
      if ([r1.status, r2.status].sort().join('/') === '200/409') refused += 1
      say(
        `E4 ${String(i).padStart(2, '0')} sameKey depositedAt ${String(first.depositedAt)} vs ${String(second.depositedAt)} -> ${brief(r1)} ${brief(r2)} | depositEntries=${String(e.n)} events=${String(st.events)}`,
      )
    }
    let identicalOk = 0
    for (let i = 1; i <= 5; i += 1) {
      const rid = await take('cash', 10_000)
      const body = depositBody([rid], `SK-E4-SAME-${String(i)}`)
      const [r1, r2] = await Promise.all([
        post(mgrA, hManager, '/receipts/deposit', body),
        post(mgrB, hManager, '/receipts/deposit', body),
      ])
      const e = await entriesFor([String(body.id)])
      const st = await receiptState(rid)
      if (e.n === 1 && st.events === 1) identicalOk += 1
      say(
        `E4 identical ${String(i)} -> ${brief(r1)} ${brief(r2)} journalEntryIds=${String(r1.body.journalEntryId)}/${String(r2.body.journalEntryId)} | depositEntries=${String(e.n)} events=${String(st.events)}`,
      )
    }
    say(`E4 summary: sameKey pairs one200one409=${String(refused)}/10 bothBanked=${String(doubled)}/10; identical pairs banked once=${String(identicalOk)}/5`)
  }, 300_000)

  it('E5: a cheque banked twice by two desks, then bounced once: what is left in BANK and CHEQUES for that cheque', async () => {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const rid = await take('cheque', 10_000)
      const a = depositBody([rid], `SK-E5-A-${String(attempt)}`)
      const b = depositBody([rid], `SK-E5-B-${String(attempt)}`)
      const [ra, rb] = await Promise.all([
        post(mgrA, hAccountant, '/receipts/deposit', a),
        post(mgrB, hManager, '/receipts/deposit', b),
      ])
      if (!(ra.status === 200 && rb.status === 200)) {
        say(`E5 attempt ${String(attempt)} not doubled (${brief(ra)} ${brief(rb)}); retrying`)
        continue
      }
      const reversalId = uuidv7()
      const bounce = await post(mgrA, hManager, `/receipts/${rid}/bounce`, {
        id: rid,
        reversalId,
        idempotencyKey: uuidv7(),
        bouncedAt: new Date().toISOString(),
        reason: 'Funds insufficient',
      })
      const e = await entriesFor([rid, String(a.id), String(b.id), reversalId])
      const st = await receiptState(rid)
      say(
        `E5 attempt ${String(attempt)} deposits ${brief(ra)} ${brief(rb)}; bounce ${brief(bounce)} | receipt status=${st.status}; entries(receipt+2 deposits+reversal)=${String(e.n)} net lines=${JSON.stringify(e.lines)}`,
      )
      break
    }
  }, 120_000)

  it('E6: tenant books, and what GET /receivables/accounts shows the owner', async () => {
    const receiptsByMode = await db.execute(sql`
      select mode::text as mode, count(*) filter (where amount_paise > 0)::int as n,
             sum(amount_paise) filter (where amount_paise > 0)::bigint as collected
        from receipts where tenant_id = ${tenantId} group by mode order by mode`)
    say(`E6 receipts by mode: ${JSON.stringify(receiptsByMode.rows)}`)
    const balances = await db.execute(sql`
      select a.code, sum(jl.amount_paise)::bigint as balance
        from journal_lines jl join accounts a on a.id = jl.account_id
       where jl.tenant_id = ${tenantId} and a.code in ('BANK','CASH','CHEQUES','AR')
       group by a.code order by a.code`)
    say(`E6 journal balances (paise): ${JSON.stringify(balances.rows)}`)
    const entries = await db.execute(sql`
      select ref_type, count(*)::int as n from journal_entries where tenant_id = ${tenantId} group by ref_type order by ref_type`)
    say(`E6 journal entries by ref_type: ${JSON.stringify(entries.rows)}`)
    const unbalanced = await db.execute(sql`
      select count(*)::int as n from (select je.id from journal_entries je join journal_lines jl on jl.entry_id = je.id
        where je.tenant_id = ${tenantId} group by je.id having sum(jl.amount_paise) <> 0) x`)
    say(`E6 unbalanced entries: ${JSON.stringify(unbalanced.rows[0])}`)
    const accounts = await own.inject({ method: 'GET', url: '/receivables/accounts', headers: hOwner })
    const text = accounts.body
    const bankIdx = text.indexOf('"BANK"')
    say(
      `E6 GET /receivables/accounts as owner@owner-service -> ${String(accounts.statusCode)}; around BANK: ${bankIdx >= 0 ? text.slice(Math.max(0, bankIdx - 120), bankIdx + 200) : text.slice(0, 300)}`,
    )
  }, 60_000)
})
