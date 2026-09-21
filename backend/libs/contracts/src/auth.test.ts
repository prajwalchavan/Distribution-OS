/**
 * docs/31 ruling B5 — a membership's extra roles travel on the wire.
 *
 * With one app the PERSON is the elector (ruling B3): after the password the device lists every role
 * this membership permits and the person picks one. `@dos/domain`'s `electableRoles(own, extras)` is
 * that list, and for the four staff roles `extras` is its ONLY second entry — so a summary that does
 * not carry `extra_roles` leaves a warehouse hand who also drives with a one-row list and no way to
 * ask. The field is therefore REQUIRED, never optional: an old server that omits it must fail the
 * parse rather than quietly render the short list.
 */
import { describe, expect, it } from 'vitest'
import { MembershipDuesSchema, MembershipSummarySchema } from './auth.js'

const summary = {
  tenantId: '01924f9a-0000-7000-8000-0000000000aa',
  tenantSlug: 'tarsun',
  tenantName: 'Tarsun Enterprises',
  displayName: 'Tarsun Enterprises',
  logoUrl: null,
  role: 'warehouse',
  status: 'active',
}

const dues = {
  tenantId: '01924f9a-0000-7000-8000-0000000000aa',
  tenantSlug: 'tarsun',
  displayName: 'Tarsun Enterprises',
  logoUrl: null,
  role: 'retailer',
  outstandingPaise: 0,
  overduePaise: 0,
  openBills: 0,
  lastReceiptAt: null,
  lastReceiptPaise: null,
  lastBill: null,
  onTheWay: null,
}

describe('MembershipSummary.extraRoles (ruling B5)', () => {
  it('is REQUIRED: a summary without it does not parse', () => {
    expect(MembershipSummarySchema.safeParse(summary).success).toBe(false)
  })

  it('is a list of membership roles — empty for almost everybody', () => {
    expect(MembershipSummarySchema.safeParse({ ...summary, extraRoles: [] }).success).toBe(true)
    const parsed = MembershipSummarySchema.parse({ ...summary, extraRoles: ['delivery'] })
    expect(parsed.extraRoles).toEqual(['delivery'])
  })

  it('refuses a role the platform does not have, and refuses null', () => {
    expect(MembershipSummarySchema.safeParse({ ...summary, extraRoles: ['driver'] }).success).toBe(
      false,
    )
    expect(MembershipSummarySchema.safeParse({ ...summary, extraRoles: null }).success).toBe(false)
  })

  it('is in the schema shape, not only accepted: the generated docs list it', () => {
    expect(Object.keys(MembershipSummarySchema.shape)).toContain('extraRoles')
  })
})

describe('MembershipDues.extraRoles (auth.memberships.summary carries it too)', () => {
  it('is REQUIRED on the dues row as well', () => {
    expect(MembershipDuesSchema.safeParse(dues).success).toBe(false)
    expect(MembershipDuesSchema.safeParse({ ...dues, extraRoles: [] }).success).toBe(true)
  })
})
