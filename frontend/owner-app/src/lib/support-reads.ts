/**
 * What an outsider read inside these books, as pure rules over the tenant's own audit rows (DOS-111).
 *
 * `support-audit.interceptor.ts` writes one `audit_log` row per request a Distribution OS
 * administrator makes under a window this distributor approved: `action: 'support.read'`,
 * `entityType: 'support_grant'`, `entityId` the grant, `actorRole: 'platform_admin'`, and the route
 * in `after`. `tenancy.audit.list` serves them beside the owner's own rows, so Settings › Audit shows
 * them in the register and Settings › Support access lists the ones made under the open window.
 *
 * Nothing renders here — no React, no `@dos/ui` — so the rules are testable in Node.
 */
import type { AuditEntry } from '@dos/contracts'

/** The fields these rules read; `AuditEntry` satisfies it. */
export type AuditRow = Pick<
  AuditEntry,
  'id' | 'actorId' | 'actorRole' | 'action' | 'entityType' | 'entityId' | 'after' | 'occurredAt'
>

/** `action` and `entityType` of a row the support window wrote. */
export const SUPPORT_READ_ACTION = 'support.read'
export const SUPPORT_GRANT_ENTITY = 'support_grant'

/**
 * Who an audit row names.
 *
 * A platform administrator holds NO membership of this distributorship — that is what
 * `platform_admin` means — so the staff directory cannot name them and `names.staff()` falls back to
 * eight characters of a uuid. The honest label for that row is WHAT they are: the same word the role
 * column already prints, which the catalogue translates.
 */
export function auditWho(
  row: Pick<AuditRow, 'actorId' | 'actorRole'>,
  staff: (id: string) => string,
  word: (value: string) => string,
): string {
  return row.actorRole === 'platform_admin' ? word(row.actorRole) : staff(row.actorId)
}

/** One call made under a window: when, and the route it asked for. */
export interface SupportRead {
  id: string
  at: string
  /** `GET /retailers`. Null for a row whose payload is not the shape this build knows. */
  route: string | null
}

/**
 * The reads made under ONE window, newest first.
 *
 * Filtered by the GRANT and not by the tenant: the panel's heading says "under this window", and a
 * tenant filter would put last week's window's reads under this one's heading. The grant's own
 * `support.approve` and `support.revoke` rows hang off the same id and are not reads, so the action
 * is checked too.
 */
export function supportReads(rows: readonly AuditRow[], grantId: string): readonly SupportRead[] {
  return rows
    .filter(
      (row) =>
        row.action === SUPPORT_READ_ACTION &&
        row.entityType === SUPPORT_GRANT_ENTITY &&
        row.entityId === grantId,
    )
    .map((row) => ({ id: row.id, at: row.occurredAt, route: routeOf(row.after) }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

/**
 * `after` is free-form JSON. The `support.read` rows put the request there as
 * `route: "GET /retailers"` — the one field these panels print; anything else (an older build, a
 * shape that changes) has no route rather than a guess.
 */
export function routeOf(after: Readonly<Record<string, unknown>> | null): string | null {
  const route = after?.['route']
  return typeof route === 'string' ? route : null
}
