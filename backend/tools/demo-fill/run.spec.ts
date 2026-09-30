import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync as writeFile,
} from 'node:fs'
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
  hashPassword,
  invoiceCancelFootprints,
  receiptReferenceReport,
  stockBelowZero,
  users,
} from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { buildLookalikeTenant, databaseName } from '../testing/lookalike.js'
import { Api, type Session } from './client.js'
import { allRows, type CoverageSessions } from './coverage.js'
import { paymentReference } from './helpers.js'
import { addDays, demoId, demoIdDate, isDemoId, stopIdOf, todayIst, tripIdOf } from './ids.js'
import {
  DEMO_PASSWORD,
  TESTERS,
  newPassword,
  readLogins,
  sortStaff,
  writeLogins,
  type TesterKey,
} from './people.js'
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
 * next run; the owner's and the existing staff's passwords are never touched. The failures are made by a
 * doorway between the tool and the API that cuts or refuses the requests a case names.
 *
 * The tester logins as the founder decided them on 2026-09-29: plain usernames, every one signing in with the
 * demo password and never asked to change it (D1, D2); a plain username the distributor's own staff holds, or a
 * person of another distributor holds (the API cannot show that one), is never taken and nobody else is touched —
 * the next free plain one is taken (D5); and a crew of testers the tool no longer uses is healed in one run (D6):
 * first a crew turned into what the tool left before that day (`tester.<role>` usernames, generated passwords in
 * the logins file), healed a day later; then that new crew in turn, healed on the SAME date it made (today's crew
 * takes its own shift of the date). Each time: the former logins switched off at the end, their trips on the road
 * finished by their own drivers (no procedure hands a trip to another driver), the van load they planned for the
 * next morning cancelled by the desk with its bills carried by the new vans, their reps' beats carried to the new
 * reps, every role open on work for the new crew, and nothing made twice; the same date again writes nothing.
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

/** A node script run as a child WITHOUT blocking this process (whose event loop serves the in-process API). */
function runNode(
  args: readonly string[],
  cwd: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...args], { cwd, env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')))
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf8')))
    child.on('close', (status) => {
      resolve({ status, stdout, stderr })
    })
  })
}

