/**
 * docs/31 §1.1 + ruling Q1 — one helper between a screen and a route literal.
 *
 * The one app gives every group a visible segment, so `/orders` inside the sales group is really
 * `/sales/orders`. Roughly 347 literals across the six apps have to gain that base, and a literal
 * that misses it does not fail the build: expo-router resolves it against the tree and the person
 * lands somewhere else, or nowhere. So no screen writes the base: `routeFor(group, path)` writes it,
 * `useGo()` binds it to the group the layout mounted, and the move lanes' guard can then insist that
 * every literal goes through one of the two.
 *
 * Two things the helper must get right or it is worse than the literals it replaces: it must be
 * IDEMPOTENT (a path that already carries its base is left alone, so a re-run of a move lane cannot
 * write `/sales/sales/orders`), and it must leave the PRE-ELECTION routes at the root, because
 * `/sign-in` and `/change-password` are one screen each for the whole app and an account menu inside
 * a group pushes them by name today.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GroupProvider, ROOT_ROUTES, goTo, routeFor, useGo } from './route-for.js'
import { setRouterNavigate } from './router-bridge.js'

describe('routeFor', () => {
  it('puts the group in front of an app path', () => {
    expect(routeFor('sales', '/orders')).toBe('/sales/orders')
    expect(routeFor('delivery', '/stop/01J9/collect')).toBe('/delivery/stop/01J9/collect')
  })

  it('turns the app root into the group home', () => {
    expect(routeFor('owner', '/')).toBe('/owner')
    expect(routeFor('owner', '')).toBe('/owner')
  })

  it('is idempotent: a path that already carries its base is unchanged', () => {
    expect(routeFor('sales', '/sales/orders')).toBe('/sales/orders')
    expect(routeFor('sales', '/sales')).toBe('/sales')
  })

  it('does not mistake a sibling segment for the base', () => {
    // `/salesman` is not inside `/sales`; the comparison is on the segment, not the characters.
    expect(routeFor('sales', '/salesman')).toBe('/sales/salesman')
    expect(routeFor('owner', '/owners')).toBe('/owner/owners')
  })

  it('leaves the pre-election routes at the root', () => {
    for (const root of ROOT_ROUTES) expect(routeFor('warehouse', root)).toBe(root)
  })

  it('accepts a path written without its leading slash', () => {
    expect(routeFor('manager', 'money')).toBe('/manager/money')
  })

  it('keeps a query string and a fragment on the end, not in the middle', () => {
    expect(routeFor('manager', '/bills?from=2026-09-01')).toBe('/manager/bills?from=2026-09-01')
    expect(routeFor('manager', '/bills#total')).toBe('/manager/bills#total')
  })

  it('never touches an absolute URL — a PDF or a logo is not a route', () => {
    expect(routeFor('owner', 'https://example.test/x.pdf')).toBe('https://example.test/x.pdf')
  })
})

describe('goTo', () => {
  const navigate = vi.fn()
  beforeEach(() => {
    navigate.mockClear()
    setRouterNavigate(navigate)
  })

  it('pushes the prefixed path', () => {
    goTo('sales', '/orders/new', false)
    expect(navigate).toHaveBeenCalledWith('/sales/orders/new', false)
  })

  it('replaces when asked', () => {
    goTo('delivery', '/', true)
    expect(navigate).toHaveBeenCalledWith('/delivery', true)
  })

  it('is inert before the app registers its router, rather than throwing', () => {
    setRouterNavigate(null)
    expect(() => {
      goTo('sales', '/orders', false)
    }).not.toThrow()
  })
})

describe('useGo', () => {
  function Probe(): React.JSX.Element {
    const go = useGo()
    return (
      <a href={go.href('/orders')} data-group={go.group}>
        orders
      </a>
    )
  }

  it('builds hrefs against the group the layout mounted', () => {
    const html = renderToStaticMarkup(
      <GroupProvider group="warehouse">
        <Probe />
      </GroupProvider>,
    )
    expect(html).toContain('href="/warehouse/orders"')
    expect(html).toContain('data-group="warehouse"')
  })

  it('a different group gets a different base from the same screen file', () => {
    const html = renderToStaticMarkup(
      <GroupProvider group="retailer">
        <Probe />
      </GroupProvider>,
    )
    expect(html).toContain('href="/retailer/orders"')
  })

  it('refuses outside a group, instead of quietly building a rootless path', () => {
    expect(() => renderToStaticMarkup(<Probe />)).toThrow(/group/i)
  })
})
