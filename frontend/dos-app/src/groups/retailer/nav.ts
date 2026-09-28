/**
 * The shopkeeper's navigation, as DATA (docs/08 §0).
 *
 * THE FOUR ENTRIES A SHOPPING APP HAS (founder, 2026-09-28): Shop (the home), Orders, Money, Me. They
 * are the PRIMARY section, so `AppShell` draws them as the phone's tab bar and at the top of the desk
 * rail. This replaces the design system's sentence "Delivery and retailer have no tab bar: single
 * stacks opening on the next stop / the last bill." (UX-00 §8.2, repeated in docs/23 §6 as "13
 * screens, no tab bar") for the retailer: the founder's decision of 2026-09-28 — "minimise the
 * understanding effort", "a shopping app feel" — outranks it. Nothing was removed to make room: every
 * other page is reachable from inside the four (Money's own tab row holds bills, payments and the
 * account book; Me lists the rest), and the MORE section below keeps each one a destination of its
 * own — in the rail on a desk and in the header's ⋯ sheet on a phone.
 *
 * "Place an order" (`/order`) is no longer an entry: it is the shop's basket now, opened from the cart
 * bar at the foot of every shopping screen and from "See all items" on the home.
 *
 * The account menu deliberately carries ONLY "Change your password": the ⋯ sheet merges the nav
 * sections and the account items, so a destination that is already an item here would be listed twice
 * (the defect the delivery gate found on the Pixel 7).
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
  {
    primary: true,
    items: [
      { href: routeFor(GROUP, '/'), label: strings['nav.tabShop'], permission: 'tenancy.me' },
      {
        href: routeFor(GROUP, '/orders'),
        label: strings['nav.tabOrders'],
        permission: 'orders.list',
      },
      {
        href: routeFor(GROUP, '/dues'),
        label: strings['nav.tabMoney'],
        permission: 'receivables.outstanding.get',
      },
      { href: routeFor(GROUP, '/profile'), label: strings['nav.tabMe'], permission: 'tenancy.me' },
    ],
  },
  {
    title: strings['nav.moreSection'],
    items: [
      {
        href: routeFor(GROUP, '/deals'),
        label: strings['nav.deals'],
        permission: 'pricing.schemes.list',
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
 * Which tab a page that is not itself an entry belongs to, so the tab bar says where the shop is: a
 * brand page and the basket are the Shop, paying is Money. A page that IS an entry lights itself.
 */
export function tabOf(pathname: string): string {
  const shop = routeFor(GROUP, '/')
  const inside = (path: string): boolean => {
    const base = routeFor(GROUP, path)
    return pathname === base || pathname.startsWith(`${base}/`)
  }
  if (inside('/order') || inside('/brand')) return shop
  if (inside('/pay')) return routeFor(GROUP, '/dues')
  return pathname
}

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
