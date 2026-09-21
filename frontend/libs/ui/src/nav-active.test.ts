/**
 * Which rail item is lit — the one rule, written once for both renderers.
 *
 * Today's shells special-case exactly one href: `'/'` lights only on `'/'`, and every other item
 * lights on itself or on a descendant. That special case is spelled as the literal `'/'`, and the
 * one app (docs/31 §1.1, ruling Q1) makes every group's home a SEGMENT — `/owner`, `/delivery` —
 * so the literal stops being true: `/owner` prefixes `/owner/orders`, `/owner/shops` and every other
 * route in the group, and the home tab would be lit on all of them. A person who taps Orders and
 * watches Home light up has been told the app does not know where they are.
 *
 * So the home is a PARAMETER, not a literal. `homeHref` defaults to `'/'`, which is exactly today's
 * behaviour for the console and the template, and the merged app's group layout passes `/<group>`.
 */
import { describe, expect, it } from 'vitest'

import { isActive } from './nav-active.js'

describe('isActive, with the default home', () => {
  it('lights the home only on the home', () => {
    expect(isActive('/', '/')).toBe(true)
    expect(isActive('/orders', '/')).toBe(false)
    expect(isActive('/orders/abc', '/')).toBe(false)
  })

  it('lights a section on itself and on its descendants', () => {
    expect(isActive('/orders', '/orders')).toBe(true)
    expect(isActive('/orders/abc', '/orders')).toBe(true)
    expect(isActive('/orders/abc/lines', '/orders')).toBe(true)
  })

  it('never lights a sibling that merely shares a prefix', () => {
    expect(isActive('/orders-archive', '/orders')).toBe(false)
    expect(isActive('/stock', '/stockists')).toBe(false)
  })
})

describe('isActive, with a group home (docs/31 §1.1)', () => {
  it('does not light /owner for a route inside the owner group', () => {
    expect(isActive('/owner/orders', '/owner', '/owner')).toBe(false)
    expect(isActive('/owner/orders/abc', '/owner', '/owner')).toBe(false)
    expect(isActive('/owner/settings', '/owner', '/owner')).toBe(false)
  })

  it('lights /owner on the group home itself', () => {
    expect(isActive('/owner', '/owner', '/owner')).toBe(true)
  })

  it('still lights a section of the group on its descendants', () => {
    expect(isActive('/owner/orders/abc', '/owner/orders', '/owner')).toBe(true)
    expect(isActive('/owner/orders', '/owner/orders', '/owner')).toBe(true)
    expect(isActive('/owner/orders-archive', '/owner/orders', '/owner')).toBe(false)
  })

  it('is per group: /delivery is a home to the delivery shell and a plain path to nobody else', () => {
    expect(isActive('/delivery/stop/abc', '/delivery', '/delivery')).toBe(false)
    expect(isActive('/delivery/stop/abc', '/delivery/stop', '/delivery')).toBe(true)
  })

  it('a trailing slash on the current path does not unlight the home', () => {
    expect(isActive('/owner/', '/owner', '/owner')).toBe(true)
    expect(isActive('/', '/')).toBe(true)
  })
})
