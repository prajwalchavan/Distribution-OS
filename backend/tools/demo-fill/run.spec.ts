import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { authContract, contract } from '@dos/contracts'
import { createAllInOne, type AllInOne } from '@dos/core'
import {
  createDb,
  createPool,
  invoiceCancelFootprints,
  receiptReferenceReport,
  stockBelowZero,
} from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { buildLookalikeTenant, databaseName } from '../testing/lookalike.js'
import { Api, type Session } from './client.js'
import { allRows, type CoverageSessions } from './coverage.js'
import { paymentReference } from './helpers.js'
import { addDays, demoId, demoIdDate, isDemoId, todayIst } from './ids.js'
import { newPassword, readLogins, testersFor, type TesterKey } from './people.js'
import { DEMO_ID_LIKE, DERIVED_KINDS, TOOL_KINDS, VIOLATIONS, expectedFromReports } from './rows.js'
import { runFill, type RunResult } from './run.js'
import { KNOWN_GAPS } from './summary.js'

/**
 * THE WHOLE RUN, against a look-alike tenant built from nothing on the test database: the API is booted in
 * this process (the same eight services the all-in-one runs) and closed again at the end, and the tool talks
 * to it over a real socket exactly as it talks to the server's. It proves the brief's rules: a dry run writes
 * nothing, the same date twice writes nothing the second time, yesterday is finished before today is made,
 * every role opens on work, the rows found are the rows the runs made, the tool's money is only on its own
 * bills, the books are right, and nothing it prints names a shop.
 *
 * And that a run HEALS (brief rules 4 and 6): a step the API refuses is counted while the rest of the day is
 * still made, and the next run makes what was refused; an API that stops answering in the middle of the
 * standing pieces still leaves a summary, and the next run finishes the day; a tester whose password was
 * changed by hand, a lost logins file, and a stand-in shop that stops being one are all put right by the
 * next run; the existing staff's passwords are never touched. The failures are made by a doorway between
 * the tool and the API that cuts or refuses the requests a case names.
 *
 * Runs only on a database whose name begins `dos_test_` (or in CI): it builds a distributor, and the
 * founder's own database is never one to build one in.
 */
const url = process.env.DATABASE_URL ?? ''
const usable = (databaseName(url)?.startsWith('dos_test_') ?? false) || process.env.CI === 'true'

/** Business tables the tool may write, counted for one distributor (the dry run must leave them alone). */
const TABLES = [
  'sales_orders',
  'invoices',
  'receipts',
  'allocations',
  'credit_notes',
  'trips',
  'picklists',
  'load_sheets',
  'supplier_invoices',
  'grns',
  'stock_ledger',
  'journal_entries',
  'memberships',
  'schemes',
  'vehicles',
  'beat_assignments',
  'visits',
  'bargain_requests',
  'location_consents',
] as const

/** What the doorway does with one request: cut the connection, answer 503 itself, or pass it on. */
type Verdict = 'drop' | 'refuse' | 'pass'

interface Doorway {
  url: string
  /** Requests the doorway answered itself (dropped or refused). */
  stopped: number
  close: () => Promise<void>
}

/**
 * A doorway between the tool and the API: every request passes through unchanged, except those `rule` names,
 * whose connection is cut (the API died) or which are answered 503 with a code (the API refused).
 */
async function doorway(target: string, rule: (method: string, path: string) => Verdict) {
  const t = new URL(target)
  const d: Doorway = { url: '', stopped: 0, close: () => Promise.resolve() }
  const server = createServer((req, res) => {
    const verdict = rule(req.method ?? 'GET', req.url ?? '/')
    if (verdict === 'drop') {
      d.stopped++
      req.socket.destroy()
      return
    }
    if (verdict === 'refuse') {
      d.stopped++
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: 'refused at the doorway' }))
      return
    }
    const up = request(
      {
        hostname: t.hostname,
        port: t.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(res)
      },
    )
    up.on('error', () => res.destroy())
    req.pipe(up)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  const address = server.address()
  d.url = `http://127.0.0.1:${String(typeof address === 'object' && address ? address.port : 0)}`
  d.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => {
        resolve()
      })
    })
  return d
}

