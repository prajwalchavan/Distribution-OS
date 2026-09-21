/**
 * docs/29 §2 election table — the whole table, every (from, to) pair, in one place.
 *
 * The table itself is ONE exported constant in `@dos/domain` (`ROLE_ELECTION`) so the server and the
 * seven apps link the same thing rather than keep two lists that drift. This spec is its executable
 * form: it walks every ordered pair of roles the platform has and asserts, pair by pair, exactly what
 * the founder's decision of 2026-09-21 says — owner downward to five roles, manager downward to three,
 * the four staff roles only to themselves plus whatever the owner put in their membership's
 * `extra_roles`, and retailer and platform_admin never to anything but themselves.
 *
 * Nothing here touches the database or a permission matrix: an election decides which role a token is
 * MINTED with, and every server-side check downstream is unchanged.
 */
import {
  canElect,
  electableRoles,
  electionRefusal,
  ELECTION_ROLES,
  GRANTABLE_EXTRA_ROLES,
  ROLE_ELECTION,
  type ElectionRole,
} from '@dos/domain'
import { describe, expect, it } from 'vitest'

/** docs/29 §2, transcribed from the table and NOT from the implementation. */
const TABLE: Record<ElectionRole, readonly ElectionRole[]> = {
  owner: ['owner', 'manager', 'accountant', 'warehouse', 'delivery', 'salesperson'],
  manager: ['manager', 'warehouse', 'delivery', 'salesperson'],
  accountant: ['accountant'],
  warehouse: ['warehouse'],
  delivery: ['delivery'],
  salesperson: ['salesperson'],
  retailer: ['retailer'],
  platform_admin: ['platform_admin'],
}

describe('docs/29 §2 election table', () => {
  it('names every role the platform has, exactly once', () => {
    expect([...ELECTION_ROLES].sort()).toEqual(
      [
        'accountant',
        'delivery',
        'manager',
        'owner',
        'platform_admin',
        'retailer',
        'salesperson',
        'warehouse',
      ].sort(),
    )
    expect(Object.keys(ROLE_ELECTION).sort()).toEqual([...ELECTION_ROLES].sort())
  })

  for (const from of ELECTION_ROLES) {
    for (const to of ELECTION_ROLES) {
      const allowed = TABLE[from].includes(to)
      it(`${from} may ${allowed ? '' : 'NOT '}act as ${to}`, () => {
        expect(canElect(from, to, [])).toBe(allowed)
      })
    }
  }

  it('a role always keeps its own role without any grant', () => {
    for (const role of ELECTION_ROLES) expect(canElect(role, role, [])).toBe(true)
  })

  describe('extra roles', () => {
    it('lets one of the four staff roles act as a role its membership was granted', () => {
      expect(canElect('salesperson', 'delivery', ['delivery'])).toBe(true)
      expect(canElect('warehouse', 'salesperson', ['salesperson', 'delivery'])).toBe(true)
      expect(canElect('delivery', 'accountant', ['accountant'])).toBe(true)
    })

    it('grants only the four staff roles, whatever a stale row holds', () => {
      expect([...GRANTABLE_EXTRA_ROLES].sort()).toEqual([
        'accountant',
        'delivery',
        'salesperson',
        'warehouse',
      ])
      // Never a way up: a row that somehow carries `owner` still elects nothing.
      expect(canElect('salesperson', 'owner', ['owner'])).toBe(false)
      expect(canElect('warehouse', 'manager', ['manager'])).toBe(false)
      expect(canElect('delivery', 'retailer', ['retailer'])).toBe(false)
    })

    it('never opens a door for the shopkeeper or for platform staff', () => {
      for (const to of ELECTION_ROLES) {
        if (to !== 'retailer')
          expect(canElect('retailer', to, [...GRANTABLE_EXTRA_ROLES])).toBe(false)
        if (to !== 'platform_admin')
          expect(canElect('platform_admin', to, [...GRANTABLE_EXTRA_ROLES])).toBe(false)
      }
    })

    it('is ignored for a membership that already elects downward', () => {
      // The owner and the manager elect from the table, not from extra_roles (docs/29 §2).
      expect(electableRoles('manager', ['accountant'])).toEqual([
        'manager',
        'warehouse',
        'delivery',
        'salesperson',
      ])
      expect(canElect('manager', 'accountant', ['accountant'])).toBe(false)
    })
  })

  it('refuses with the sentence docs/29 §2 states, never a silent downgrade', () => {
    expect(
      electionRefusal({ distributor: 'Tarsun', membershipRole: 'salesperson', actAs: 'delivery' }),
    ).toBe('Your login at Tarsun is a salesperson; ask the owner to add delivery to it.')
  })
})
