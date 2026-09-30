import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { validatePassword } from '@dos/db'
import { checkCommonArgs } from './args.js'
import { ApiRefusal } from './client.js'
import { demoId } from './ids.js'
import {
  DEMO_PASSWORD,
  SHOP_USERNAMES,
  SHOPKEEPERS,
  isShopUsername,
  shopKeyOf,
  shopPersonId,
  shopUsernameCandidates,
  TESTERS,
  TESTER_KEYS,
  crewKeyOf,
  formerKeyOf,
  loginsText,
  newPassword,
  personId,
  plainUsername,
  readLogins,
  readPasswordFile,
  sortStaff,
  testerPhone,
  usernameCandidates,
  writeLogins,
} from './people.js'
import { expectedFromReports, TOOL_KINDS, VIOLATIONS } from './rows.js'
import { probeAnswer } from './setup.js'
import { ROW_FEATURES, ROWS, Summary } from './summary.js'

const dir = mkdtempSync(join(tmpdir(), 'demo-fill-people-'))
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const TENANT = '0199a0c0-0000-7000-8000-000000000001'

describe('the tester people (founder, 2026-09-29: plain usernames, the demo password)', () => {
  it('are plain usernames, no owner and no shopkeeper, with names of real-sounding people', () => {
    expect(TESTER_KEYS.map((k) => plainUsername(k))).toEqual([
      'manager',
      'accounts',
      'sales1',
      'sales2',
      'godown',
      'driver1',
      'driver2',
    ])
    expect([...SHOP_USERNAMES]).toEqual(['shop1', 'shop2', 'shop3'])
    for (const t of TESTERS) {
      expect(t.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
      expect(t.name.toLowerCase()).not.toMatch(/tester|demo|test/)
    }
    expect(TESTERS.map((t) => t.role)).not.toContain('owner')
    expect(TESTER_KEYS.map((k) => plainUsername(k)).join(' ')).not.toContain('tester')
  })

  it('carry a suffix for a second distributor on the same database, and refuse a bad one', () => {
    expect(plainUsername('manager', 'sai')).toBe('manager.sai')
    expect(() => plainUsername('manager', 'Bad Suffix')).toThrow()
    for (const k of TESTER_KEYS)
      for (const u of usernameCandidates(k, 'abcd1234', new Set()))
        expect(u.length).toBeLessThanOrEqual(32)
  })

  it('sign in with the demo password of the seed, which the product takes as a password', () => {
    expect(typeof DEMO_PASSWORD).toBe('string')
    expect(validatePassword(DEMO_PASSWORD)).toBeNull()
  })

  it('take the next free plain username when the plain one is someone else’s (D5)', () => {
    expect(usernameCandidates('manager', undefined, new Set())[0]).toBe('manager')
    expect(usernameCandidates('manager', undefined, new Set(['manager'])).slice(0, 2)).toEqual([
      'manager2',
      'manager3',
    ])
    // Never another tester's own plain name: sales1 goes to sales3, not sales2.
    expect(usernameCandidates('sales1', undefined, new Set(['sales1']))[0]).toBe('sales3')
    expect(usernameCandidates('sales2', undefined, new Set(['sales2', 'sales3']))[0]).toBe('sales4')
    expect(usernameCandidates('driver1', 'x', new Set(['driver1.x']))[0]).toBe('driver3.x')
    expect(usernameCandidates('godown', 'x', new Set(['godown.x']))[0]).toBe('godown2.x')
    expect(usernameCandidates('accounts', undefined, new Set())).toHaveLength(5)
  })

  it('are found again by the mark they were made with, never by the username', () => {
    const id = personId(TENANT, '2026-09-20', 'driver2')
    expect(crewKeyOf(TENANT, id)).toBe('driver2')
    // The crew of a suffix is its own; another distributor's id is not this one's.
    expect(crewKeyOf(TENANT, id, 'x')).toBeNull()
    expect(crewKeyOf(TENANT, personId(TENANT, '2026-09-20', 'driver2', 'x'), 'x')).toBe('driver2')
    expect(crewKeyOf('0199a0c0-0000-7000-8000-000000000002', id)).toBeNull()
    // The id the tool before 2026-09-29 gave `tester.manager` is not the crew's.
    expect(crewKeyOf(TENANT, demoId(TENANT, '2026-09-20', 'person', 'tester.manager'))).toBeNull()
    expect(crewKeyOf(TENANT, '0199a0c0-1111-7abc-8def-000000000003')).toBeNull()
  })

  it('tell the former testers apart from the crew, and leave everyone else out (D5, D6)', () => {
    const d = '2026-09-25'
    const staff = [
      {
        userId: '0199a0c0-2222-7abc-8def-000000000004',
        username: 'owner.look',
        role: 'owner',
        status: 'active',
      },
      // The distributor's own godown, whose username is a tester's plain one: not the tool's.
      {
        userId: '0199a0c0-3333-7abc-8def-000000000005',
        username: 'godown',
        role: 'warehouse',
        status: 'active',
      },
      {
        userId: personId(TENANT, d, 'manager'),
        username: 'manager',
        role: 'manager',
        status: 'active',
      },
      {
        userId: personId(TENANT, d, 'godown'),
        username: 'godown2',
        role: 'warehouse',
        status: 'active',
      },
      // A second manager the tool made on a later date (a run that could not see the first): former.
      {
        userId: personId(TENANT, '2026-09-26', 'manager'),
        username: 'manager2',
        role: 'manager',
        status: 'active',
      },
      // The tool before 2026-09-29.
      {
        userId: demoId(TENANT, '2026-09-10', 'person', 'tester.sales1'),
        username: 'tester.sales1',
        role: 'salesperson',
        status: 'active',
      },
      // A crew of another suffix.
      {
        userId: personId(TENANT, d, 'driver1', 'old'),
        username: 'driver1.old',
        role: 'delivery',
        status: 'disabled',
      },
    ]
    const { crew, former } = sortStaff(TENANT, staff)
    expect([...crew.keys()].sort()).toEqual(['godown', 'manager'])
    expect(crew.get('manager')?.username).toBe('manager')
    expect(crew.get('godown')?.username).toBe('godown2')
    // Oldest first (a user id carries the date it was made for).
    expect(former.map((f) => [f.member.username, f.key])).toEqual([
      ['tester.sales1', 'sales1'],
      ['driver1.old', 'driver1'],
      ['manager2', 'manager'],
    ])
    expect(formerKeyOf('tester.driver2.x')).toBe('driver2')
    expect(formerKeyOf('manager3.x')).toBe('manager')
    expect(formerKeyOf('sales3')).toBeNull()
    expect(formerKeyOf(null)).toBeNull()
  })

  it('read a plain username as free only when the product says the only person it found is the owner (D5)', () => {
    // The probe: `staff.create` with the username and the OWNER's phone; the product refuses it either way.
    const refusal = (status: number, message: string) =>
      new ApiRefusal(status, 'CONFLICT', message, null)
    expect(probeAnswer(refusal(409, 'This person is already a member of this distributor'))).toBe(
      'free',
    )
    expect(
      probeAnswer(
        refusal(409, 'That username and that phone number belong to two different people'),
      ),
    ).toBe('taken')
    expect(probeAnswer(refusal(409, 'That username or phone number is already taken'))).toBe(
      'taken',
    )
    expect(probeAnswer(refusal(400, 'Username must be 3–32 characters'))).toBe('taken')
    expect(probeAnswer(refusal(503, 'already a member'))).toBe('taken')
    expect(probeAnswer(new Error('boom'))).toBe('taken')
  })

  it('get a phone of the +91 70 block that is nobody else in the distributor', () => {
    const first = testerPhone('t', 'manager', new Set())
    expect(first).toMatch(/^\+9170\d{8}$/)
    expect(testerPhone('t', 'manager', new Set([first]))).not.toBe(first)
  })

  it('get temporary passwords the policy takes: 16 letters and digits, never the same twice', () => {
    const seen = new Set<string>()
    for (let n = 0; n < 50; n++) {
      const p = newPassword()
      expect(p).toMatch(/^[A-Za-z0-9]{16}$/)
      expect(validatePassword(p)).toBeNull()
      seen.add(p)
    }
    expect(seen.size).toBe(50)
  })

  it('are listed in a file of mode 600 that reads back the same, rewritten only when it changes', () => {
    const path = join(dir, 'logins.txt')
    writeFileSync(path, 'x', { mode: 0o644 })
    const lines = [
      { username: 'manager', password: DEMO_PASSWORD, role: 'manager' },
      { username: 'driver1', password: DEMO_PASSWORD, role: 'delivery' },
    ]
    expect(writeLogins(path, 'tarsun', lines)).toBe(true)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const back = readLogins(path)
    expect(back.get('driver1')?.password).toBe(DEMO_PASSWORD)
    expect(back.size).toBe(2)
    expect(writeLogins(path, 'tarsun', lines)).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(loginsText('tarsun', lines))
    expect(readLogins(join(dir, 'absent.txt')).size).toBe(0)
    writeFileSync(join(dir, 'pw'), '\n  S3cretPassw0rd  \n')
    expect(readPasswordFile(join(dir, 'pw'))).toBe('S3cretPassw0rd')
    expect(readFileSync(path, 'utf8')).toContain('username<TAB>password<TAB>role')
  })

  it("never write the demo password in the tool's own files: it is taken from the seed (D2)", () => {
    const tools = fileURLToPath(new URL('..', import.meta.url))
    const files = [
      ...readdirSync(join(tools, 'demo-fill')).map((f) => join(tools, 'demo-fill', f)),
      ...readdirSync(join(tools, 'testing')).map((f) => join(tools, 'testing', f)),
      ...[
        'fill-demo-activity.mts',
        'check-demo-coverage.mts',
        'check-demo-rows.mts',
        'README.md',
        '../infra/oracle-vm/fill-demo.sh',
        '../../docs/plans/demo-activity-fill.md',
      ].map((f) => join(tools, f)),
    ]
    expect(files.length).toBeGreaterThan(20)
    const holding = files.filter((f) => readFileSync(f, 'utf8').includes(DEMO_PASSWORD))
    expect(holding).toEqual([])
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

  it('calls the shopkeeper row "made" once its logins are there too: no known gap is left', () => {
    const s = new Summary()
    all(s)
    expect(s.rowState('shopkeeper').state).toBe('made')
    expect(s.exitCode()).toBe(0)
  })

  it('calls a row "partly" for a known gap alone, and the run still exits 0', () => {
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

describe('the shopkeepers shop1…3 (founder, 2026-09-29: they sign up by themselves)', () => {
  const tenant = '01a0f000-0000-7000-8000-000000000001'

  it('are three invented people, one per plain shop username', () => {
    expect(SHOPKEEPERS.map((k) => k.key)).toEqual(['shop1', 'shop2', 'shop3'])
    for (const k of SHOPKEEPERS) expect(k.name.split(' ')).toHaveLength(2)
  })

  it('take the next plain number no other shopkeeper would take when a name is somebody else’s', () => {
    expect(shopUsernameCandidates('shop1', undefined, 3)).toEqual(['shop1', 'shop4', 'shop7'])
    expect(shopUsernameCandidates('shop3', 'x1', 2)).toEqual(['shop3.x1', 'shop6.x1'])
  })

  it('knows its own usernames and nobody else’s', () => {
    expect(isShopUsername('shop4')).toBe(true)
    expect(isShopUsername('shop4.x1', 'x1')).toBe(true)
    expect(isShopUsername('shop4.x2', 'x1')).toBe(false)
    expect(isShopUsername('shop4.x2')).toBe(true)
    expect(isShopUsername('shopkeeper')).toBe(false)
    expect(isShopUsername(null)).toBe(false)
  })

  it('finds its own account again by the mark in the user id, whatever the date it signed up', () => {
    const id = shopPersonId(tenant, '2026-09-30', 'shop2', 'x1')
    expect(shopKeyOf(tenant, id, 'x1')).toBe('shop2')
    expect(shopKeyOf(tenant, id, 'x2')).toBeNull()
    expect(shopKeyOf(tenant, '01a0f000-0000-7000-8000-000000000009')).toBeNull()
  })
})
