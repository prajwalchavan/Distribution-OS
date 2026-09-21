/**
 * docs/31 ruling B3 — who is asked, what they are offered, and what the root does while they answer.
 *
 * `permittedRoles` is the list the chooser renders. Getting it too WIDE would offer a role the server
 * then refuses, which is a dead row in a list; getting it too NARROW silently takes work away from
 * the owner who drives on Tuesdays. So it is asserted against `@dos/domain`'s own table — the one
 * `auth.service.ts` grants from — rather than against a copy.
 *
 * The chooser flag is asserted too, because it is the only thing holding the root's redirect ladder
 * still while the question is on screen: without it a signed-in person on `/sign-in` is swept into
 * whichever group their login happened to land in, before they have said what they are doing today.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { electableRoles } from '@dos/domain'
import { GROUP_OF, type Session } from '@dos/api-client'
import type { MembershipRole, MembershipSummary } from '@dos/contracts'

import {
  beginChoosing,
  currentMembership,
  endChoosing,
  isChoosing,
  needsChooser,
  permittedRoles,
  preselectedRole,
  subscribeChoosing,
} from './election'

const TARSUN = '01924f9a-0000-7000-8000-0000000000aa'
const SAI = '01924f9a-0000-7000-8000-0000000000ab'

function membership(
  tenantId: string,
  role: MembershipRole,
  extraRoles: readonly MembershipRole[] = [],
): MembershipSummary {
  return {
    tenantId,
    tenantSlug: tenantId === TARSUN ? 'tarsun' : 'sai',
    tenantName: tenantId === TARSUN ? 'Tarsun Enterprises' : 'Sai Distributors',
    displayName: tenantId === TARSUN ? 'Tarsun Enterprises' : 'Sai Distributors',
    logoUrl: null,
    role,
    extraRoles: [...extraRoles],
    status: 'active',
  }
}

/** A session as the client hands it to a screen: the ELECTED role, plus the memberships behind it. */
function session(
  elected: MembershipRole,
  own: MembershipRole,
  extra: MembershipSummary[] = [],
  extraRoles: readonly MembershipRole[] = [],
): Session {
  return {
    user: {
      id: '01924f9a-0000-7000-8000-0000000000b1',
      username: 'sunil.tarsun',
      name: 'Sunil Tarsun',
      locale: 'en-IN',
      mustChangePassword: false,
    },
    tenant: {
      id: TARSUN,
      slug: 'tarsun',
      legalName: 'Tarsun Enterprises',
      displayName: 'Tarsun Enterprises',
      logoUrl: null,
    },
    role: elected,
    memberships: [membership(TARSUN, own, extraRoles), ...extra],
  }
}

describe('permittedRoles', () => {
  it('reads the MEMBERSHIP role, not the elected one: an owner acting as a driver may go back', () => {
    // The token says `delivery`; what this person MAY be is still everything an owner may be.
    expect(permittedRoles(session('delivery', 'owner'))).toContain('owner')
    expect(permittedRoles(session('delivery', 'owner'))).toContain('manager')
  })

  it('is @dos/domain s own table, role for role', () => {
    for (const own of ['owner', 'manager', 'salesperson', 'retailer'] as const) {
      expect(permittedRoles(session(own, own))).toEqual(
        electableRoles(own).filter((role) => role !== 'platform_admin'),
      )
    }
  })

  it('offers the owner five roles besides their own, and the manager three', () => {
    expect(permittedRoles(session('owner', 'owner'))).toEqual([
      'owner',
      'manager',
      'accountant',
      'warehouse',
      'delivery',
      'salesperson',
    ])
    expect(permittedRoles(session('manager', 'manager'))).toEqual([
      'manager',
      'warehouse',
      'delivery',
      'salesperson',
    ])
  })

  it('offers a shopkeeper and a rep exactly themselves: there is nothing to ask', () => {
    expect(permittedRoles(session('retailer', 'retailer'))).toEqual(['retailer'])
    expect(permittedRoles(session('salesperson', 'salesperson'))).toEqual(['salesperson'])
    expect(needsChooser(session('retailer', 'retailer'))).toBe(false)
    expect(needsChooser(session('salesperson', 'salesperson'))).toBe(false)
  })

  it('never offers a role with no group: a row that cannot open a screen is not a choice', () => {
    for (const own of ['owner', 'manager'] as const) {
      for (const role of permittedRoles(session(own, own))) expect(role in GROUP_OF).toBe(true)
    }
  })

  it('reads THIS distributor s membership, not another one of the person s', () => {
    const both = session('owner', 'owner', [membership(SAI, 'salesperson')])
    expect(currentMembership(both)?.role).toBe('owner')
    expect(permittedRoles(both)).toContain('warehouse')
  })

  it('asks the owner and the manager, and nobody else', () => {
    expect(needsChooser(session('owner', 'owner'))).toBe(true)
    expect(needsChooser(session('manager', 'manager'))).toBe(true)
    expect(needsChooser(session('accountant', 'accountant'))).toBe(false)
    expect(needsChooser(session('warehouse', 'warehouse'))).toBe(false)
    expect(needsChooser(session('delivery', 'delivery'))).toBe(false)
  })
})

