/**
 * The crew's navigation, as DATA (docs/08 §0) — and it is deliberately the thinnest of the seven.
 *
 * UX-00 §8.2: "Delivery and retailer have no tab bar: single stacks opening on the next stop." So the
 * PRIMARY section is empty on purpose: `AppShell` builds the phone tab bar from it and renders no bar
 * at all when it has no items, which is exactly the shell docs/23 §5 asks for ("one hand, the other
 * has cash in it"). Everything below moves into the header's ⋯ sheet on a phone — where UX-00 §8.2
 * puts trip history and Me — and into the rail on a desk viewport, because the shell follows the
 * VIEWPORT and an office browser opening this app still needs a way around it.
 *
 * `permission` is a contract procedure path; `can()` in `app/_layout.tsx` answers it against the
 * signed-in role from the SAME `PERMISSIONS` matrix delivery-service enforces, so a destination that
 * would 403 is never drawn. There is no second permission list in this repo.
 */
import type { NavSection } from '@dos/ui'

import { strings } from './strings'

export const SECTIONS: readonly NavSection[] = [
  { primary: true, items: [] },
  {
    title: 'TRIP',
    items: [
      { href: '/', label: strings['nav.today'], permission: 'delivery.trips.list' },
      { href: '/day', label: strings['nav.day'], permission: 'delivery.trips.settlementPreview' },
      { href: '/expenses', label: strings['nav.expenses'], permission: 'delivery.expenses.list' },
      { href: '/attention', label: strings['nav.attention'], permission: 'sync.errors.list' },
      { href: '/trips', label: strings['nav.history'], permission: 'delivery.trips.list' },
      { href: '/settings', label: strings['nav.me'], permission: 'tenancy.me' },
    ],
  },
]
