/**
 * The salesperson's navigation, as DATA (docs/08 §0).
 *
 * UX-00 §8.2 fixes this app's tab bar: **Beat · Orders · Shops · Me**, four tabs, on root screens
 * only. `AppShell` builds the phone tab bar from the section marked `primary` and renders the same
 * array as the desk rail above 1024 px — one definition, two shells.
 *
 * There are exactly TWO navigation levels. This is level 1; `PAGE_TABS` below is level 2, and it is
 * where every other screen of docs/23 §3 lives — the catalog and the lapsed list under Shops, the
 * needs-attention tray under Orders, visits, the inbox and the drafts queue under Me. A shop card
 * opened from a beat row is a push, not a third level.
 *
 * `permission` is a contract procedure path; `can()` in `app/_layout.tsx` answers it against the
 * signed-in role from the SAME `PERMISSIONS` matrix sales-service enforces, so a destination that
 * would 403 is never drawn. There is no second permission list in this repo.
 */
import type { NavSection } from '@dos/ui'

export const SECTIONS: readonly NavSection[] = [
  {
    primary: true,
    items: [
      { href: '/', label: 'Beat', permission: 'retailers.beats.assignments.list' },
      { href: '/orders', label: 'Orders', permission: 'orders.list' },
      { href: '/shops', label: 'Shops', permission: 'retailers.list' },
      { href: '/me', label: 'Me', permission: 'incentives.progress.mine' },
    ],
  },
  {
    title: 'SETUP',
    items: [{ href: '/settings', label: 'Settings', permission: 'tenancy.settings.get' }],
  },
]

/**
 * Level 2: the tab row a page draws under its own title.
 *
 * At most FOUR entries per group, and that is not a style note: `<Tabs>` renders `items.slice(0, 4)`
 * and `<Segments>` `items.slice(0, 3)`, both silently — a fifth tab is a screen no sequence of taps
 * can reach, which is exactly how four features went missing in the manager app. `PageTabs` in
 * `src/lib/ui.tsx` refuses to drop one: over four it renders a chip row instead.
 */
export interface PageTab {
  href: string
  labelKey: string
  permission?: string
}

export const PAGE_TABS: Readonly<Record<string, readonly PageTab[]>> = {
  '/orders': [
    { href: '/orders', labelKey: 's6.tab', permission: 'orders.list' },
    { href: '/orders/attention', labelKey: 's5.tab', permission: 'sync.errors.list' },
  ],
  '/shops': [
    { href: '/shops', labelKey: 's2.tab', permission: 'retailers.list' },
    { href: '/shops/lapsed', labelKey: 's10.tab', permission: 'reporting.retailers.lapsed' },
    { href: '/shops/catalog', labelKey: 's11.tab', permission: 'tenantCatalog.list' },
  ],
  '/me': [
    { href: '/me', labelKey: 's9.tab', permission: 'incentives.progress.mine' },
    { href: '/me/visits', labelKey: 's8.tab', permission: 'retailers.visits.list' },
    { href: '/me/drafts', labelKey: 'ai.tab', permission: 'ai.drafts.list' },
    { href: '/me/inbox', labelKey: 's13.tab', permission: 'notifications.messages.list' },
  ],
}
