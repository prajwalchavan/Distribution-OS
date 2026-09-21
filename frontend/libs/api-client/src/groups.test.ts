/**
 * docs/31 §1.3 step 7 + ruling Q2 — every membership role opens exactly one group.
 *
 * The one app registers all six group trees (expo-router has no supported way to hide a branch), so
 * the ONLY thing that keeps a manager out of the owner's screens on a cold URL is this table plus
 * the root redirect that reads it. A role with no entry would redirect to `/undefined`; a role
 * pointing at the wrong group would paint another role's data for as long as it took the server to
 * answer 403. So the table is walked against the enum itself rather than against a copy of it.
 */
import { MembershipRoleSchema } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import { GROUP_NAMES, GROUP_OF, groupOf } from './groups.js'

describe('GROUP_OF', () => {
  it('maps every MembershipRole, with nothing left over', () => {
    const roles = [...MembershipRoleSchema.options].sort()
    expect(Object.keys(GROUP_OF).sort()).toEqual(roles)
  })

  it('names a real group for every role', () => {
    for (const role of MembershipRoleSchema.options) {
      expect(GROUP_NAMES).toContain(GROUP_OF[role])
    }
  })

  it('puts the accountant in the manager group — the split is PERMISSIONS, not a second app', () => {
    expect(GROUP_OF.accountant).toBe('manager')
    expect(GROUP_OF.manager).toBe('manager')
  })

  it('gives the three field roles their own group each', () => {
    expect(GROUP_OF.salesperson).toBe('sales')
    expect(GROUP_OF.warehouse).toBe('warehouse')
    expect(GROUP_OF.delivery).toBe('delivery')
  })

  it('every group is reachable by some role — no group without a way in', () => {
    const reached = new Set(Object.values(GROUP_OF))
    for (const group of GROUP_NAMES) expect(reached.has(group)).toBe(true)
  })
})

describe('groupOf', () => {
  it('answers for a role the app knows', () => {
    expect(groupOf('salesperson')).toBe('sales')
  })

  it('answers null — never a group — for a role it does not know, so the caller can sign out', () => {
    expect(groupOf('platform_admin')).toBeNull()
    expect(groupOf('system')).toBeNull()
    expect(groupOf(null)).toBeNull()
    expect(groupOf(undefined)).toBeNull()
    expect(groupOf('')).toBeNull()
  })
})
