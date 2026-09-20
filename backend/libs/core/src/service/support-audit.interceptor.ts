import {
  Inject,
  Injectable,
  Optional,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common'
import { catchError, concatMap, from, throwError, type Observable } from 'rxjs'
import type { PlatformAuditAction } from '@dos/contracts'
import { auditLog, platformAudit, withSystem, type Db } from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { DB } from '../platform/db.module.js'
import type { SupportAwareRequest } from '../modules/tenancy/tenant.guard.js'

/**
 * THE "AUDITED" THIRD of the founder's support rule (2026-09-05, docs/22 §2 row 7 and §8: support
 * access is "time-boxed, owner-approved, audited"). `TenantGuard` does the first two — it refuses a
 * pass that has run out and one no owner approved — and this writes the third: one `platform_audit`
 * row per request a Distribution OS administrator made inside a distributor's data, whether it
 * succeeded or not.
 *
 * WHY AN INTERCEPTOR AND NOT THE GUARD. The guard is synchronous by design (an `await` before
 * `AsyncLocalStorage.enterWith` loses the tenant context — see `tenant.guard.ts`), so it cannot wait
 * for a write, and an unawaited insert on the request path is a promise nobody catches. An
 * interceptor runs around the handler and may take as long as it likes AFTER the answer is produced,
 * which is also the honest moment to record the outcome.
 *
 * It is registered globally by `ServiceModule` and costs nothing on a normal request: without a
 * support pass the guard sets no `supportAccess`, and the first line below returns the handler's
 * observable untouched.
 *
 * The row is written with `withSystem()` — `app_worker`, `actor_role = 'system'` — for one reason: the
 * request itself is running as the distributor's OWNER (that is what a support window makes it), and
 * `platform_audit`'s INSERT policy admits `platform_admin` acting as themselves or the system, never
 * an owner. The trail must not depend on the borrowed role of the session it is recording.
 */
@Injectable()
export class SupportAuditInterceptor implements NestInterceptor {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<SupportAwareRequest>()
    const access = req.supportAccess
    if (!access) return next.handle()
    // `concatMap`, not `tap`, so the write is AWAITED inside the interceptor's own chain and a failure
    // reaches the catch below instead of becoming an unhandled rejection.
    //
    // It does not delay the answer, and it cannot: every `@Implement` method takes `@OwnsReply()`,
    // which means oRPC writes the Fastify reply itself from inside the handler — by the time anything
    // here runs, the bytes are on the wire. So the row lands a moment AFTER the read it records, in
    // the same process and the same request, and a failure is logged loudly rather than swallowed.
    // Writing it BEFORE the read would mean recording accesses that never happened; the honest order
    // is the one below. (A spec that asserts on the row therefore polls for it — see
    // `platform-admin.spec.ts` — rather than assuming it is there the instant the reply arrives.)
    return next.handle().pipe(
      concatMap((value: unknown) => from(this.record(access, 'ok')).pipe(concatMap(() => [value]))),
      catchError((error: unknown) =>
        from(this.record(access, 'refused')).pipe(concatMap(() => throwError(() => error))),
      ),
    )
  }

  private async record(
    access: NonNullable<SupportAwareRequest['supportAccess']>,
    outcome: 'ok' | 'refused',
  ): Promise<void> {
    const grantId = access.claims.grantId
    if (!this.db) return
    try {
      await withSystem(this.db, async (tx) => {
        const detail = {
          grantId,
          scope: access.claims.scope,
          method: access.method,
          route: access.route,
          outcome,
        }
        await tx.insert(platformAudit).values({
          id: uuidv7(),
          adminUserId: access.claims.adminUserId,
          action: 'support.read' satisfies PlatformAuditAction,
          tenantId: access.claims.tenantId,
          payload: detail,
        })
        // AND THE SAME FACT IN THE DISTRIBUTOR'S OWN TRAIL (DOS-111). "Audited" is the third of the
        // founder's three words, and until this row existed it was audited for US: `platform_audit`
        // is readable only from the console, so an owner who opened a window could not check that
        // support stayed on the ticket it named while it read their purchase costs and every shop's
        // dues. This row hangs off the GRANT — `support_grant` + the grant id — so it lands beside
        // the `support.approve` and `support.revoke` rows the owner's own decisions wrote
        // (`modules/tenancy/support.service.ts`), and `tenancy.audit.list` shows it on the owner's
        // Settings › Audit and under the window itself.
        //
        // `actor_role` is `platform_admin` and never the owner the request is BORROWING: the row says
        // an outsider read this, which is the only reason it is worth writing. The insert is the same
        // `withSystem` transaction as the platform row above — one round trip, both trails or
        // neither — and `audit_log`'s INSERT policy admits `actor_role = 'system'`, which is what
        // `withSystem` sets.
        await tx.insert(auditLog).values({
          id: uuidv7(),
          tenantId: access.claims.tenantId,
          actorId: access.claims.adminUserId,
          actorRole: 'platform_admin',
          action: 'support.read',
          entityType: 'support_grant',
          entityId: grantId,
          after: detail,
        })
      })
    } catch (error) {
      // A failed audit write must never turn a successful read into an error the caller sees, but it
      // must be loud: this is the record that makes support access acceptable at all.
      console.error(`platform_audit: could not record support access to grant ${grantId}`, error)
    }
  }
}
