/**
 * The godown's navigation, as DATA (docs/08 §0).
 *
 * UX-00 §8.2 line 609 fixes this app's tab bar: **Inbound · Pick · Pack · Load**, four tabs, and
 * "Me / inbox" lives in the header account menu rather than stealing a fifth. `AppShell` renders the
 * same array as the desk rail above 1024 px — the gate terminal and the phone in a glove are one
 * definition, two shells.
 *
 * There are exactly TWO navigation levels. This is level 1; `PAGE_TABS` is level 2 and is where the
 * rest of docs/23 §4.1 lives — capture, stock, cycle counts and reservations under Inbound, the van
 * check-in under Load. A gate count opened from a queue row is a push, not a third level.
 *
 * `permission` is a contract procedure path; `can()` in `app/_layout.tsx` answers it against the
 * signed-in role from the SAME `PERMISSIONS` matrix warehouse-service enforces, so a destination that
 * would 403 is never drawn. There is no second permission list in this repo.
 */
import type { NavSection } from '@dos/ui'

export const SECTIONS: readonly NavSection[] = [
  {
    primary: true,
    items: [
      { href: '/', label: 'Inbound', permission: 'procurement.grns.list' },
      { href: '/pick', label: 'Pick', permission: 'warehouse.queue.list' },
      { href: '/pack', label: 'Pack', permission: 'warehouse.packs.list' },
      { href: '/load', label: 'Load', permission: 'warehouse.loadSheets.list' },
    ],
  },
  {
    title: 'SETUP',
    items: [{ href: '/settings', label: 'Settings', permission: 'tenancy.settings.get' }],
  },
]

/**
 * Level 2: the tab row a page draws under its own title.
 *
 * At most FOUR entries per group, and that is not a style note: `<Tabs>` renders `items.slice(0, 4)`
 * silently, so a fifth tab is a screen no sequence of taps can reach. `PageTabs` in `src/lib/ui.tsx`
 * refuses to drop one — over four it renders a chip row instead.
 */
export interface PageTab {
  href: string
  labelKey: string
  permission?: string
}

export const PAGE_TABS: Readonly<Record<string, readonly PageTab[]>> = {
  '/': [
    { href: '/', labelKey: 'w1.tab', permission: 'procurement.grns.list' },
    { href: '/inbound/capture', labelKey: 'w2.tab', permission: 'docint.documents.list' },
    { href: '/stock', labelKey: 'w8.tab', permission: 'inventory.stock.balances' },
    { href: '/stock/counts', labelKey: 'w8c.tab', permission: 'inventory.cycleCounts.list' },
    { href: '/stock/reservations', labelKey: 'w11.tab', permission: 'warehouse.reservations.list' },
  ],
  '/load': [
    { href: '/load', labelKey: 'w7.tab', permission: 'warehouse.loadSheets.list' },
    { href: '/load/trips', labelKey: 'w10.tab', permission: 'delivery.trips.list' },
    { href: '/load/check-in', labelKey: 'w9.tab', permission: 'inventory.stock.balances' },
  ],
}

/** The level-2 group a route belongs to, so a pushed screen keeps its tab row. */
export function groupOf(pathname: string): string {
  if (pathname === '/' || pathname.startsWith('/inbound') || pathname.startsWith('/stock'))
    return '/'
  if (pathname.startsWith('/load')) return '/load'
  return pathname
}