/**
 * docs/31 ruling B5 — the wire carries `extraRoles`, and the chooser reads it TYPED. For the four
 * staff roles the extras are the only second row there is: a salesperson granted `delivery` must see
 * two rows, and one granted nothing must see none (there is nothing to ask).
 */
describe('extra roles on the wire (ruling B5)', () => {
  it('a salesperson granted delivery may continue as either: own role first, then the extra', () => {
    const rep = session('salesperson', 'salesperson', [], ['delivery'])
    expect(permittedRoles(rep)).toEqual(['salesperson', 'delivery'])
    expect(needsChooser(rep)).toBe(true)
    expect(preselectedRole(rep)).toBe('salesperson')
  })

  it('a salesperson granted nothing is exactly themselves, and is not asked', () => {
    const rep = session('salesperson', 'salesperson', [], [])
    expect(permittedRoles(rep)).toEqual(['salesperson'])
    expect(needsChooser(rep)).toBe(false)
  })

  it('reads the field off the membership itself — no defensive cast, so the list is the domain’s', () => {
    for (const own of ['accountant', 'warehouse', 'delivery', 'salesperson'] as const) {
      const granted = session(own, own, [], ['delivery', 'salesperson'])
      expect(permittedRoles(granted)).toEqual(
        electableRoles(own, ['delivery', 'salesperson']).filter(
          (role) => role !== 'platform_admin',
        ),
      )
    }
  })

  it('an owner’s extras change nothing: the owner already elects from the fixed table', () => {
    expect(permittedRoles(session('owner', 'owner', [], ['delivery']))).toEqual(
      permittedRoles(session('owner', 'owner')),
    )
  })
})

describe('preselectedRole', () => {
  it('opens on this membership s own role when the device remembers nothing', () => {
    // `platform.storage` in a Vitest run has no `dos.lastRole` written.
    expect(preselectedRole(session('owner', 'owner'))).toBe('owner')
  })

  it('never opens on nothing: there is always a row chosen', () => {
    for (const own of ['owner', 'manager', 'retailer'] as const) {
      expect(permittedRoles(session(own, own))).toContain(preselectedRole(session(own, own)))
    }
  })
})

describe('the chooser flag the root s ladder reads', () => {
  beforeEach(() => {
    endChoosing()
  })

  it('starts closed: a launch nobody has signed into holds no ladder still', () => {
    expect(isChoosing()).toBe(false)
  })

  it('opens and closes, and tells whoever is listening', () => {
    let told = 0
    const stop = subscribeChoosing(() => {
      told += 1
    })
    beginChoosing()
    expect(isChoosing()).toBe(true)
    endChoosing()
    expect(isChoosing()).toBe(false)
    stop()
    expect(told).toBe(2)
  })

  it('says nothing when nothing changed: a repeated open is not a render', () => {
    let told = 0
    const stop = subscribeChoosing(() => {
      told += 1
    })
    beginChoosing()
    beginChoosing()
    endChoosing()
    endChoosing()
    stop()
    expect(told).toBe(2)
  })

  it('stops telling a listener that has gone', () => {
    let told = 0
    const stop = subscribeChoosing(() => {
      told += 1
    })
    stop()
    beginChoosing()
    expect(told).toBe(0)
  })
})