describe.skipIf(!usable)('pnpm fill:demo — the whole run on a look-alike tenant', () => {
  const run = randomBytes(3).toString('hex')
  const slug = `look-${run}`
  const ownerUsername = `owner.look${run}`
  const ownerPassword = `Own3r${randomBytes(8).toString('hex')}`
  const suffix = run
  /** The distributor's own godown man, whose username is the godown tester's plain one (D5). */
  const staffUsername = `godown.${suffix}`
  const staffPassword = newPassword()
  /** A person of ANOTHER distributor who holds the accountant tester's plain username: the API cannot show it (D5). */
  const strangerUsername = `accounts.${suffix}`
  /**
   * The crew of the tool before 2026-09-29 (D6): made with a suffix of its own, then turned into what that tool left
   * — `tester.<key>.<suffix>` usernames with generated passwords, which its logins file held.
   */
  const oldSuffix = `o${run.slice(0, 5)}`
  const oldUsername = (key: TesterKey) => `tester.${key}.${oldSuffix}`
  const oldPasswords = new Map<string, string>()
  /** A crew the tool made after that day and no longer uses (another suffix): healed on the date it made (D6). */
  const midSuffix = `m${run.slice(0, 5)}`
  const midUsername = (key: TesterKey) => `${key}.${midSuffix}`
  /** Today's crew: plain usernames, the two that are someone else's replaced by the next free plain ones. */
  const USERNAME: Record<TesterKey, string> = {
    manager: `manager.${suffix}`,
    accounts: `accounts2.${suffix}`,
    sales1: `sales1.${suffix}`,
    sales2: `sales2.${suffix}`,
    godown: `godown2.${suffix}`,
    driver1: `driver1.${suffix}`,
    driver2: `driver2.${suffix}`,
  }
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
  /** The bills of the van load the crew healed on its own date had planned: they ride the next morning's vans. */
  let midVanLoadBills: string[] = []
  /** A day's two vans: van 1's trip was planned the night before with the van load, van 2's in the morning. */
  const vans = (r: RunResult): number =>
    (r.summary.made.get('driver:trip planned') ?? 0) +
    (r.summary.found.get('driver:trip planned') ?? 0)

  const fill = (date: string, commit: boolean, through = api, crew = suffix) =>
    runFill({
      api: through,
      tenant: slug,
      ownerUsername,
      ownerPassword,
      loginsFile,
      date,
      commit,
      loginSuffix: crew,
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
      [[ownerUsername, staffUsername, strangerUsername]],
    )
    return new Map(r.rows.map((x) => [x.username, x.password_hash]))
  }

  /** A user's id by username. */
  const userIdOf = async (username: string): Promise<string> => {
    const r = await pool.query<{ id: string }>(`select id from users where username = $1`, [
      username,
    ])
    const id = r.rows[0]?.id
    if (!id) throw new Error(`no user ${username}`)
    return id
  }

  /** The distributor's staff as the owner reads them: username → status. */
  const staffStatus = async (): Promise<Map<string, string>> => {
    const owner = await client.signIn(ownerUsername, ownerPassword, slug)
    const staff = await client.call(owner, contract.tenancy.staff.list, {})
    await client.signOut(owner)
    return new Map(staff.items.map((m) => [m.username ?? m.userId, m.status]))
  }

  /** Every tester of a crew signs in with the demo password and is not asked to change it (D2). */
  const signInCrew = async (
    username: (key: TesterKey) => string = (key) => USERNAME[key],
  ): Promise<Map<TesterKey, Session>> => {
    const out = new Map<TesterKey, Session>()
    for (const t of TESTERS) {
      const s = await client.signIn(username(t.key), DEMO_PASSWORD, slug)
      expect(s.mustChangePassword, username(t.key)).toBe(false)
      expect(s.role).toBe(t.role)
      out.set(t.key, s)
    }
    return out
  }

  /** The user ids of a crew, by username. */
  const crewIds = (username: (key: TesterKey) => string): Promise<string[]> =>
    Promise.all(TESTERS.map((t) => userIdOf(username(t.key))))

  /** A former crew's open work (D6), read before its heal: its beats, its trips on the road, its van load. */
  const openWorkOf = async (ids: readonly string[], madeOn: string) => {
    const beats = await pool.query<{ beat_id: string }>(
      `select beat_id from beat_assignments where tenant_id = $1 and user_id = any($2) and valid_to is null order by beat_id`,
      [tenantId, ids],
    )
    const road = await pool.query<{ id: string }>(
      `select id from trips where tenant_id = $1 and trip_date = $2 and state = 'active' and driver_id = any($3) order by id`,
      [tenantId, madeOn, ids],
    )
    const vanLoad = await pool.query<{ id: string }>(
      `select id from trips where tenant_id = $1 and trip_date = $2 and state = 'planned' and driver_id = any($3)`,
      [tenantId, addDays(madeOn, 1), ids],
    )
    const onVanLoad = await pool.query<{ invoice_id: string }>(
      `select invoice_id from deliveries where tenant_id = $1 and trip_id = any($2)`,
      [tenantId, vanLoad.rows.map((r) => r.id)],
    )
    const doors = await pool.query<{ n: number }>(
      `select count(*)::int as n from deliveries where tenant_id = $1 and trip_id = any($2) and outcome is not null`,
      [tenantId, road.rows.map((r) => r.id)],
    )
    return {
      beats: beats.rows.map((r) => r.beat_id),
      road: road.rows.map((r) => r.id),
      vanLoad: vanLoad.rows.map((r) => r.id),
      onVanLoad: onVanLoad.rows.map((r) => r.invoice_id),
      doorsDone: doors.rows[0]?.n ?? 0,
    }
  }

  /**
   * What a heal on `healDate` must leave of a former crew (D6): its logins switched off, none of its trips open, its
   * trips on the road finished by their own drivers (every door on them recorded by the trip's driver, the desk
   * none), its van load cancelled — with every bill of it on one of the new crew's vans of `healDate` when the heal
   * is a day later, on no open trip (back on the planning board for the next morning) when it is the same date —
   * its beats the new reps' and its assignments ended the day before (a day later) or that day (the same date), its
   * waves of the days before `healDate` off the floor.
   */
  const expectHealed = async (
    before: Awaited<ReturnType<typeof openWorkOf>>,
    formerIds: readonly string[],
    formerNames: readonly string[],
    crew: (key: TesterKey) => string,
    healDate: string,
    sameDate: boolean,
  ): Promise<void> => {
    const endedOn = sameDate ? healDate : addDays(healDate, -1)
    const status = await staffStatus()
    for (const u of formerNames) expect(status.get(u), u).toBe('disabled')
    for (const t of TESTERS) expect(status.get(crew(t.key)), t.key).toBe('active')
    const open = await pool.query<{ n: number }>(
      `select count(*)::int as n from trips where tenant_id = $1 and driver_id = any($2)
          and state in ('planned', 'loading', 'active', 'closing')`,
      [tenantId, formerIds],
    )
    expect(open.rows[0]?.n, 'former trips still open').toBe(0)
    expect(before.road).toHaveLength(2)
    const road = await pool.query<{ state: string }>(
      `select state::text as state from trips where tenant_id = $1 and id = any($2)`,
      [tenantId, before.road],
    )
    expect(road.rows.map((r) => r.state)).toEqual(['settled', 'settled'])
    const doors = await pool.query<{ done: number; by_other: number }>(
      `select count(*) filter (where d.outcome is not null)::int as done,
              count(*) filter (where d.delivered_by is distinct from t.driver_id and d.outcome is not null)::int as by_other
         from deliveries d join trips t on t.id = d.trip_id where d.tenant_id = $1 and t.id = any($2)`,
      [tenantId, before.road],
    )
    expect(doors.rows[0]?.done).toBeGreaterThan(before.doorsDone)
    expect(doors.rows[0]?.by_other, 'doors of a former trip recorded by someone else').toBe(0)
    expect(before.vanLoad).toHaveLength(1)
    const cancelled = await pool.query<{ state: string }>(
      `select state::text as state from trips where tenant_id = $1 and id = $2`,
      [tenantId, before.vanLoad[0]],
    )
    expect(cancelled.rows[0]?.state).toBe('cancelled')
    expect(before.onVanLoad.length).toBeGreaterThan(0)
    if (!sameDate) {
      const vans = [
        tripIdOf(tenantId, healDate, 'driver1', await userIdOf(crew('driver1'))),
        tripIdOf(tenantId, healDate, 'driver2', await userIdOf(crew('driver2'))),
      ]
      const carried = await pool.query<{ n: number }>(
        `select count(distinct invoice_id)::int as n from deliveries where tenant_id = $1 and trip_id = any($2) and invoice_id = any($3)`,
        [tenantId, vans, before.onVanLoad],
      )
      expect(carried.rows[0]?.n).toBe(before.onVanLoad.length)
    } else {
      const riding = await pool.query<{ n: number }>(
        `select count(*)::int as n from deliveries d join trips t on t.id = d.trip_id
          where d.tenant_id = $1 and d.invoice_id = any($2) and t.state in ('planned', 'loading', 'active', 'closing')`,
        [tenantId, before.onVanLoad],
      )
      expect(riding.rows[0]?.n, 'bills of the cancelled van load on an open trip').toBe(0)
    }
    const beats = await pool.query<{ beat_id: string }>(
      `select beat_id from beat_assignments where tenant_id = $1 and user_id = any($2) and valid_to is null order by beat_id`,
      [tenantId, [await userIdOf(crew('sales1')), await userIdOf(crew('sales2'))]],
    )
    expect(beats.rows.map((r) => r.beat_id)).toEqual(before.beats)
    const ended = await pool.query<{ valid_to: string | null }>(
      `select valid_to::text as valid_to from beat_assignments where tenant_id = $1 and user_id = any($2) and beat_id = any($3)`,
      [tenantId, formerIds, before.beats],
    )
    expect(ended.rows.map((r) => r.valid_to)).toEqual(before.beats.map(() => endedOn))
    const waves = await pool.query<{ n: number }>(
      `select count(*)::int as n from picklists where tenant_id = $1 and id like $2 and status in ('open', 'picking', 'picked')
          and pick_date < $3`,
      [tenantId, DEMO_ID_LIKE, healDate],
    )
    expect(waves.rows[0]?.n).toBe(0)
    // One active login per tester, whatever crews came before.
    const roles = await pool.query<{ role: string; n: number }>(
      `select role::text as role, count(*)::int as n from memberships
        where tenant_id = $1 and user_id like $2 and status = 'active' and role <> 'retailer'
        group by 1 order by 1`,
      [tenantId, DEMO_ID_LIKE],
    )
    expect(roles.rows).toEqual([
      { role: 'accountant', n: 1 },
      { role: 'delivery', n: 2 },
      { role: 'manager', n: 1 },
      { role: 'salesperson', n: 2 },
      { role: 'warehouse', n: 1 },
    ])
    expect(await duplicates()).toEqual([])
    // The logins file lists the new crew and nobody else, each with the demo password — the testers, and the three
    // shopkeepers of the crew, who sign up by themselves (founder, 2026-09-29).
    const lines = readLogins(loginsFile)
    expect(
      [...lines.values()]
        .filter((l) => l.role !== 'retailer')
        .map((l) => l.username)
        .sort(),
    ).toEqual(TESTERS.map((t) => crew(t.key)).sort())
    expect([...lines.values()].filter((l) => l.role === 'retailer')).toHaveLength(3)
    for (const l of lines.values()) expect(l.password === DEMO_PASSWORD, l.username).toBe(true)
    expect(statSync(loginsFile).mode & 0o777).toBe(0o600)
  }

  /** Rows the tool must never make twice, by what they are and an id (never a name). */
  const duplicates = async (): Promise<string[]> => {
    const q = async (what: string, sql: string): Promise<string[]> =>
      (await pool.query<{ id: string }>(sql, [tenantId, DEMO_ID_LIKE])).rows.map(
        (r) => `${what}: ${r.id}`,
      )
    return [
      ...(await q(
        'an order with two live bills',
        `select order_id as id from invoices where tenant_id = $1 and order_id like $2
          and state not in ('cancelled', 'draft') group by 1 having count(*) > 1`,
      )),
      ...(await q(
        'a bill delivered twice',
        `select invoice_id as id from deliveries where tenant_id = $1 and trip_id like $2
          and outcome in ('delivered', 'partial') group by 1 having count(*) > 1`,
      )),
      ...(await q(
        'a shop twice on one trip',
        `select trip_id || '/' || retailer_id as id from trip_stops where tenant_id = $1 and trip_id like $2
          group by trip_id, retailer_id having count(*) > 1`,
      )),
      ...(await q(
        'a van on two open trips',
        `select vehicle_id as id from trips where tenant_id = $1 and id like $2
          and state in ('loading', 'active', 'closing') group by 1 having count(*) > 1`,
      )),
    ]
  }

  /** What each role opens on, signed in as today's crew (or the crew `username` names). */
  const coverageGaps = async (
    date: string,
    username?: (key: TesterKey) => string,
  ): Promise<string[]> => {
    const owner = await client.signIn(ownerUsername, ownerPassword, slug)
    const crew = await signInCrew(username)
    const sessions: CoverageSessions = {
      owner,
      manager: crew.get('manager'),
      accountant: crew.get('accounts'),
      sales1: crew.get('sales1'),
      sales2: crew.get('sales2'),
      godown: crew.get('godown'),
      driver1: crew.get('driver1'),
      driver2: crew.get('driver2'),
    }
    // shop1…3: the shopkeepers' own accounts, as the logins file lists them (founder, 2026-09-29).
    const shops: Session[] = []
    for (const line of readLogins(loginsFile).values()) {
      if (line.role !== 'retailer') continue
      const s = await client.signIn(line.username, DEMO_PASSWORD, slug, { account: true })
      if (s.tenantId !== owner.tenantId) await client.switchTo(s, owner.tenantId)
      shops.push(s)
    }
    sessions.shops = shops
    const read = await allRows(client, sessions, date)
    for (const s of [owner, ...crew.values(), ...shops]) await client.signOut(s)
    return read.seen
      .filter((s) => !s.ok && !KNOWN_GAPS[`${s.row}:${s.feature}`])
      .map((g) => `${g.row}/${g.feature}: ${g.detail}`)
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
    // Sign-ups are limited per client address per hour (founder, 2026-09-29), and every run of this suite signs its
    // crews' shopkeepers up from 127.0.0.1: a second run of the suite inside the hour would otherwise meet the limit.
    await pool.query(`delete from otp_rate_limits where key like 'signup:%'`)
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
    // One staff login of the distributor's own, the way the real one has five — its username the godown tester's
    // plain one: the tool must never touch it, nor take its name (D3, D5).
    const owner = await client.signIn(ownerUsername, ownerPassword, slug)
    const temporary = newPassword()
    await client.call(owner, contract.tenancy.staff.create, {
      idempotencyKey: uuidv7(),
      id: uuidv7(),
      userId: uuidv7(),
      username: staffUsername,
      name: 'Rakesh More',
      phone: `+9198${String(randomBytes(4).readUInt32BE(0) % 100_000_000).padStart(8, '0')}`,
      role: 'warehouse',
      temporaryPassword: temporary,
    })
    // A person of another distributor with the accountant tester's plain username (no membership here, so no
    // read of this distributor shows them).
    await createDb(pool)
      .insert(users)
      .values({
        id: uuidv7(),
        phone: `+9196${String(randomBytes(4).readUInt32BE(0) % 100_000_000).padStart(8, '0')}`,
        name: 'Mahesh Pawar',
        locale: 'en-IN',
        username: strangerUsername,
        passwordHash: await hashPassword(newPassword()),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        status: 'active',
      })
    const staff = await client.signIn(staffUsername, temporary, slug)
    await client.authCall(staff, authContract.changePassword, {
      currentPassword: temporary,
      newPassword: staffPassword,
    })
    await client.signOut(staff)
    await client.signOut(owner)
    for (const [k, v] of await passwordHashes()) hashesBefore.set(k, v)
    expect(hashesBefore.size).toBe(3)
  }, 600_000)

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
    // It already says which plain username is someone else's in this distributor (D5).
    expect(dry.summary.notes).toContain(
      `the plain username godown.${suffix} belongs to someone the tool did not make: its godown is godown2.${suffix}`,
    )
    expect(existsSync(loginsFile)).toBe(false)
  }, 600_000)

  it('makes the first day with the day before it, its testers signing in with the demo password (D1, D2)', async () => {
    // The crew the next case turns into the tool's crew before 2026-09-29 (D6).
    const first = await fill(daysAgo(7), true, api, oldSuffix)
    expect(first.leadIn).toBe(daysAgo(8))
    expect(first.exitCode).toBe(0)
    expect(first.summary.totals().refused).toBe(0)
    expect(statSync(loginsFile).mode & 0o777).toBe(0o600)
    const lines = readLogins(loginsFile)
    expect(
      [...lines.values()]
        .filter((l) => l.role !== 'retailer')
        .map((l) => l.username)
        .sort(),
    ).toEqual(TESTERS.map((t) => `${t.key}.${oldSuffix}`).sort())
    // shop1…3 of the crew: signed up by themselves and joined to their stand-in shops (founder, 2026-09-29).
    expect(
      [...lines.values()]
        .filter((l) => l.role === 'retailer')
        .map((l) => l.username)
        .sort(),
    ).toEqual(['shop1', 'shop2', 'shop3'].map((k) => `${k}.${oldSuffix}`))
    for (const [username, line] of lines) {
      expect(line.password === DEMO_PASSWORD, username).toBe(true)
      const s = await client.signIn(username, DEMO_PASSWORD, slug)
      expect(s.mustChangePassword, username).toBe(false)
      await client.signOut(s)
    }
  }, 600_000)

  it('heals a database of the tool before 2026-09-29 a day later, in one run (D6)', async () => {
    // What the tool before the founder's decision left: `tester.<key>` usernames with generated passwords, which
    // its logins file held (the usernames and passwords set here as that tool had them; nothing else changes).
    for (const t of TESTERS) {
      const password = newPassword()
      oldPasswords.set(oldUsername(t.key), password)
      await pool.query(`update users set username = $2, password_hash = $3 where username = $1`, [
        `${t.key}.${oldSuffix}`,
        oldUsername(t.key),
        await hashPassword(password),
      ])
    }
    writeLogins(
      loginsFile,
      slug,
      TESTERS.map((t) => ({
        username: oldUsername(t.key),
        password: oldPasswords.get(oldUsername(t.key)) ?? '',
        role: t.role,
      })),
    )
    const formerIds = await crewIds(oldUsername)
    const before = await openWorkOf(formerIds, daysAgo(7))

    const heal = await fill(daysAgo(6), true, api, midSuffix)
    expect(heal.leadIn).toBeNull()
    expect(heal.exitCode).toBe(0)
    expect(heal.summary.totals().refused).toBe(0)
    expect(heal.summary.made.get('people:tester login')).toBe(7)
    expect(heal.summary.made.get('people:password set')).toBe(7)
    expect(heal.summary.made.get('people:former tester login switched off')).toBe(7)
    // The former drivers signed in with the passwords their logins file held: no password of theirs was reset.
    expect(heal.summary.made.get('people:former login password reset')).toBeUndefined()
    expect(
      heal.summary.made.get(
        'yesterday:trip of a former driver cancelled, its bills back on the board',
      ),
    ).toBe(1)
    for (const [n, id] of before.road.entries())
      expect(
        heal.summary.notes.some((x) =>
          x.startsWith(
            `trip ${id} of ${daysAgo(7)} (active) cannot be handed to another driver: tester.driver`,
          ),
        ),
        `road ${String(n)}`,
      ).toBe(true)
    await expectHealed(
      before,
      formerIds,
      TESTERS.map((t) => oldUsername(t.key)),
      midUsername,
      daysAgo(6),
      false,
    )
    expect(await coverageGaps(daysAgo(6), midUsername)).toEqual([])
  }, 600_000)

  it('takes its own shift of a date a former crew made, and never takes or touches a plain username that is someone else’s (D5, D6)', async () => {
    const formerIds = await crewIds(midUsername)
    const before = await openWorkOf(formerIds, daysAgo(6))

    const heal = await fill(daysAgo(6), true)
    expect(heal.leadIn).toBeNull()
    expect(heal.exitCode).toBe(0)
    expect(heal.summary.totals().refused).toBe(0)
    // Seven testers made; the two plain usernames that are someone else's were asked about, never given a login.
    expect(heal.summary.made.get('people:tester login')).toBe(7)
    expect(heal.summary.made.get('people:login given to someone else switched off')).toBeUndefined()
    expect(heal.summary.made.get('people:password set')).toBe(7)
    expect(heal.summary.made.get('people:former tester login switched off')).toBe(7)
    // The van load the former crew planned for the next morning is cancelled in this same run.
    expect(
      heal.summary.made.get(
        'yesterday:trip of a former driver cancelled, its bills back on the board',
      ),
    ).toBe(1)
    expect(heal.summary.notes).toEqual(
      expect.arrayContaining([
        `the plain username godown.${suffix} belongs to someone the tool did not make: its godown is godown2.${suffix}`,
        `the plain username accounts.${suffix} belongs to someone the tool did not make: its accounts is accounts2.${suffix}`,
        `${daysAgo(6)} was already made by tester logins the tool no longer uses: today's testers take their own shift of it (s2), after the former drivers finished and checked in their trips (D6)`,
      ]),
    )
    for (const id of before.road)
      expect(
        heal.summary.notes.some((x) =>
          x.startsWith(
            `trip ${id} of ${daysAgo(6)} (active) cannot be handed to another driver: driver`,
          ),
        ),
      ).toBe(true)
    await expectHealed(
      before,
      formerIds,
      TESTERS.map((t) => midUsername(t.key)),
      (k) => USERNAME[k],
      daysAgo(6),
      true,
    )
    // The distributor's own godown man and the stranger are untouched: no login of this distributor was given to
    // the stranger, and neither password changed (checked again at the end).
    const status = await staffStatus()
    expect(status.get(staffUsername)).toBe('active')
    expect(status.has(strangerUsername)).toBe(false)
    const stranger = await pool.query<{ n: number }>(
      `select count(*)::int as n from memberships m join users u on u.id = m.user_id where u.username = $1`,
      [strangerUsername],
    )
    expect(stranger.rows[0]?.n).toBe(0)
    // The new crew's own work of that date: its vans out with its doors, its reps' orders, every role on work.
    for (const van of ['driver1', 'driver2'] as const) {
      const trip = await pool.query<{ state: string; n: number }>(
        `select t.state::text as state, (select count(*)::int from trip_stops s where s.trip_id = t.id) as n
           from trips t where t.tenant_id = $1 and t.id = $2`,
        [tenantId, tripIdOf(tenantId, daysAgo(6), van, await userIdOf(USERNAME[van]))],
      )
      expect(trip.rows[0]?.state, van).toBe('active')
      expect(trip.rows[0]?.n, van).toBeGreaterThanOrEqual(6)
    }
    // Each new driver granted its own GPS consent (not a replay of the former driver's of the same date).
    const consents = await pool.query<{ n: number }>(
      `select count(distinct user_id)::int as n from location_consents
        where tenant_id = $1 and user_id = any($2) and granted and withdrawn_at is null`,
      [tenantId, [await userIdOf(USERNAME.driver1), await userIdOf(USERNAME.driver2)]],
    )
    expect(consents.rows[0]?.n).toBe(2)
    expect(await coverageGaps(daysAgo(6))).toEqual([])
    midVanLoadBills = before.onVanLoad

    // The same date again: nothing written.
    const counted = await counts()
    const again = await fill(daysAgo(6), true)
    expect(again.summary.totals().made).toBe(0)
    expect(again.summary.totals().refused).toBe(0)
    expect(await counts()).toEqual(counted)
  }, 600_000)

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
  }, 600_000)

  it('a step the API refuses is counted, the rest of the day is made, and the next run makes it', async () => {
    // Only the desk's "record a supplier bill": matching an earlier bill's line goes through.
    const door = await doorway(api, (method, path) =>
      method === 'POST' && path === '/manager/procurement/supplier-invoices' ? 'refuse' : 'pass',
    )
    const date = daysAgo(5)
    const hurt = await fill(date, true, door.url).finally(door.close)
    // The run after the real money arrived says it leaves that one shop out (rule 3b), in counts only.
    expect(
      hurt.summary.notes.filter((n) =>
        n.startsWith('shops left out: 1 billed by the tool no more'),
      ),
    ).toHaveLength(1)
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
    // The van load the former crew had planned for this morning, cancelled by the heal of the day before: its bills
    // ride this morning's vans of today's crew (D6).
    expect(midVanLoadBills.length).toBeGreaterThan(0)
    const vansOfTheDay = [
      tripIdOf(tenantId, date, 'driver1', await userIdOf(USERNAME.driver1)),
      tripIdOf(tenantId, date, 'driver2', await userIdOf(USERNAME.driver2)),
    ]
    const carried = await pool.query<{ n: number }>(
      `select count(distinct invoice_id)::int as n from deliveries where tenant_id = $1 and trip_id = any($2) and invoice_id = any($3)`,
      [tenantId, vansOfTheDay, midVanLoadBills],
    )
    expect(carried.rows[0]?.n).toBe(midVanLoadBills.length)

    const healed = await fill(date, true)
    expect(healed.summary.made.get('manager:supplier bill in review')).toBe(1)
    expect(healed.summary.made.get('godown:supplier bill for the gate')).toBe(1)
    expect(healed.summary.made.get('sales:order taken')).toBeUndefined()
    expect(healed.summary.made.get('driver:trip planned')).toBeUndefined()
    expect(healed.summary.features.get('manager:supplier-bill-review')).toBe('there')
    expect(healed.summary.totals().refused).toBe(0)
    expect(healed.exitCode).toBe(0)
  }, 600_000)

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
  }, 600_000)

  it('a password changed by hand, then a lost logins file, are put right by the next run', async () => {
    const before = readFileSync(loginsFile)
    const driver = USERNAME.driver1
    const s = await client.signIn(driver, DEMO_PASSWORD, slug)
    await client.authCall(s, authContract.changePassword, {
      currentPassword: DEMO_PASSWORD,
      newPassword: newPassword(),
    })
    await client.signOut(s)

    const date = daysAgo(3)
    const first = await fill(date, true)
    expect(first.summary.made.get('people:password reset')).toBe(1)
    expect(first.summary.made.get('people:password set')).toBe(1)
    expect(first.exitCode).toBe(0)
    expect(readFileSync(loginsFile).equals(before)).toBe(true)
    const back = await client.signIn(driver, DEMO_PASSWORD, slug)
    expect(back.mustChangePassword).toBe(false)
    await client.signOut(back)

    // The file is only a list of who exists: lost, it is written again and no password is touched.
    unlinkSync(loginsFile)
    const lost = await fill(date, true)
    expect(lost.summary.totals().made).toBe(0)
    expect(lost.summary.totals().refused).toBe(0)
    expect(statSync(loginsFile).mode & 0o777).toBe(0o600)
    expect(readFileSync(loginsFile).equals(before)).toBe(true)
  }, 600_000)

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
  }, 600_000)

  it('makes yesterday, then today with yesterday finished', async () => {
    // Two real UPI payments already carry the references the tool would give van 1's UPI door of yesterday — the
    // one the tool gave before the fixes and its first try now (DOS-310: a UTR is used once): the tool takes its
    // next reference instead of being refused.
    const owner = await client.signIn(ownerUsername, ownerPassword, slug)
    const driver1 = await userIdOf(USERNAME.driver1)
    const stop = stopIdOf(tenantId, yesterday, tripIdOf(tenantId, yesterday, 'driver1', driver1), 2)
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
    expect(sheet.rows[0]?.trip_id).toBe(tripIdOf(tenantId, addDays(today, 1), 'driver1', driver1))
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
    // Seven testers and the three shopkeepers.
    expect(readLogins(loginsFile).size).toBe(10)
  }, 600_000)

  it('writes nothing when the same date is run again', async () => {
    const before = await counts()
    const again = await fill(today, true)
    expect(again.summary.totals().made).toBe(0)
    expect(again.summary.totals().refused).toBe(0)
    expect(await counts()).toEqual(before)
  }, 600_000)

  it('refuses to make a day before one it has already made', async () => {
    await expect(fill(addDays(yesterday, -3), true)).rejects.toThrow(/already made/)
  })

  it('makes shop1…3 the way a shopkeeper does: signed up alone, asked by the shop code, approved by the manager', async () => {
    const logins = [...readLogins(loginsFile).values()].filter((l) => l.role === 'retailer')
    expect(logins.map((l) => l.username).sort()).toEqual(
      [`shop1.${suffix}`, `shop2.${suffix}`, `shop3.${suffix}`].sort(),
    )
    const manager = await userIdOf(USERNAME.manager)
    const reached = new Set<string>()
    for (const line of logins) {
      expect(line.password === DEMO_PASSWORD, line.username).toBe(true)
      const s = await client.signIn(line.username, DEMO_PASSWORD, slug, { account: true })
      expect(s.mustChangePassword, line.username).toBe(false)
      expect(s.account, line.username).toBeUndefined()
      expect(s.role).toBe('retailer')
      const mine = await client.call(s, contract.retailers.list, { limit: 50, activeOnly: false })
      // One stand-in shop, and a second when its first was closed and replaced (the case above).
      expect(mine.items.length, line.username).toBeGreaterThanOrEqual(1)
      for (const shop of mine.items) reached.add(shop.id)
      await client.signOut(s)
      // The account is the shopkeeper's own, and it was joined by the tool's manager approving its request.
      const person = await pool.query<{ signed_up: boolean; changes: boolean }>(
        `select signed_up_at is not null as signed_up, must_change_password as changes from users where username = $1`,
        [line.username],
      )
      expect(person.rows[0]).toEqual({ signed_up: true, changes: false })
      const asked = await pool.query<{ via: string; state: string; decided_by: string }>(
        `select r.via::text as via, r.state::text as state, r.decided_by from shop_join_requests r
           join users u on u.id = r.user_id where u.username = $1 and r.tenant_id = $2 and r.state = 'approved'`,
        [line.username, tenantId],
      )
      expect(asked.rows.length, line.username).toBeGreaterThan(0)
      for (const r of asked.rows)
        expect(r).toEqual({ via: 'code', state: 'approved', decided_by: manager })
    }
    expect(reached.size).toBeGreaterThanOrEqual(3)
  }, 600_000)

  it('leaves every role, signed in as its tester with the demo password, on work', async () => {
    const logins = readLogins(loginsFile)
    for (const t of TESTERS) {
      const line = logins.get(USERNAME[t.key])
      expect(line?.role, t.key).toBe(t.role)
      expect(line?.password === DEMO_PASSWORD, t.key).toBe(true)
    }
    // The tool finds them the same way, by its mark, whatever their usernames.
    const owner = await client.signIn(ownerUsername, ownerPassword, slug)
    const staff = await client.call(owner, contract.tenancy.staff.list, {})
    await client.signOut(owner)
    const { crew } = sortStaff(tenantId, staff.items, suffix)
    expect(Object.fromEntries([...crew].map(([k, m]) => [k, m.username]))).toEqual(USERNAME)
    expect(await coverageGaps(today)).toEqual([])
    expect(await duplicates()).toEqual([])
  }, 600_000)

  it('check:demo-coverage signs the shopkeepers in on their own accounts and reads every row, the shopkeeper’s included, as made', async () => {
    const passwordFile = join(dir, 'owner.pw')
    writeFile(passwordFile, `${ownerPassword}\n`, { mode: 0o600 })
    const json = join(dir, 'coverage.json')
    // Spawned WITHOUT blocking: the API it reads is booted in this very process.
    const check = await runNode(
      [
        '--import',
        'tsx',
        'check-demo-coverage.mts',
        '--api',
        api,
        '--tenant',
        slug,
        '--owner-username',
        ownerUsername,
        '--owner-password-file',
        passwordFile,
        '--logins-file',
        loginsFile,
        '--login-suffix',
        suffix,
        '--date',
        today,
        '--json',
        json,
      ],
      fileURLToPath(new URL('..', import.meta.url)),
    )
    unlinkSync(passwordFile)
    expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0)
    const read = JSON.parse(readFileSync(json, 'utf8')) as {
      failed: number
      rows: { row: string; feature: string; state: string; detail: string }[]
    }
    expect(read.failed).toBe(0)
    const login = read.rows.find((r) => r.row === 'shopkeeper' && r.feature === 'login')
    expect(login?.state).toBe('ok')
    expect(read.rows.filter((r) => r.row === 'shopkeeper').every((r) => r.state === 'ok')).toBe(
      true,
    )
    // Rule 5: what the check prints names no password.
    expect(check.stdout.includes(DEMO_PASSWORD)).toBe(false)
    expect(check.stdout.includes(ownerPassword)).toBe(false)
  }, 600_000)

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
  }, 600_000)

  it("leaves the owner's and the distributor's own logins and their passwords alone (D3, D5)", async () => {
    expect(await passwordHashes()).toEqual(hashesBefore)
    expect(hashesBefore.size).toBe(3)
    // No owner login is made, and no `tester.` login of the tool before 2026-09-29 is on any more (D1, D6).
    const r = await pool.query<{ n: number }>(
      `select count(*)::int as n from memberships m join users u on u.id = m.user_id
        where m.tenant_id = $1 and m.status = 'active' and (u.username like 'tester.%' or u.username = 'owner')`,
      [tenantId],
    )
    expect(r.rows[0]?.n).toBe(0)
    const staff = await client.signIn(staffUsername, staffPassword, slug)
    expect(staff.mustChangePassword).toBe(false)
    await client.signOut(staff)
    const status = await staffStatus()
    expect(status.get(staffUsername)).toBe('active')
    // The stranger's own user is as it was, and the API never gave them a login of this distributor.
    const stranger = await pool.query<{ status: string; must_change_password: boolean }>(
      `select status::text as status, must_change_password from users where username = $1`,
      [strangerUsername],
    )
    expect(stranger.rows[0]).toEqual({ status: 'active', must_change_password: false })
    expect(status.has(strangerUsername)).toBe(false)
  })

  it('prints no shop name, phone, GSTIN or address, and no password (rule 5, D4)', async () => {
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
    expect(text.includes(DEMO_PASSWORD)).toBe(false)
    expect(text.includes(ownerPassword)).toBe(false)
    expect(text.includes(staffPassword)).toBe(false)
    expect(oldPasswords.size).toBe(7)
    for (const p of oldPasswords.values()) expect(text.includes(p)).toBe(false)
    const reports = JSON.stringify(results.map((x) => x.summary.toJSON()))
    expect(reports.includes(DEMO_PASSWORD)).toBe(false)
    for (const p of oldPasswords.values()) expect(reports.includes(p)).toBe(false)
    for (const s of shops.rows) {
      expect(text).not.toContain(s.name)
      if (s.phone) expect(text).not.toContain(s.phone.replace(/^\+91/, ''))
      if (s.gstin) expect(text).not.toContain(s.gstin)
      if (s.line1) expect(text).not.toContain(s.line1)
    }
  })
})
