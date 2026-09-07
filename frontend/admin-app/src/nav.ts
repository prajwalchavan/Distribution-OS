/**
 * The console rail, as DATA (docs/08 §0).
 *
 *   Platform · Distributors · Subscriptions · Support — DIRECTORY: People · Audit trail · Account
 *
 * `AppShell` renders it as the 172 px left rail on a desk viewport (56 px icons below 1100 px) and as
 * the bottom tab bar on a phone, taking the first four items of the section marked `primary`. This
 * app is desk-first — a console is used at a desk — but it is the same universal build as the other
 * six, so the phone shell is not a second app, it is the same screens narrower.
 *
 * `permission` is a contract procedure path, answered by `can()` in `app/_layout.tsx` against the
 * SAME `PERMISSIONS` matrix admin-service enforces. Every row here is `ROLE_GROUPS.PLATFORM`, so on
 * this app the matrix mostly proves a negative: a token that is not `platform_admin` reaches nothing,
 * and `TenantGuard` refuses it at the service gate before any handler runs.
 */
import type { NavSection } from '@dos/ui'

export const SECTIONS: readonly NavSection[] = [
  {
    primary: true,
    items: [
      { href: '/', label: 'Platform', permission: 'admin.metrics.overview' },
      { href: '/distributors', label: 'Distributors', permission: 'admin.tenants.list' },
      { href: '/subscriptions', label: 'Subscriptions', permission: 'admin.subscriptions.list' },
      { href: '/support', label: 'Support', permission: 'admin.support.list' },
    ],
  },
  {
    title: 'DIRECTORY',
    items: [
      { href: '/users', label: 'People', permission: 'admin.users.list' },
      { href: '/audit', label: 'Audit trail', permission: 'admin.audit.list' },
      { href: '/settings', label: 'Account' },
    ],
  },
]
