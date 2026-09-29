import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAllInOne, type AllInOne } from '@dos/core'
import { createDb, createPool } from '@dos/db'
import { buildLookalikeTenant, databaseName } from '../testing/lookalike.js'
import { Api, type Session } from './client.js'
import { allRows, type CoverageSessions } from './coverage.js'
import { addDays, todayIst } from './ids.js'
import { readLogins, testersFor, type TesterKey } from './people.js'
import { DEMO_ID_LIKE, TOOL_KINDS, VIOLATIONS, expectedFromReports } from './rows.js'
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

describe.skipIf(!usable)('pnpm fill:demo — the whole run on a look-alike tenant', () => {
  const run = randomBytes(3).toString('hex')
  const slug = `look-${run}`
  const ownerUsername = `owner.look${run}`
  const ownerPassword = `Own3r${randomBytes(8).toString('hex')}`
  const suffix = run
  const today = todayIst()
  const yesterday = addDays(today, -1)
  // Made in beforeAll, so a skipped suite leaves no folder and no pool behind.
  let dir = ''
  let loginsFile = ''
  let pool: ReturnType<typeof createPool>
  let all: AllInOne
  let api = ''
  let tenantId = ''
  const printed: string[] = []
  const results: RunResult[] = []

  const fill = (date: string, commit: boolean) =>
    runFill({
      api,
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

  it('makes yesterday (and the day before it, as the first run), then today with yesterday finished', async () => {
    const first = await fill(yesterday, true)
    results.push(first)
    expect(first.leadIn).toBe(addDays(yesterday, -1))
    expect(first.exitCode).toBe(0)
    expect(first.summary.totals().refused).toBe(0)
    const second = await fill(today, true)
    results.push(second)
    expect(second.leadIn).toBeNull()
    expect(second.exitCode).toBe(0)
    expect(second.summary.totals().refused).toBe(0)
    expect(second.summary.made.get('accountant:trip settled')).toBe(2)
    expect(statSync(loginsFile).mode & 0o777).toBe(0o600)
    expect(readLogins(loginsFile).size).toBe(7)
  }, 240_000)

  it('writes nothing when the same date is run again', async () => {
    const before = await counts()
    const again = await fill(today, true)
    results.push(again)
    expect(again.summary.totals().made).toBe(0)
    expect(again.summary.totals().refused).toBe(0)
    expect(await counts()).toEqual(before)
  }, 120_000)

  it('refuses to make a day before one it has already made', async () => {
    await expect(fill(addDays(yesterday, -3), true)).rejects.toThrow(/already made/)
  })

  it('leaves every role, signed in as its tester, on work', async () => {
    const client = new Api(api, 'spec')
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
