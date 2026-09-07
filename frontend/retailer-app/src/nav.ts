/**
 * The shopkeeper's navigation, as DATA (docs/08 §0).
 *
 * UX-00 §8.2 and docs/23 §6.1: "Delivery and retailer have no tab bar." So the PRIMARY section is
 * deliberately EMPTY — `AppShell` builds the phone tab bar from it and draws no bar at all when it
 * has no items, which is the shell docs/23 §6 asks for ("the detail view for a WhatsApp message").
 * Everything below moves into the header's ⋯ sheet on a phone and into the rail on a desk viewport,
 * because the shell follows the VIEWPORT, not the app.
 *
 * The account menu deliberately carries ONLY "Change your password": with no tab bar the shell merges
 * the nav sections and the account items into one sheet, so a destination that is already an item
 * here would be listed twice (the defect the delivery gate found on the Pixel 7).
 *
 * `permission` is a contract procedure path; `can()` in `app/_layout.tsx` answers it against the
 * signed-in role from the SAME `PERMISSIONS` matrix retailer-service enforces, so a destination that
 * would 403 is never drawn. There is no second permission list in this repo.
 */
import type { NavSection } from '@dos/ui'

import { strings } from './strings'

export const SECTIONS: readonly NavSection[] = [
  { primary: true, items: [] },
  {
    title: 'SHOP',
    items: [
      { href: '/', label: strings['nav.home'], permission: 'tenancy.me' },
      { href: '/order', label: strings['nav.order'], permission: 'orders.create' },
      { href: '/orders', label: strings['nav.orders'], permission: 'orders.list' },
      { href: '/deals', label: strings['nav.deals'], permission: 'pricing.schemes.list' },
    ],
  },
  {
    title: 'MONEY',
    items: [
      { href: '/dues', label: strings['nav.dues'], permission: 'receivables.outstanding.get' },
      { href: '/bills', label: strings['nav.bills'], permission: 'billing.invoices.list' },
      {
        href: '/receipts',
        label: strings['nav.receipts'],
        permission: 'receivables.receipts.list',
      },
      { href: '/statement', label: strings['nav.statement'], permission: 'receivables.ledger.get' },
      { href: '/returns', label: strings['nav.returns'], permission: 'billing.creditNotes.list' },
    ],
  },
  {
    title: 'YOU',
    items: [
      { href: '/inbox', label: strings['nav.inbox'], permission: 'notifications.messages.list' },
      { href: '/shop', label: strings['nav.shop'], permission: 'retailers.updateOwn' },
      { href: '/settings', label: strings['nav.account'], permission: 'tenancy.me' },
    ],
  },
]

/**
 * Level 2: the tab row a page draws under its own title. Two navigation levels, never three.
 *
 * At most FOUR entries per group is not a style note — `<Tabs>` renders `items.slice(0, 4)` silently.
 * `PageTabs` in `src/lib/ui.tsx` refuses to drop one: over four it renders a chip row instead.
 */
export interface PageTab {
  href: string
  labelKey: string
  permission?: string
}

export const PAGE_TABS: Readonly<Record<string, readonly PageTab[]>> = {
  '/dues': [
    { href: '/dues', labelKey: 'nav.dues', permission: 'receivables.outstanding.get' },
    { href: '/bills', labelKey: 'nav.bills', permission: 'billing.invoices.list' },
    { href: '/receipts', labelKey: 'nav.receipts', permission: 'receivables.receipts.list' },
    { href: '/statement', labelKey: 'nav.statement', permission: 'receivables.ledger.get' },
  ],
}
