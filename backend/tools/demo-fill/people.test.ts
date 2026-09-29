import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkCommonArgs } from './args.js'
import {
  TESTERS,
  newPassword,
  readLogins,
  readPasswordFile,
  testerPhone,
  testersFor,
  writeLogins,
} from './people.js'
import { expectedFromReports, TOOL_KINDS, VIOLATIONS } from './rows.js'
import { ROW_FEATURES, ROWS, Summary } from './summary.js'

const dir = mkdtempSync(join(tmpdir(), 'demo-fill-people-'))
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the tester people', () => {
  it("are the brief's usernames, no owner and no shopkeeper, with names of real-sounding people", () => {
    expect(TESTERS.map((t) => t.username)).toEqual([
      'tester.manager',
      'tester.accounts',
      'tester.sales1',
      'tester.sales2',
      'tester.godown',
      'tester.driver1',
      'tester.driver2',
    ])
    for (const t of TESTERS) {
      expect(t.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
      expect(t.name.toLowerCase()).not.toMatch(/tester|demo|test/)
    }
    expect(TESTERS.map((t) => t.role)).not.toContain('owner')
  })

  it('carry a suffix for a second distributor on the same database, and refuse a bad one', () => {
    expect(testersFor('sai').map((t) => t.username)[0]).toBe('tester.manager.sai')
    expect(testersFor().map((t) => t.username)).toEqual(TESTERS.map((t) => t.username))
    expect(() => testersFor('Bad Suffix')).toThrow()
    for (const t of testersFor('abcd1234')) expect(t.username.length).toBeLessThanOrEqual(32)
  })

  it('get a phone of the +91 70 block that is nobody else in the distributor', () => {
    const first = testerPhone('t', 'tester.manager', new Set())
    expect(first).toMatch(/^\+9170\d{8}$/)
    expect(testerPhone('t', 'tester.manager', new Set([first]))).not.toBe(first)
  })

  it('get passwords the policy takes: 16 letters and digits, with both, never the same twice', () => {
    const seen = new Set<string>()
    for (let n = 0; n < 50; n++) {
      const p = newPassword()
      expect(p).toMatch(/^[A-Za-z0-9]{16}$/)
      expect(p).toMatch(/\d/)
      expect(p).toMatch(/[A-Za-z]/)
      seen.add(p)
    }
    expect(seen.size).toBe(50)
  })

  it('keep their passwords in a file of mode 600 that reads back the same', () => {
    const path = join(dir, 'logins.txt')
    writeFileSync(path, 'x', { mode: 0o644 })
    writeLogins(path, 'tarsun', [
      { username: 'tester.manager', password: 'Abcdefgh12345678', role: 'manager' },
      { username: 'tester.driver1', password: 'Zyxwvuts98765432', role: 'delivery' },
    ])
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const back = readLogins(path)
    expect(back.get('tester.driver1')?.password).toBe('Zyxwvuts98765432')
    expect(back.size).toBe(2)
    expect(readLogins(join(dir, 'absent.txt')).size).toBe(0)
    writeFileSync(join(dir, 'pw'), '\n  S3cretPassw0rd  \n')
    expect(readPasswordFile(join(dir, 'pw'))).toBe('S3cretPassw0rd')
    expect(readFileSync(path, 'utf8')).toContain('username<TAB>password<TAB>role')
  })
})

