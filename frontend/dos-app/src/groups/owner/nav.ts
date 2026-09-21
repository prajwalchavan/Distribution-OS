/**
 * The owner rail, as DATA (docs/08 §0), in the order UX-00 §8.1 fixes it:
 *
 *   Today · Orders · Billing · Money · Stock · Shops · Reports — SETUP: Prices · Staff · Settings
 *
 * `AppShell` renders it as the 172 px left rail on a desk viewport (56 px icons below 1100 px) and as
 * the bottom tab bar on a phone, taking the first four items of the section marked `primary`. There
 * are exactly two navigation levels: this is level 1, a page's own `<PageTabs>` row is level 2, and a
 * detail opened from a register row is a side panel over the page rather than a third level.
 *
 * `permission` is a contract procedure path. `can()` in `app/owner/_layout.tsx` answers it against
 * the signed-in role from the SAME `PERMISSIONS` matrix owner-service enforces, so the rail can never
 * show a destination that would answer 403 — and the app carries no second permission list.
 *
 * Every href and every `PAGE_TABS` key below goes through `routeFor(GROUP, …)` (docs/31 §1.1, ruling
 * Q1): in the one app the owner's screens live under a VISIBLE `/owner` segment, and a bare `/orders`
 * is claimed by four groups. This file is the one place outside React that writes a route, so it
 * names its group; a SCREEN never does — it asks `useGo()`.
 */
import { routeFor, type NavSection } from '@dos/ui'

/** This file's group. The one place in `src/groups/owner/` that spells it. */
const GROUP = 'owner'

export const SECTIONS: readonly NavSection[] = [
  {
    primary: true,
    items: [
      { href: routeFor(GROUP, '/'), label: 'Today', permission: 'reporting.dashboard.owner' },
      { href: routeFor(GROUP, '/orders'), label: 'Orders', permission: 'orders.list' },
      {
        href: routeFor(GROUP, '/money'),
        label: 'Money',
        permission: 'receivables.outstanding.list',
      },
      { href: routeFor(GROUP, '/shops'), label: 'Shops', permission: 'retailers.list' },
    ],
  },
  {
    items: [
      { href: routeFor(GROUP, '/billing'), label: 'Billing', permission: 'billing.invoices.list' },
      { href: routeFor(GROUP, '/stock'), label: 'Stock', permission: 'inventory.stock.balances' },
      { href: routeFor(GROUP, '/reports'), label: 'Reports', permission: 'reporting.series.get' },
    ],
  },
  {
    title: 'SETUP',
    items: [
      { href: routeFor(GROUP, '/prices'), label: 'Prices', permission: 'pricing.priceLists.list' },
      { href: routeFor(GROUP, '/staff'), label: 'Staff', permission: 'tenancy.staff.list' },
      { href: routeFor(GROUP, '/settings'), label: 'Settings', permission: 'tenancy.settings.get' },
    ],
  },
]

/**
 * Level 2: the tab row a page draws under its own title. At most four per UX-00 §6.10, and every
 * entry is a route of this app — never a state a refresh would lose.
 */
export interface PageTab {
  href: string
  labelKey: string
  permission?: string
}

export const PAGE_TABS: Readonly<Record<string, readonly PageTab[]>> = {
  [routeFor(GROUP, '/')]: [
    { href: routeFor(GROUP, '/'), labelKey: 'o1.tab', permission: 'reporting.dashboard.owner' },
    {
      href: routeFor(GROUP, '/approvals'),
      labelKey: 'o3.tab',
      permission: 'orders.approvals.list',
    },
    {
      href: routeFor(GROUP, '/map'),
      labelKey: 'o4.tab',
      permission: 'delivery.vehicles.positions',
    },
  ],
  [routeFor(GROUP, '/orders')]: [
    { href: routeFor(GROUP, '/orders'), labelKey: 'o5.tab', permission: 'orders.list' },
    {
      href: routeFor(GROUP, '/orders/trips'),
      labelKey: 'o18.tab',
      permission: 'delivery.trips.list',
    },
  ],
  [routeFor(GROUP, '/billing')]: [
    { href: routeFor(GROUP, '/billing'), labelKey: 'o13.tab', permission: 'billing.invoices.list' },
    {
      href: routeFor(GROUP, '/billing/credit-notes'),
      labelKey: 'o14.tab',
      permission: 'billing.creditNotes.list',
    },
  ],
  [routeFor(GROUP, '/money')]: [
    {
      href: routeFor(GROUP, '/money'),
      labelKey: 'o10.tab',
      permission: 'receivables.outstanding.list',
    },
    {
      href: routeFor(GROUP, '/money/receipts'),
      labelKey: 'o11.tab',
      permission: 'receivables.receipts.list',
    },
    {
      href: routeFor(GROUP, '/money/books'),
      labelKey: 'o12.tab',
      permission: 'receivables.journal.list',
    },
    { href: routeFor(GROUP, '/money/claims'), labelKey: 'o19.tab', permission: 'claims.list' },
  ],
  [routeFor(GROUP, '/stock')]: [
    {
      href: routeFor(GROUP, '/stock'),
      labelKey: 'o15.tab',
      permission: 'inventory.stock.balances',
    },
    {
      href: routeFor(GROUP, '/stock/inbound'),
      labelKey: 'o16.tab',
      permission: 'procurement.grns.list',
    },
    {
      href: routeFor(GROUP, '/stock/documents'),
      labelKey: 'o26.tab',
      permission: 'docint.queue.list',
    },
    {
      href: routeFor(GROUP, '/stock/catalog'),
      labelKey: 'o9.tab',
      permission: 'tenantCatalog.list',
    },
  ],
  [routeFor(GROUP, '/reports')]: [
    { href: routeFor(GROUP, '/reports'), labelKey: 'o2.tab', permission: 'reporting.series.get' },
    {
      href: routeFor(GROUP, '/reports/profit'),
      labelKey: 'o17.tab',
      permission: 'reporting.series.grossMargin',
    },
    {
      href: routeFor(GROUP, '/reports/incentives'),
      labelKey: 'o20.tab',
      permission: 'incentives.targets.list',
    },
    {
      href: routeFor(GROUP, '/reports/exports'),
      labelKey: 'o22.tab',
      permission: 'integrations.exports.list',
    },
  ],
  [routeFor(GROUP, '/settings')]: [
    { href: routeFor(GROUP, '/settings'), labelKey: 'o24.tab', permission: 'tenancy.settings.get' },
    {
      href: routeFor(GROUP, '/settings/imports'),
      labelKey: 'o21.tab',
      permission: 'integrations.imports.list',
    },
    {
      href: routeFor(GROUP, '/settings/notifications'),
      labelKey: 'o23.tab',
      permission: 'notifications.templates.list',
    },
    {
      href: routeFor(GROUP, '/settings/audit'),
      labelKey: 'o25.tab',
      permission: 'tenancy.audit.list',
    },
  ],
}
