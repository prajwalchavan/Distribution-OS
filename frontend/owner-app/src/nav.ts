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
 * `permission` is a contract procedure path. `can()` in `app/_layout.tsx` answers it against the
 * signed-in role from the SAME `PERMISSIONS` matrix owner-service enforces, so the rail can never
 * show a destination that would answer 403 — and the app carries no second permission list.
 */
import type { NavSection } from '@dos/ui'

export const SECTIONS: readonly NavSection[] = [
  {
    primary: true,
    items: [
      { href: '/', label: 'Today', permission: 'reporting.dashboard.owner' },
      { href: '/orders', label: 'Orders', permission: 'orders.list' },
      { href: '/money', label: 'Money', permission: 'receivables.outstanding.list' },
      { href: '/shops', label: 'Shops', permission: 'retailers.list' },
    ],
  },
  {
    items: [
      { href: '/billing', label: 'Billing', permission: 'billing.invoices.list' },
      { href: '/stock', label: 'Stock', permission: 'inventory.stock.balances' },
      { href: '/reports', label: 'Reports', permission: 'reporting.series.get' },
    ],
  },
  {
    title: 'SETUP',
    items: [
      { href: '/prices', label: 'Prices', permission: 'pricing.priceLists.list' },
      { href: '/staff', label: 'Staff', permission: 'tenancy.staff.list' },
      { href: '/settings', label: 'Settings', permission: 'tenancy.settings.get' },
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
  '/': [
    { href: '/', labelKey: 'o1.tab', permission: 'reporting.dashboard.owner' },
    { href: '/approvals', labelKey: 'o3.tab', permission: 'orders.approvals.list' },
    { href: '/map', labelKey: 'o4.tab', permission: 'delivery.vehicles.positions' },
  ],
  '/orders': [
    { href: '/orders', labelKey: 'o5.tab', permission: 'orders.list' },
    { href: '/orders/trips', labelKey: 'o18.tab', permission: 'delivery.trips.list' },
  ],
  '/billing': [
    { href: '/billing', labelKey: 'o13.tab', permission: 'billing.invoices.list' },
    { href: '/billing/credit-notes', labelKey: 'o14.tab', permission: 'billing.creditNotes.list' },
  ],
  '/money': [
    { href: '/money', labelKey: 'o10.tab', permission: 'receivables.outstanding.list' },
    { href: '/money/receipts', labelKey: 'o11.tab', permission: 'receivables.receipts.list' },
    { href: '/money/books', labelKey: 'o12.tab', permission: 'receivables.journal.list' },
    { href: '/money/claims', labelKey: 'o19.tab', permission: 'claims.list' },
  ],
  '/stock': [
    { href: '/stock', labelKey: 'o15.tab', permission: 'inventory.stock.balances' },
    { href: '/stock/inbound', labelKey: 'o16.tab', permission: 'procurement.grns.list' },
    { href: '/stock/documents', labelKey: 'o26.tab', permission: 'docint.queue.list' },
    { href: '/stock/catalog', labelKey: 'o9.tab', permission: 'tenantCatalog.list' },
  ],
  '/reports': [
    { href: '/reports', labelKey: 'o2.tab', permission: 'reporting.series.get' },
    { href: '/reports/profit', labelKey: 'o17.tab', permission: 'reporting.series.grossMargin' },
    { href: '/reports/incentives', labelKey: 'o20.tab', permission: 'incentives.targets.list' },
    { href: '/reports/exports', labelKey: 'o22.tab', permission: 'integrations.exports.list' },
  ],
  '/settings': [
    { href: '/settings', labelKey: 'o24.tab', permission: 'tenancy.settings.get' },
    { href: '/settings/imports', labelKey: 'o21.tab', permission: 'integrations.imports.list' },
    {
      href: '/settings/notifications',
      labelKey: 'o23.tab',
      permission: 'notifications.templates.list',
    },
    { href: '/settings/audit', labelKey: 'o25.tab', permission: 'tenancy.audit.list' },
  ],
}
