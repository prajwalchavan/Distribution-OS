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
 * `permission` is a contract procedure path; `can()` in `app/retailer/_layout.tsx` answers it against the
 * signed-in role from the SAME `PERMISSIONS` matrix retailer-service enforces, so a destination that
 * would 403 is never drawn. There is no second permission list in this repo.
 */
import { routeFor } from '@dos/ui'
import type { NavSection } from '@dos/ui'

import { strings } from './strings'

/**
 * The one app gives every group a VISIBLE segment (docs/31 §1.1, ruling Q1), so a shop's `/dues` is
 * `/retailer/dues` and nothing here writes that base by hand. `routeFor` applies it once and is
 * idempotent, and the group name is the ONE literal this file carries.
 */
const GROUP = 'retailer'

export const SECTIONS: readonly NavSection[] = [
  { primary: true, items: [] },
  {
    title: 'SHOP',
    items: [
      { href: routeFor(GROUP, '/'), label: strings['nav.home'], permission: 'tenancy.me' },
      { href: routeFor(GROUP, '/order'), label: strings['nav.order'], permission: 'orders.create' },
      { href: routeFor(GROUP, '/orders'), label: strings['nav.orders'], permission: 'orders.list' },
      {
        href: routeFor(GROUP, '/deals'),
        label: strings['nav.deals'],
        permission: 'pricing.schemes.list',
      },
    ],
  },
  {
    title: 'MONEY',
    items: [
      {
        href: routeFor(GROUP, '/dues'),
        label: strings['nav.dues'],
        permission: 'receivables.outstanding.get',
      },
      {
        href: routeFor(GROUP, '/bills'),
        label: strings['nav.bills'],
        permission: 'billing.invoices.list',
      },
      {
        href: routeFor(GROUP, '/receipts'),
        label: strings['nav.receipts'],
        permission: 'receivables.receipts.list',
      },
      {
        href: routeFor(GROUP, '/statement'),
        label: strings['nav.statement'],
        permission: 'receivables.ledger.get',
      },
      {
        href: routeFor(GROUP, '/returns'),
        label: strings['nav.returns'],
        permission: 'billing.creditNotes.list',
      },
    ],
  },
  {
    title: 'YOU',
    items: [
      {
        href: routeFor(GROUP, '/inbox'),
        label: strings['nav.inbox'],
        permission: 'notifications.messages.list',
      },
      {
        href: routeFor(GROUP, '/shop'),
        label: strings['nav.shop'],
        permission: 'retailers.updateOwn',
      },
      {
        href: routeFor(GROUP, '/settings'),
        label: strings['nav.account'],
        permission: 'tenancy.me',
      },
    ],
  },
]

/**
 * Level 2: the tab row a page draws under its own title. Two navigation levels, never three.
 *
 * At most FOUR entries per group is not a style note — `<Tabs>` renders `items.slice(0, 4)` silently.
 * `PageTabs` in `src/groups/retailer/lib/ui.tsx` refuses to drop one: over four it renders a chip row instead.
 */
export interface PageTab {
  href: string
  labelKey: string
  permission?: string
}

export const PAGE_TABS: Readonly<Record<string, readonly PageTab[]>> = {
  [routeFor(GROUP, '/dues')]: [
    {
      href: routeFor(GROUP, '/dues'),
      labelKey: 'nav.dues',
      permission: 'receivables.outstanding.get',
    },
    { href: routeFor(GROUP, '/bills'), labelKey: 'nav.bills', permission: 'billing.invoices.list' },
    {
      href: routeFor(GROUP, '/receipts'),
      labelKey: 'nav.receipts',
      permission: 'receivables.receipts.list',
    },
    {
      href: routeFor(GROUP, '/statement'),
      labelKey: 'nav.statement',
      permission: 'receivables.ledger.get',
    },
  ],
}