describe.skipIf(!usable)('pnpm fill:demo — the whole run on a look-alike tenant', () => {
  const run = randomBytes(3).toString('hex')
  const slug = `look-${run}`
  const ownerUsername = `owner.look${run}`
  const ownerPassword = `Own3r${randomBytes(8).toString('hex')}`
  const staffUsername = `staff.look${run}`
  const staffPassword = newPassword()
  const suffix = run
  const today = todayIst()
  const yesterday = addDays(today, -1)
  /** `n` days before today: the healing cases run on the days before yesterday, one day each. */
  const daysAgo = (n: number) => addDays(today, -n)
  // Made in beforeAll, so a skipped suite leaves no folder and no pool behind.
  let dir = ''
  let loginsFile = ''
  let pool: ReturnType<typeof createPool>
  let all: AllInOne
  let api = ''
  let tenantId = ''
  let client: Api
  const hashesBefore = new Map<string, string>()
  const printed: string[] = []
  const results: RunResult[] = []
  /** The stand-in shop that was sent real money on account, and when (rule 3b). */
  let plantedShop = ''
  let plantedAt = new Date(0)
  /** A day's two vans: van 1's trip was planned the night before with the van load, van 2's in the morning. */
  const vans = (r: RunResult): number =>
    (r.summary.made.get('driver:trip planned') ?? 0) +
    (r.summary.found.get('driver:trip planned') ?? 0)

  const fill = (date: string, commit: boolean, through = api) =>
    runFill({
      api: through,
      tenant: slug,
      ownerUsername,
      ownerPassword,
      loginsFile,
      date,
      commit,
      loginSuffix: suffix,
      log: (line) => printed.push(line),
    }).then((r) => {
      printed.push(...r.summary.lines())
      if (commit) results.push(r)
      return r
    })

  const counts = async (): Promise<Record<string, number>> => {
    const out: Record<string, number> = {}
    for (const t of TABLES) {
      const r = await pool.query<{ n: number }>(
        `select count(*)::int as n from ${t} where tenant_id = $1`,
        [tenantId],
      )
      out[t] = r.rows[0]?.n ?? 0
    }
    return out
  }

  const passwordHashes = async (): Promise<Map<string, string>> => {
    const r = await pool.query<{ username: string; password_hash: string }>(
      `select username, password_hash from users where username = any($1)`,
      [[ownerUsername, staffUsername]],
    )
    return new Map(r.rows.map((x) => [x.username, x.password_hash]))
  }

  const tester = (key: TesterKey) => {
    const t = testersFor(suffix).find((x) => x.key === key)
    if (!t) throw new Error(`no tester ${key}`)
    return t
  }

  /** The tool's live offer, read as the owner: its id and the shops it is for. */
  const toolOffer = async (owner: Session, on: string) => {
    const live = await client.call(owner, contract.pricing.schemes.list, {
      activeOnly: true,
      on,
      limit: 200,
    })
    const offers = live.items.filter((s) => isDemoId(s.id))
    expect(offers, 'one live offer of the tool').toHaveLength(1)
    const offer = offers[0]
    return { id: offer?.id ?? '', shops: offer?.applicability.retailerIds ?? [] }
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'demo-fill-spec-'))
    loginsFile = join(dir, 'tester-logins.txt')
    pool = createPool(url, 2)
    process.env.NODE_ENV ??= 'test'
    process.env.OBJECT_STORAGE_DIR = join(dir, 'storage')
    const built = await buildLookalikeTenant(createDb(pool), {
      slug,
      ownerUsername,
      ownerPassword,
      asOf: today,
      hsnStem: `77${String(randomBytes(2).readUInt16BE(0) % 10_000).padStart(4, '0')}`,
    })
    tenantId = built.tenantId
    all = await createAllInOne({ logger: false })
    await new Promise<void>((resolve) => {
      all.server.listen(0, '127.0.0.1', () => {
        resolve()
      })
    })
    const address = all.server.address()
    api = `http://127.0.0.1:${String(typeof address === 'object' && address ? address.port : 0)}`
    client = new Api(api, 'spec')
    // One staff login of the distributor's own, the way the real one has five: the tool must never touch it.
    const owner = await client.signIn(ownerUsername, ownerPassword, slug)
    const temporary = newPassword()
    await client.call(owner, contract.tenancy.staff.create, {
      idempotencyKey: uuidv7(),
      id: uuidv7(),
      userId: uuidv7(),
      username: staffUsername,
      name: 'Rakesh More',
      phone: `+9198${String(randomBytes(4).readUInt32BE(0) % 100_000_000).padStart(8, '0')}`,
      role: 'manager',
      temporaryPassword: temporary,
    })
    const staff = await client.signIn(staffUsername, temporary, slug)
    await client.authCall(staff, authContract.changePassword, {
      currentPassword: temporary,
      newPassword: staffPassword,
    })
    await client.signOut(staff)
    await client.signOut(owner)
    for (const [k, v] of await passwordHashes()) hashesBefore.set(k, v)
  }, 240_000)

  afterAll(async () => {
    await all.close()
    await pool.end()
    rmSync(dir, { recursive: true, force: true })
  })

  it('a dry run writes nothing', async () => {
    const before = await counts()
    const dry = await fill(today, false)
    expect(dry.summary.totals().made).toBe(0)
    expect(dry.summary.totals().would).toBeGreaterThan(20)
    expect(await counts()).toEqual(before)
  }, 120_000)

  it('makes the first day with the day before it', async () => {
    const first = await fill(daysAgo(6), true)
    expect(first.leadIn).toBe(daysAgo(7))
    expect(first.exitCode).toBe(0)
    expect(first.summary.totals().refused).toBe(0)
    expect(statSync(loginsFile).mode & 0o777).toBe(0o600)
    expect(readLogins(loginsFile).size).toBe(7)
  }, 240_000)

  it('a stand-in shop that is sent real money on account is billed no more (rule 3b)', async () => {
    // The product applies a shop's money on account to every new bill of it (DOS-312). A real payment the shop
    // did not name a bill for, larger than all it owes, arrives for one of the stand-in shops: from now on the tool
    // must not bill that shop, or the real money would settle the tool's bill.
    const owner = await client.signIn(ownerUsername, ownerPassword, slug)
    const offer = await toolOffer(owner, daysAgo(6))
    plantedShop = [...offer.shops].sort()[2] ?? ''
    expect(plantedShop).not.toBe('')
    const dues = await client.call(owner, contract.receivables.outstanding.get, {
      retailerId: plantedShop,
      includeBills: false,
    })
    await client.call(owner, contract.receivables.receipts.create, {
      idempotencyKey: uuidv7(),
      id: uuidv7(),
      retailerId: plantedShop,
      mode: 'upi',
      amountPaise: dues.outstandingPaise + dues.undeliveredPaise + 10_000,
      reference: `9${String(randomBytes(6).readUIntBE(0, 6) % 100_000_000_000).padStart(11, '0')}`,
      strategy: 'none',
      note: 'Advance for next week',
    })
    plantedAt = new Date()
    await client.signOut(owner)
  }, 120_000)

  it('a step the API refuses is counted, the rest of the day is made, and the next run makes it', async () => {
    // Only the desk's "record a supplier bill": matching an earlier bill's line goes through.
    const door = await doorway(api, (method, path) =>
      method === 'POST' && path === '/manager/procurement/supplier-invoices' ? 'refuse' : 'pass',
    )
    const date = daysAgo(5)
    const hurt = await fill(date, true, door.url).finally(door.close)
    expect(door.stopped).toBe(2)
    expect(
      hurt.summary.refused.get('manager:supplier bill in review → 503 SERVICE_UNAVAILABLE'),
    ).toBe(1)
    expect(
      hurt.summary.refused.get('godown:supplier bill for the gate → 503 SERVICE_UNAVAILABLE'),
    ).toBe(1)
    expect(hurt.summary.totals().refused).toBe(2)
    // The rest of the day went on: orders taken, both vans out, their doors worked.
    expect(hurt.summary.made.get('sales:order taken')).toBeGreaterThan(0)
    expect(vans(hurt)).toBe(2)
    expect(hurt.summary.features.get('manager:supplier-bill-review')).toBe('missing')
    expect(hurt.summary.features.get('driver:trip-today')).toBe('there')
    expect(hurt.exitCode).toBe(0)

    const healed = await fill(date, true)
    expect(healed.summary.made.get('manager:supplier bill in review')).toBe(1)
    expect(healed.summary.made.get('godown:supplier bill for the gate')).toBe(1)
    expect(healed.summary.made.get('sales:order taken')).toBeUndefined()
    expect(healed.summary.made.get('driver:trip planned')).toBeUndefined()
    expect(healed.summary.features.get('manager:supplier-bill-review')).toBe('there')
    expect(healed.summary.totals().refused).toBe(0)
    expect(healed.exitCode).toBe(0)
  }, 240_000)

  it('the API stops answering while the standing pieces are read: a summary still, and the next run finishes the day', async () => {
    const door = await doorway(api, (method, path) =>
      method === 'GET' && path.startsWith('/owner/pricing/schemes') ? 'drop' : 'pass',
    )
    const date = daysAgo(4)
    const cut = await fill(date, true, door.url).finally(door.close)
    expect(door.stopped).toBeGreaterThan(0)
    expect([...cut.summary.refused.keys()].some((k) => k.endsWith('0 NO_RESPONSE'))).toBe(true)
    expect(cut.exitCode).toBe(1)
    expect(cut.summary.lines().some((l) => l.startsWith('rows written:'))).toBe(true)

    const healed = await fill(date, true)
    expect(healed.exitCode).toBe(0)
    expect(healed.summary.totals().refused).toBe(0)
    expect(vans(healed)).toBe(2)
    const again = await fill(date, true)
    expect(again.summary.totals().made).toBe(0)
  }, 240_000)

  it('a password changed by hand, then a lost logins file, are put right by the next run', async () => {
    const before = readFileSync(loginsFile)
    const driver = tester('driver1')
    const line = readLogins(loginsFile).get(driver.username)
    const s = await client.signIn(driver.username, line?.password ?? '', slug)
    await client.authCall(s, authContract.changePassword, {
      currentPassword: line?.password ?? '',
      newPassword: newPassword(),
    })
    await client.signOut(s)

    const date = daysAgo(3)
    const first = await fill(date, true)
    expect(first.summary.made.get('people:password reset')).toBe(1)
    expect(first.summary.made.get('people:password set')).toBe(1)
    expect(first.exitCode).toBe(0)
    expect(readFileSync(loginsFile).equals(before)).toBe(true)
    const back = await client.signIn(driver.username, line?.password ?? '', slug)
    expect(back.mustChangePassword).toBe(false)
    await client.signOut(back)

    unlinkSync(loginsFile)
    const lost = await fill(date, true)
    expect(lost.summary.made.get('people:password reset')).toBe(7)
    expect(lost.summary.made.get('people:password set')).toBe(7)
    expect(lost.summary.totals().made).toBe(14)
    expect(lost.summary.totals().refused).toBe(0)
    expect(statSync(loginsFile).mode & 0o777).toBe(0o600)
    expect(readLogins(loginsFile).size).toBe(7)
  }, 240_000)

  it('a stand-in shop that stops being one: the offer moves to the shop that takes its place', async () => {
    const owner = await client.signIn(ownerUsername, ownerPassword, slug)
    const made = daysAgo(3)
    const date = daysAgo(2)
    const was = await toolOffer(owner, made)
    expect(was.shops).toHaveLength(3)
    const gone = was.shops[0] ?? ''
    const shop = (await client.call(owner, contract.retailers.get, { id: gone })).item
    if (!('code' in shop)) throw new Error('the owner reads the staff shape of a shop')
    await client.call(owner, contract.retailers.upsert, {
      idempotencyKey: uuidv7(),
      id: shop.id,
      name: shop.name,
      ownerName: shop.ownerName,
      phone: shop.phone,
      altPhone: shop.altPhone,
      address: shop.address,
      beatId: shop.beatId,
      gstRegType: shop.gstRegType,
      gstin: shop.gstin,
      stateCode: shop.stateCode,
      active: false,
    })

    // The same day again: that day's vans still carry the closed shop as a stand-in, so it keeps the offer
    // beside the shop that replaces it, and every stand-in door of the day still has it.
    const sameDay = await fill(made, true)
    expect(sameDay.summary.made.get('masters:offer moved')).toBe(1)
    expect(sameDay.summary.made.get('masters:offer')).toBeUndefined()
    expect(sameDay.summary.features.get('shopkeeper:offer')).toBe('there')
    expect(sameDay.exitCode).toBe(0)
    const during = await toolOffer(owner, made)
    expect(during.id).toBe(was.id)
    expect(during.shops).toHaveLength(4)
    expect(during.shops).toEqual(expect.arrayContaining(was.shops))

    // The next day: its vans carry the new three, and the offer is theirs alone.
    const moved = await fill(date, true)
    expect(moved.summary.made.get('masters:offer moved')).toBe(1)
    expect(moved.summary.made.get('masters:offer')).toBeUndefined()
    expect(moved.summary.features.get('shopkeeper:offer')).toBe('there')
    expect(moved.exitCode).toBe(0)
    const now = await toolOffer(owner, date)
    expect(now.id).toBe(was.id)
    expect(now.shops).toHaveLength(3)
    expect(now.shops).not.toContain(gone)
    expect(now.shops.filter((x) => was.shops.includes(x))).toHaveLength(2)
    expect(during.shops).toEqual(expect.arrayContaining(now.shops))
    await client.signOut(owner)
  }, 240_000)

  it('makes yesterday, then today with yesterday finished', async () => {
    // Two real UPI payments already carry the references the tool would give van 1's UPI door of yesterday — the
    // one the tool gave before the fixes and its first try now (DOS-310: a UTR is used once): the tool takes its
    // next reference instead of being refused.
    const owner = await client.signIn(ownerUsername, ownerPassword, slug)
    const stop = demoId(tenantId, yesterday, 'stop', 'driver1', '2')
    const collection = demoId(tenantId, yesterday, 'collection', stop)
    const before = (BigInt(`0x${collection.replace(/-/g, '').slice(-15)}`) % 1_000_000_000_000n)
      .toString()
      .padStart(12, '1')
      .replace(/^0/, '7')
    const now = paymentReference(
      'upi',
      yesterday,
      demoId(tenantId, yesterday, 'receipt', stop),
      'driver1',
      0,
    )
    // Paid by a shop with no phone and no bill: never a stand-in (enough shops have a phone) nor a credit shop.
    const quiet = await pool.query<{ id: string }>(
      `select r.id from retailers r
        where r.tenant_id = $1 and r.phone = '' and r.active
          and not exists (select 1 from invoices i where i.tenant_id = r.tenant_id and i.retailer_id = r.id)
          and not exists (select 1 from sales_orders o where o.tenant_id = r.tenant_id and o.retailer_id = r.id)
        order by r.id limit 1`,
      [tenantId],
    )
    const other = quiet.rows[0]?.id
    for (const reference of [before, now])
      await client.call(owner, contract.receivables.receipts.create, {
        idempotencyKey: uuidv7(),
        id: uuidv7(),
        retailerId: other ?? '',
        mode: 'upi',
        amountPaise: 5_000,
        reference,
        strategy: 'none',
      })
    await client.signOut(owner)

    const first = await fill(yesterday, true)
    expect(first.leadIn).toBeNull()
    expect(first.exitCode).toBe(0)
    expect(first.summary.totals().refused).toBe(0)
    expect(first.summary.made.get('driver:paid upi')).toBe(2)
    expect(
      first.summary.notes.some((n) => /payment reference\(s\) the product named/.test(n)),
    ).toBe(true)
    expect(first.summary.made.get('masters:offer moved')).toBeUndefined()
    const second = await fill(today, true)
    expect(second.leadIn).toBeNull()
    expect(second.exitCode).toBe(0)
    expect(second.summary.totals().refused).toBe(0)
    expect(second.summary.made.get('accountant:trip settled')).toBe(2)
    // The van to load for tomorrow: van 1's trip of tomorrow planned tonight with its bills, and that trip's
    // sheet waiting for the manager (the product signs it off only once today's trip of van 1 is settled).
    expect(second.summary.made.get('godown:trip planned')).toBe(1)
    expect(second.summary.made.get('godown:van to load')).toBe(1)
    const sheet = await pool.query<{ trip_id: string | null; approved_at: Date | null }>(
      `select trip_id, approved_at from load_sheets where tenant_id = $1 and id = $2`,
      [tenantId, demoId(tenantId, today, 'sheet', 'van-to-load')],
    )
    expect(sheet.rows[0]?.trip_id).toBe(demoId(tenantId, addDays(today, 1), 'trip', 'driver1'))
    expect(sheet.rows[0]?.approved_at).toBeNull()
    // UPI money of the days before is confirmed at Day-end (DOS-256): none of the tool's is still in clearing.
    const upi = await pool.query<{ id: string; status: string }>(
      `select id, status::text as status from receipts where tenant_id = $1 and id like $2 and mode = 'upi'`,
      [tenantId, DEMO_ID_LIKE],
    )
    const earlierUpi = upi.rows.filter((r) => (demoIdDate(r.id) ?? today) < today)
    expect(earlierUpi.length).toBeGreaterThan(4)
    expect(earlierUpi.filter((r) => r.status !== 'deposited')).toEqual([])
    expect(statSync(loginsFile).mode & 0o777).toBe(0o600)
    expect(readLogins(loginsFile).size).toBe(7)
  }, 240_000)

  it('writes nothing when the same date is run again', async () => {
    const before = await counts()
    const again = await fill(today, true)
    expect(again.summary.totals().made).toBe(0)
    expect(again.summary.totals().refused).toBe(0)
    expect(await counts()).toEqual(before)
  }, 120_000)

  it('refuses to make a day before one it has already made', async () => {
    await expect(fill(addDays(yesterday, -3), true)).rejects.toThrow(/already made/)
  })

  it('leaves every role, signed in as its tester, on work', async () => {
    const owner = await client.signIn(ownerUsername, ownerPassword, slug)
    const sessions: CoverageSessions = { owner }
    const logins = readLogins(loginsFile)
    const opened: Session[] = [owner]
    const key: Record<TesterKey, keyof CoverageSessions> = {
      manager: 'manager',
      accounts: 'accountant',
      sales1: 'sales1',
      sales2: 'sales2',
      godown: 'godown',
      driver1: 'driver1',
      driver2: 'driver2',
    }
    for (const t of testersFor(suffix)) {
      const line = logins.get(t.username)
      expect(line, t.username).toBeDefined()
      const s = await client.signIn(t.username, line?.password ?? '', slug)
      expect(s.role).toBe(t.role)
      sessions[key[t.key]] = s
      opened.push(s)
    }
    const read = await allRows(client, sessions, today)
    const gaps = read.seen.filter((s) => !s.ok && !KNOWN_GAPS[`${s.row}:${s.feature}`])
    expect(gaps.map((g) => `${g.row}/${g.feature}: ${g.detail}`)).toEqual([])
    for (const s of opened) await client.signOut(s)
  }, 120_000)

  it('finds exactly the rows the runs made, and every rule of the books holds', async () => {
    const expected = expectedFromReports(
      results.map((r) => r.summary.toJSON() as { made: Record<string, number> }),
    )
    for (const k of TOOL_KINDS) {
      const r = await pool.query<{ n: number }>(k.sql, [tenantId, DEMO_ID_LIKE])
      expect(r.rows[0]?.n, k.kind).toBe(expected.get(k.kind))
    }
    for (const v of VIOLATIONS) {
      const r = await pool.query<{ id: string }>(
        v.sql,
        v.sql.includes('$2') ? [tenantId, DEMO_ID_LIKE] : [tenantId],
      )
      expect(
        r.rows.map((x) => x.id),
        v.what,
      ).toEqual([])
    }
    // What the tool's supplier bills leave behind that carries the API's own ids is counted too (rule 2).
    const derived = new Map<string, number>()
    for (const k of DERIVED_KINDS) {
      const r = await pool.query<{ n: number }>(k.sql, [tenantId, DEMO_ID_LIKE])
      derived.set(k.kind, r.rows[0]?.n ?? 0)
    }
    expect(derived.get("lots received on the tool's goods receipts")).toBeGreaterThan(0)
    expect(derived.get("purchase costs of the tool's lots")).toBeGreaterThan(0)
    expect(derived.get("supplier pack settings the tool's bills taught")).toBeGreaterThan(0)
    // Rule 3b: the stand-in shop sent real money on account got no bill of the tool after it, and its money is
    // on no bill of the tool.
    const billedAfter = await pool.query<{ n: number }>(
      `select count(*)::int as n from invoices
        where tenant_id = $1 and retailer_id = $2 and order_id like $3 and created_at > $4`,
      [tenantId, plantedShop, DEMO_ID_LIKE, plantedAt],
    )
    expect(billedAfter.rows[0]?.n).toBe(0)
    expect(VIOLATIONS.filter((v) => v.rule === '3b')).toHaveLength(2)
  })

  it('leaves the four release checks passing: nothing below zero, stranded, cancelled with stock, or paid twice', async () => {
    // The work the tool leaves open on purpose (a trip on the road, a van load waiting, a wave to pick) is work the
    // product can carry on; none of it may read as stranded (rule 7b).
    const db = createDb(pool)
    expect(await stockBelowZero(db, tenantId)).toEqual([])
    expect(
      (await receiptReferenceReport(db, tenantId)).duplicates.filter((d) => d.failing),
    ).toEqual([])
    expect(
      (await invoiceCancelFootprints(db, tenantId)).filter((f) => f.status === 'open'),
    ).toEqual([])
    const stranded = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'check-stranded.mts', '--tenant', slug, '--json'],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, DATABASE_URL: url },
        encoding: 'utf8',
      },
    )
    expect(stranded.status, stranded.stderr).toBe(0)
    expect(JSON.parse(stranded.stdout) as unknown[]).toEqual([])
  }, 120_000)

  it("leaves the distributor's own logins and their passwords alone", async () => {
    expect(await passwordHashes()).toEqual(hashesBefore)
    expect(hashesBefore.size).toBe(2)
    const r = await pool.query<{ n: number }>(
      `select count(*)::int as n from users where username like 'tester.owner%'`,
    )
    expect(r.rows[0]?.n).toBe(0)
    const staff = await client.signIn(staffUsername, staffPassword, slug)
    expect(staff.mustChangePassword).toBe(false)
    await client.signOut(staff)
  })

  it('prints no shop name, phone, GSTIN or address', async () => {
    const shops = await pool.query<{
      name: string
      phone: string
      gstin: string | null
      line1: string | null
    }>(
      `select name, phone, gstin, address->>'line1' as line1 from retailers where tenant_id = $1`,
      [tenantId],
    )
    const text = printed.join('\n')
    expect(printed.length).toBeGreaterThan(50)
    for (const s of shops.rows) {
      expect(text).not.toContain(s.name)
      if (s.phone) expect(text).not.toContain(s.phone.replace(/^\+91/, ''))
      if (s.gstin) expect(text).not.toContain(s.gstin)
      if (s.line1) expect(text).not.toContain(s.line1)
    }
  })
})
