/**
 * Which GROUP of the one app a role opens — docs/31 §1.3 step 7, architect's ruling Q2.
 *
 * The six business apps become six route groups in one Expo project, and the elected role in the
 * token decides which one the person is taken to. `GROUP_OF` is that decision, written once: the
 * root layout redirects with it, the group layout checks it, and `absoluteUrl` and the offline store
 * prefix read it.
 *
 * It is TOTAL over `MembershipRole` — `Record`, not `Partial<Record>` — because ruling Q2 says an
 * unmapped role must sign out rather than redirect to `/undefined`, and the honest way to guarantee
 * that is to make a new role a COMPILE error here instead of a blank screen on a phone. The spec
 * beside this file walks `MembershipRoleSchema.options`, so the enum and this table cannot drift.
 *
 * Two roles share a group on purpose: the accountant is the money desk inside the manager app and
 * always has been (docs/31 ruling Q5) — the split between them is `PERMISSIONS`, which the server
 * enforces and the shell reads, not a second set of screens. `platform_admin` is deliberately absent:
 * it is not a `MembershipRole`, it holds no membership, and the console stays a separate app.
 *
 * It lives in `@dos/api-client` because this is the package that links `@dos/contracts` and already
 * owns the other role-keyed table (`SERVICE_OF`, docs/31 §2). `@dos/ui` must not learn the app's
 * groups: it serves the console, which has none.
 */
import type { MembershipRole } from '@dos/contracts'

/** The six route groups of `frontend/dos-app`. The console is not one of them. */
export type GroupName = 'owner' | 'manager' | 'sales' | 'warehouse' | 'delivery' | 'retailer'

export const GROUP_NAMES: readonly GroupName[] = [
  'owner',
  'manager',
  'sales',
  'warehouse',
  'delivery',
  'retailer',
]

export const GROUP_OF: Record<MembershipRole, GroupName> = {
  owner: 'owner',
  manager: 'manager',
  accountant: 'manager',
  salesperson: 'sales',
  warehouse: 'warehouse',
  delivery: 'delivery',
  retailer: 'retailer',
}

/**
 * The group for a role the app has, when it has one.
 *
 * The token's `role` claim is typed `MembershipRole`, so the lookup cannot miss — but a session
 * restored from an older build, or a role added to the enum and not to this table, would hand a
 * string this app has no group for. Callers get `null` and sign the person out (ruling Q2), which is
 * the one behaviour that never shows somebody another role's screen.
 */
export function groupOf(role: string | null | undefined): GroupName | null {
  if (role === null || role === undefined) return null
  return (GROUP_OF as Readonly<Record<string, GroupName | undefined>>)[role] ?? null
}
