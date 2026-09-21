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
 * ONE APP, TWO ROLES. `permission` is a contract procedure path; `can()` in `app/manager/_layout.tsx` answers
 * it against the signed-in role from the SAME `PERMISSIONS` matrix manager-service enforces. That is
 * the whole mechanism by which this app is the manager's app and the accountant's app at once — the
 * founder's 2026-09-05 decision ("accountant = money desk + reads; NO prices, schemes, credit limits,
 * approvals or settings") is already written into the matrix, so an accountant's rail loses
 * Fulfilment (`warehouse.queue.list` is owner/manager/warehouse) and Prices
 * (`pricing.priceLists.upsert` is owner/manager) without this app carrying a second list of rules.
 */
import { routeFor } from '@dos/ui'
import type { NavSection } from '@dos/ui'

export const SECTIONS: readonly NavSection[] = [
  {
    primary: true,
    items: [
      { href: routeFor('manager', '/'), label: 'Today', permission: 'reporting.dashboard.owner' },
      { href: routeFor('manager', '/orders'), label: 'Orders', permission: 'orders.list' },
      {
        href: routeFor('manager', '/fulfilment'),
        label: 'Fulfilment',
        permission: 'warehouse.queue.list',
      },
      {
        href: routeFor('manager', '/billing'),
        label: 'Billing',
        permission: 'billing.invoices.queue',
      },
    ],
  },
  {
    items: [
      {
        href: routeFor('manager', '/inbound'),
        label: 'Inbound',
        permission: 'procurement.supplierInvoices.list',
      },
      {
        href: routeFor('manager', '/money'),
        label: 'Money',
        permission: 'receivables.receipts.list',
      },
      {
        href: routeFor('manager', '/registers'),
        label: 'Registers',
        permission: 'receivables.journal.list',
      },
      { href: routeFor('manager', '/shops'), label: 'Shops', permission: 'retailers.list' },
      {
        href: routeFor('manager', '/stock'),
        label: 'Stock',
        permission: 'inventory.stock.balances',
      },
    ],
  },
  {
    title: 'SETUP',
    items: [
      {
        href: routeFor('manager', '/prices'),
        label: 'Prices',
        permission: 'pricing.priceLists.upsert',
      },
      // docs/29 §2: who works on this floor and what else their login may open. The accountant's
      // rail loses it, because `tenancy.memberships.update` is owner + manager in the same matrix.
      {
        href: routeFor('manager', '/staff'),
        label: 'Staff',
        permission: 'tenancy.memberships.update',
      },
      {
        href: routeFor('manager', '/messages'),
        label: 'Messages',
        permission: 'notifications.templates.list',
      },
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
  [routeFor('manager', '/orders')]: [
    { href: routeFor('manager', '/orders'), labelKey: 'm2.tab', permission: 'orders.list' },
    {
      href: routeFor('manager', '/orders/drafts'),
      labelKey: 'ai.tab',
      permission: 'ai.drafts.list',
    },
  ],
  [routeFor('manager', '/fulfilment')]: [
    {
      href: routeFor('manager', '/fulfilment'),
      labelKey: 'm5.tab',
      permission: 'warehouse.picklists.list',
    },
    {
      href: routeFor('manager', '/fulfilment/pack'),
      labelKey: 'm20.tab',
      permission: 'warehouse.packs.confirm',
    },
    {
      href: routeFor('manager', '/fulfilment/load-out'),
      labelKey: 'm7.tab',
      permission: 'warehouse.loadSheets.list',
    },
    {
      href: routeFor('manager', '/fulfilment/trips'),
      labelKey: 'm7t.tab',
      permission: 'delivery.trips.list',
    },
  ],
  [routeFor('manager', '/billing')]: [
    {
      href: routeFor('manager', '/billing'),
      labelKey: 'm6.tab',
      permission: 'billing.invoices.queue',
    },
    {
      href: routeFor('manager', '/billing/credit-notes'),
      labelKey: 'm8.tab',
      permission: 'billing.creditNotes.list',
    },
    {
      href: routeFor('manager', '/billing/brand-dms'),
      labelKey: 'm11.tab',
      permission: 'billing.invoices.list',
    },
  ],
  [routeFor('manager', '/inbound')]: [
    {
      href: routeFor('manager', '/inbound'),
      labelKey: 'm4.tab',
      permission: 'procurement.supplierInvoices.list',
    },
    {
      href: routeFor('manager', '/inbound/documents'),
      labelKey: 'm3.tab',
      permission: 'docint.queue.list',
    },
    {
      href: routeFor('manager', '/inbound/gate'),
      labelKey: 'm19.tab',
      permission: 'procurement.grns.count',
    },
  ],
  [routeFor('manager', '/money')]: [
    {
      href: routeFor('manager', '/money'),
      labelKey: 'm9.tab',
      permission: 'receivables.receipts.list',
    },
    {
      href: routeFor('manager', '/money/day-end'),
      labelKey: 'm10.tab',
      permission: 'receivables.receipts.deposit',
    },
    { href: routeFor('manager', '/money/claims'), labelKey: 'm17.tab', permission: 'claims.list' },
  ],
  [routeFor('manager', '/registers')]: [
    {
      href: routeFor('manager', '/registers'),
      labelKey: 'm12.tab',
      permission: 'receivables.journal.list',
    },
    {
      href: routeFor('manager', '/registers/tally'),
      labelKey: 'm13.tab',
      permission: 'integrations.tally.mappings.list',
    },
    {
      href: routeFor('manager', '/registers/team'),
      labelKey: 'm21.tab',
      permission: 'reporting.registers.repProductivity',
    },
  ],
}
