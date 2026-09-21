/**
 * WHICH SERVICE A ROLE TALKS TO — docs/31 §2.
 *
 * The six per-role apps each knew one service, because each app WAS one role. The one app knows all
 * six and asks the ELECTED role which one this request belongs to. That is the whole of the merge on
 * the wire: docs/29 §0 is untouched, the server still runs one service per role, and a sales screen
 * still never reaches owner-service — it cannot even name it.
 *
 * Two deployments, one table:
 *
 *   serviceFor('delivery')                              → http://127.0.0.1:3005   (split, this Mac)
 *   serviceFor('delivery', 'https://api.example.in')    → https://api.example.in/delivery
 *
 * The prefixes are docs/26 §7's table verbatim. `/auth` is the auth service's own and is NOT here:
 * `AUTH_URL` points at it directly and never moves with the elected role.
 *
 * `accountant` shares manager-service, which is not a shortcut: the accountant is the money desk
 * inside the manager app and always has been (docs/31 ruling Q5). What separates the two is
 * `PERMISSIONS`, which the server enforces and the shell reads.
 *
 * `platform_admin` is deliberately absent. It is not a `MembershipRole`, it holds no membership, and
 * admin-service (:3007) is reached by the console's own client (`platform-client.ts`) — the one app
 * must not be able to name it at all.
 */
import type { MembershipRole } from '@dos/contracts'

export interface ServiceOf {
  /** The port this service listens on when each runs on its own (this Mac, and `docs/28`). */
  readonly port: number
  /** The path it is mounted behind in the ALL-IN-ONE process (docs/26 §7). */
  readonly prefix: string
}

/**
 * TOTAL over `MembershipRole` — `Record`, not `Partial<Record>` — for the same reason `GROUP_OF` is:
 * a role added to the contract's enum and not to this table must be a COMPILE error here, never a
 * request that silently leaves for the wrong origin. The spec beside this file walks
 * `MembershipRoleSchema.options`, so the enum and this table cannot drift.
 */
export const SERVICE_OF: Record<MembershipRole, ServiceOf> = {
  owner: { port: 3001, prefix: '/owner' },
  manager: { port: 3002, prefix: '/manager' },
  accountant: { port: 3002, prefix: '/manager' },
  salesperson: { port: 3003, prefix: '/sales' },
  warehouse: { port: 3004, prefix: '/warehouse' },
  delivery: { port: 3005, prefix: '/delivery' },
  retailer: { port: 3006, prefix: '/retailer' },
}

/**
 * The base URL for this role's service.
 *
 * With no `base` every service is its own origin on the loopback — the split mode this Mac runs and
 * every gate walks. With a `base` there is ONE origin and each service is a path under it, which is
 * the only shape a phone build can carry: an app cannot be handed six hostnames at build time.
 *
 * A trailing slash on the base is dropped, so `https://api.example.in/` and `https://api.example.in`
 * are the same origin rather than two, one of which double-slashes every path it builds.
 */
export function serviceFor(role: MembershipRole, base?: string): string {
  const service = SERVICE_OF[role]
  if (base === undefined || base === '') return `http://127.0.0.1:${String(service.port)}`
  return `${base.replace(/\/$/, '')}${service.prefix}`
}
