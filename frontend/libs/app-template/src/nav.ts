/**
 * This app's navigation, as DATA (docs/08 section 0).
 *
 * `AppShell` renders it as the left rail of UX-00 section 8.1 on a desk viewport and as the bottom
 * tabs of section 8.2 on a phone — the same array, two shells, no second definition. Two navigation
 * levels maximum: this is level 1; a page's own tab row is level 2; there is no level 3.
 *
 * `permission` names what a role must hold to see the item; `can()` in the root layout answers it
 * against the signed-in membership, so a rail never shows a destination that would 403.
 */
import type { NavSection } from '@dos/ui'

export const SECTIONS: readonly NavSection[] = [
  {
    primary: true,
    items: [
      { href: '/', label: 'Today' },
      { href: '/settings', label: 'Settings' },
    ],
  },
]
