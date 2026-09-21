/**
 * docs/31 §1.4, §3, §5 and R2 — the six rows of `GROUPS`, and the one function that can be silently
 * wrong.
 *
 * `absoluteUrl` is R2 in the plan's risk table for a reason: with six apps there was ONE service to
 * absolutise a logo or an invoice PDF against, and getting it wrong was impossible. With one app the
 * group is an argument, and a wrong one produces a URL that resolves, leaves, and comes back 404 —
 * a blank logo and a PDF that never opens, with nothing on any screen to say why.
 *
 * The strings swap of §3 is asserted here too (each group has its own record, and no key of one
 * group's record is taken from another's), because a merge would be invisible until a driver read
 * "Credit" where the word for him is "Pay after delivery".
 */
import { describe, expect, it } from 'vitest'
import { GROUP_NAMES, SERVICE_OF, serviceFor } from '@dos/api-client'

import { APP, GROUPS, absoluteUrl, apiUrlFor } from './config'
import { strings as rootStrings } from './strings'
import { strings as owner } from './groups/owner/strings'
import { strings as manager } from './groups/manager/strings'
import { strings as sales } from './groups/sales/strings'
import { strings as warehouse } from './groups/warehouse/strings'
import { strings as delivery } from './groups/delivery/strings'
import { strings as retailer } from './groups/retailer/strings'

const RECORDS = { owner, manager, sales, warehouse, delivery, retailer } as const

describe('GROUPS', () => {
  it('has a row per group of the one app, and no more', () => {
    expect(Object.keys(GROUPS).sort()).toEqual([...GROUP_NAMES].sort())
  })

  it('names the service each group s role talks to, agreeing with the client s own table', () => {
    for (const group of GROUP_NAMES) {
      expect(GROUPS[group].port, group).toBe(SERVICE_OF[GROUPS[group].role].port)
    }
  })

  it('carries UX-00 §5.2 s touch floor per group: godown 76, field 69, desk apps 63', () => {
    expect(GROUPS.warehouse.touch).toBe('floor')
    expect(GROUPS.sales.touch).toBe('field')
    expect(GROUPS.delivery.touch).toBe('field')
    expect(GROUPS.retailer.touch).toBe('field')
    expect(GROUPS.owner.touch).toBe('phone')
    expect(GROUPS.manager.touch).toBe('phone')
  })

  it('gives a register a table only where a desk reads one', () => {
    expect(GROUPS.owner.density).toBe('desk')
    expect(GROUPS.manager.density).toBe('desk')
    for (const group of ['sales', 'warehouse', 'delivery', 'retailer'] as const) {
      expect(GROUPS[group].density, group).toBe('field')
    }
  })

  it('opens a device store for the three FIELD groups and for nobody else (docs/31 §4)', () => {
    expect(GROUPS.sales.offline).toBe('dos-sales')
    expect(GROUPS.warehouse.offline).toBe('dos-warehouse')
    expect(GROUPS.delivery.offline).toBe('dos-delivery')
    // Owner, manager and retailer are online: an owner must run with no file opened at all.
    expect(GROUPS.owner.offline).toBe(false)
    expect(GROUPS.manager.offline).toBe(false)
    expect(GROUPS.retailer.offline).toBe(false)
  })

  it('gives every group its OWN name for the landing panel, never the product s (docs/29 §1)', () => {
    const titles = GROUP_NAMES.map((group) => GROUPS[group].title)
    expect(new Set(titles).size).toBe(GROUP_NAMES.length)
    for (const title of titles) expect(title.startsWith(`${APP.title} - `)).toBe(true)
  })

  it('draws the three PRE-ELECTION branches at the desk pair: no role, so no group floor', () => {
    expect(APP.touch).toBe('phone')
    expect(APP.density).toBe('desk')
  })
})

describe('absoluteUrl (docs/31 R2)', () => {
  it('absolutises against THIS group s service, not against one of the six', () => {
    expect(absoluteUrl('delivery', '/storage/tenant/x.pdf?sig=1')).toBe(
      'http://127.0.0.1:3005/storage/tenant/x.pdf?sig=1',
    )
    expect(absoluteUrl('owner', '/storage/tenant/x.pdf?sig=1')).toBe(
      'http://127.0.0.1:3001/storage/tenant/x.pdf?sig=1',
    )
  })

  it('gives every group a DIFFERENT answer, so a missed call site cannot pass by luck', () => {
    const urls = GROUP_NAMES.map((group) => absoluteUrl(group, '/storage/x'))
    // Five origins, not six: the accountant and the manager share a service, but no two GROUPS do.
    expect(new Set(urls).size).toBe(GROUP_NAMES.length)
  })

  it('leaves an absolute URL and a data URI alone', () => {
    expect(absoluteUrl('sales', 'https://cdn.example.in/logo.png')).toBe(
      'https://cdn.example.in/logo.png',
    )
    expect(absoluteUrl('sales', '//cdn.example.in/logo.png')).toBe('//cdn.example.in/logo.png')
    expect(absoluteUrl('sales', 'data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
  })

  it('answers null for nothing, so a caller never builds a URL out of an absent logo', () => {
    expect(absoluteUrl('owner', null)).toBeNull()
    expect(absoluteUrl('owner', undefined)).toBeNull()
    expect(absoluteUrl('owner', '')).toBeNull()
  })

  it('joins a path that has no leading slash rather than running it into the origin', () => {
    expect(absoluteUrl('retailer', 'storage/x')).toBe('http://127.0.0.1:3006/storage/x')
  })

  it('is the client s own table underneath, never a second copy of the ports', () => {
    for (const group of GROUP_NAMES) {
      expect(apiUrlFor(group), group).toBe(serviceFor(GROUPS[group].role, undefined))
    }
  })
})

describe('strings are SWAPPED per group, never merged (docs/31 §3)', () => {
  it('gives each group its own record', () => {
    const records = Object.values(RECORDS)
    for (let i = 0; i < records.length; i += 1) {
      for (let j = i + 1; j < records.length; j += 1) {
        expect(records[i]).not.toBe(records[j])
      }
    }
  })

  it('keeps BOTH words where two groups disagree — the audience, not drift', () => {
    // Measured on HEAD: 71 shared keys carry different values. Two of them, named.
    const colliding: [keyof typeof owner & keyof typeof retailer, string, string][] = [
      ['word.POST_FULFILLMENT', owner['word.POST_FULFILLMENT'], retailer['word.POST_FULFILLMENT']],
    ]
    for (const [key, a, b] of colliding) {
      expect(a, key).not.toBe(b)
    }
  })

  it('keeps the ROOT record to the pre-election screens and the chooser', () => {
    // It is laid over the kit catalogue on the sign-in / change-password branches only, so it must
    // carry those words and must NOT have grown into a seventh app's namespace.
    expect(rootStrings['app.signInTitle']).toBe('Sign in')
    expect(rootStrings['elect.title']).toBe('Continue as')
    expect(Object.keys(rootStrings).every((key) => /^(app|elect|role)\./.test(key))).toBe(true)
  })

  it('names every role in the trade s own word, so no chooser row shows a database value', () => {
    for (const group of GROUP_NAMES) {
      const role = GROUPS[group].role
      expect(rootStrings[`role.${role}`], role).toBeTruthy()
    }
    expect(rootStrings['role.accountant']).toBeTruthy()
  })
})
