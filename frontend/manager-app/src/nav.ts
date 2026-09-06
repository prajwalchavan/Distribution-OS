/**
 * The manager + accountant rail, as DATA (docs/08 §0), in the order UX-00 §9.0 fixes it for this app:
 *
 *   Today · Orders · Fulfilment · Billing — Inbound · Money · Registers · Shops · Stock
 *   — SETUP: Prices · Messages
 *
 * `AppShell` renders it as the 172 px left rail on a desk viewport (56 px icons below 1100 px) and as
 * the bottom tab bar on a phone, taking the first four items of the section marked `primary`. There
 * are exactly two navigation levels: this is level 1, a page's own `<PageTabs>` row is level 2, and a
 * detail opened from a register row is a side panel over the page rather than a third level.
 *
 * ONE APP, TWO ROLES. `permission` is a contract procedure path; `can()` in `app/_layout.tsx` answers
 * it against the signed-in role from the SAME `PERMISSIONS` matrix manager-service enforces. That is
 * the whole mechanism by which this app is the manager's app and the accountant's app at once — the
 * founder's 2026-09-05 decision ("accountant = money desk + reads; NO prices, schemes, credit limits,
 * approvals or settings") is already written into the matrix, so an accountant's rail loses
 * Fulfilment (`warehouse.queue.list` is owner/manager/warehouse) and Prices
 * (`pricing.priceLists.upsert` is owner/manager) without this app carrying a second list of rules.
 */
import type { NavSection } from '@dos/ui'

export const SECTIONS: readonly NavSection[] = [
  {
    primary: true,
    items: [
      { href: '/', label: 'Today', permission: 'reporting.dashboard.owner' },
      { href: '/orders', label: 'Orders', permission: 'orders.list' },
      { href: '/fulfilment', label: 'Fulfilment', permission: 'warehouse.queue.list' },
      { href: '/billing', label: 'Billing', permission: 'billing.invoices.queue' },
    ],
  },
  {
    items: [
      { href: '/inbound', label: 'Inbound', permission: 'procurement.supplierInvoices.list' },
      { href: '/money', label: 'Money', permission: 'receivables.receipts.list' },
      { href: '/registers', label: 'Registers', permission: 'receivables.journal.list' },
      { href: '/shops', label: 'Shops', permission: 'retailers.list' },
      { href: '/stock', label: 'Stock', permission: 'inventory.stock.balances' },
    ],
  },
  {
    title: 'SETUP',
    items: [
      { href: '/prices', label: 'Prices', permission: 'pricing.priceLists.upsert' },
      { href: '/messages', label: 'Messages', permission: 'notifications.templates.list' },
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
  '/orders': [
    { href: '/orders', labelKey: 'm2.tab', permission: 'orders.list' },
    { href: '/orders/drafts', labelKey: 'ai.tab', permission: 'ai.drafts.list' },
  ],
  '/fulfilment': [
    { href: '/fulfilment', labelKey: 'm5.tab', permission: 'warehouse.picklists.list' },
    { href: '/fulfilment/pack', labelKey: 'm20.tab', permission: 'warehouse.packs.confirm' },
    { href: '/fulfilment/load-out', labelKey: 'm7.tab', permission: 'warehouse.loadSheets.list' },
  ],
  '/billing': [
    { href: '/billing', labelKey: 'm6.tab', permission: 'billing.invoices.queue' },
    { href: '/billing/credit-notes', labelKey: 'm8.tab', permission: 'billing.creditNotes.list' },
    { href: '/billing/brand-dms', labelKey: 'm11.tab', permission: 'billing.invoices.list' },
  ],
  '/inbound': [
    { href: '/inbound', labelKey: 'm4.tab', permission: 'procurement.supplierInvoices.list' },
    { href: '/inbound/documents', labelKey: 'm3.tab', permission: 'docint.queue.list' },
    { href: '/inbound/gate', labelKey: 'm19.tab', permission: 'procurement.grns.count' },
  ],
  '/money': [
    { href: '/money', labelKey: 'm9.tab', permission: 'receivables.receipts.list' },
    { href: '/money/day-end', labelKey: 'm10.tab', permission: 'receivables.receipts.deposit' },
    { href: '/money/claims', labelKey: 'm17.tab', permission: 'claims.list' },
  ],
  '/registers': [
    { href: '/registers', labelKey: 'm12.tab', permission: 'receivables.journal.list' },
    {
      href: '/registers/tally',
      labelKey: 'm13.tab',
      permission: 'integrations.tally.mappings.list',
    },
    {
      href: '/registers/team',
      labelKey: 'm21.tab',
      permission: 'reporting.registers.repProductivity',
    },
  ],
}