describe('the arguments', () => {
  const ok = {
    api: 'http://127.0.0.1:3100/',
    tenant: 'tarsun',
    'owner-password-file': '/x/pw',
    'logins-file': '/x/logins',
  }
  const now = Date.parse('2026-09-29T02:00:00Z')

  it('take an API on this machine, a slug and the two files; the date defaults to today in IST', () => {
    const args = checkCommonArgs(ok, now)
    expect(args).toEqual({
      api: 'http://127.0.0.1:3100',
      tenant: 'tarsun',
      ownerUsername: 'owner.tarsun',
      passwordFile: '/x/pw',
      loginsFile: '/x/logins',
      date: '2026-09-29',
      loginSuffix: undefined,
    })
  })

  it('refuse another host, a date to come, a bad date, a bad slug, a missing file', () => {
    expect(checkCommonArgs({ ...ok, api: 'https://api.distributionos.in' }, now)).toHaveProperty(
      'refused',
    )
    expect(
      checkCommonArgs({ ...ok, api: 'https://api.distributionos.in', 'allow-remote': true }, now),
    ).not.toHaveProperty('refused')
    expect(checkCommonArgs({ ...ok, date: '2026-09-30' }, now)).toHaveProperty('refused')
    expect(checkCommonArgs({ ...ok, date: '29/09/2026' }, now)).toHaveProperty('refused')
    expect(checkCommonArgs({ ...ok, tenant: 'Tarsun Enterprises' }, now)).toHaveProperty('refused')
    expect(checkCommonArgs({ ...ok, 'logins-file': undefined }, now)).toHaveProperty('refused')
    expect(checkCommonArgs({ ...ok, 'login-suffix': 'x y' }, now)).toHaveProperty('refused')
  })
})

describe('the summary', () => {
  const all = (s: Summary, except: string[] = []) => {
    for (const row of ROWS)
      for (const f of ROW_FEATURES[row])
        if (!except.includes(`${row}:${f}`)) s.feature(row, f, 'there')
  }

  it('calls the shopkeeper row "partly" for the known gap alone, and the run still exits 0', () => {
    const s = new Summary()
    all(s, ['shopkeeper:login'])
    s.feature('shopkeeper', 'login', 'gap')
    expect(s.rowState('shopkeeper').state).toBe('partly')
    expect(s.rowState('driver').state).toBe('made')
    expect(s.exitCode()).toBe(0)
  })

  it('exits 1 only when a whole row could not be produced', () => {
    const s = new Summary()
    all(s)
    for (const f of ['trip-today', 'doors-paid', 'door-part', 'door-refused', 'doors-to-do'])
      s.feature('driver', f, 'missing')
    expect(s.rowState('driver').state).toBe('not made')
    expect(s.exitCode()).toBe(1)
  })

  it('keeps the worst answer of a feature read twice (one per van)', () => {
    const s = new Summary()
    s.feature('driver', 'door-part', 'there')
    s.feature('driver', 'door-part', 'missing')
    s.feature('driver', 'door-part', 'there')
    expect(s.features.get('driver:door-part')).toBe('missing')
  })

  it('says "would" in a dry run, and counts a refusal with its code only', () => {
    const s = new Summary()
    s.dryRun = true
    all(s)
    expect(s.rowState('owner').state).toBe('would be made')
    s.refusedOne('driver', 'departed', '409 CONFLICT')
    expect(s.lines().join('\n')).toContain('driver:departed → 409 CONFLICT')
  })
})

describe('the marker check', () => {
  it('sums what the runs made per kind, and ignores a step that makes no row of its own', () => {
    const expected = expectedFromReports([
      {
        made: {
          'driver:order taken': 7,
          'godown:order taken': 4,
          'driver:paid cash': 2,
          'driver:door part': 2,
        },
      },
      { made: { 'sales:order taken': 2, 'accountant:cheque at the counter': 1 } },
    ])
    expect(expected.get('orders')).toBe(13)
    expect(expected.get('receipts')).toBe(3)
    expect(expected.get('trips')).toBe(0)
    expect([...expected.keys()]).toEqual(TOOL_KINDS.map((k) => k.kind))
  })

  it('asks only for counts or ids, scoped to one distributor', () => {
    for (const q of [...TOOL_KINDS.map((k) => k.sql), ...VIOLATIONS.map((v) => v.sql)]) {
      expect(q).toContain('$1')
      expect(q).not.toMatch(/\b(name|phone|gstin|address)\b/)
      expect(q.trim().toLowerCase()).toMatch(/^(select|with)/)
    }
  })
})
