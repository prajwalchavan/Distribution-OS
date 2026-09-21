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
import { routeFor } from '@dos/ui'
import type { NavSection } from '@dos/ui'

/**
 * The visible segment this group's routes live under (docs/31 §1.1, architect's ruling Q1).
 *
 * `app/warehouse/pick/index.tsx` resolves to `/warehouse/pick`, not `/pick`, because four apps
 * claimed `/orders` and three claimed `/stock`: a bare path resolved by tree order and not by the
 * elected role. Every href below therefore goes through `routeFor`, which is idempotent, so no
 * reader has to check whether a path has already been based.
 */
export const GROUP = 'warehouse'

/** This group's base in front of an app path — the one place a `/warehouse` prefix is written. */
const route = (path: string): string => routeFor(GROUP, path)

export const SECTIONS: readonly NavSection[] = [
  {
    primary: true,
    items: [
      { href: route('/'), label: 'Inbound', permission: 'procurement.grns.list' },
      { href: route('/pick'), label: 'Pick', permission: 'warehouse.queue.list' },
      { href: route('/pack'), label: 'Pack', permission: 'warehouse.packs.list' },
      { href: route('/load'), label: 'Load', permission: 'warehouse.loadSheets.list' },
    ],
  },
  {
    title: 'SETUP',
    items: [{ href: route('/settings'), label: 'Settings', permission: 'tenancy.settings.get' }],
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
  [route('/')]: [
    { href: route('/'), labelKey: 'w1.tab', permission: 'procurement.grns.list' },
    { href: route('/inbound/capture'), labelKey: 'w2.tab', permission: 'docint.documents.list' },
    { href: route('/stock'), labelKey: 'w8.tab', permission: 'inventory.stock.balances' },
    { href: route('/stock/counts'), labelKey: 'w8c.tab', permission: 'inventory.cycleCounts.list' },
    {
      href: route('/stock/reservations'),
      labelKey: 'w11.tab',
      permission: 'warehouse.reservations.list',
    },
  ],
  [route('/load')]: [
    { href: route('/load'), labelKey: 'w7.tab', permission: 'warehouse.loadSheets.list' },
    { href: route('/load/trips'), labelKey: 'w10.tab', permission: 'delivery.trips.list' },
    { href: route('/load/check-in'), labelKey: 'w9.tab', permission: 'inventory.stock.balances' },
  ],
}

/** The level-2 group a route belongs to, so a pushed screen keeps its tab row. */
export function groupOf(pathname: string): string {
  if (
    pathname === route('/') ||
    pathname.startsWith(route('/inbound')) ||
    pathname.startsWith(route('/stock'))
  )
    return route('/')
  if (pathname.startsWith(route('/load'))) return route('/load')
  return pathname
}
