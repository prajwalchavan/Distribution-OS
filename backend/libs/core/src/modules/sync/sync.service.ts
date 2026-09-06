import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, desc, eq, gte, isNull, lt, type SQL } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import { createHash } from 'node:crypto'
import {
  SYNC_PROTOCOL_VERSION,
  type MembershipRole,
  type SyncErrorsListInput,
  type SyncErrorsListOutput,
  type SyncManifestInput,
  type SyncManifestOutput,
  type SyncOp,
  type SyncPullInput,
  type SyncPullOutput,
  type SyncUploadInput,
  type SyncUploadOutput,
} from '@dos/contracts'
import { MAX_CLOCK_SKEW_MS, uuidv7 } from '@dos/domain'
import { syncErrors, syncOps, withTenant, type ActorRole, type Db } from '@dos/db'
import {
  ANY_MEMBER,
  currentTenant,
  DB,
  requireDb,
  requireRole,
  STAFF,
} from '../../platform/index.js'
import { SyncRegistry, SyncRejection, vetoIfStale } from './sync.registry.js'

type In = z.infer<typeof SyncUploadInput>
type Out = z.infer<typeof SyncUploadOutput>
type Rejection = Out['rejected'][number]
type ErrorsIn = z.infer<typeof SyncErrorsListInput>
type ErrorsOut = z.infer<typeof SyncErrorsListOutput>
type PullIn = z.infer<typeof SyncPullInput>
type PullOut = z.infer<typeof SyncPullOutput>
type ManifestIn = z.infer<typeof SyncManifestInput>
type ManifestOut = z.infer<typeof SyncManifestOutput>

/** The desk reads everyone's rejections for support triage; a field role reads its own. */
const TRIAGE: readonly ActorRole[] = ['owner', 'manager', 'accountant', 'system']

/**
 * A pull cursor is good to `asOf - PULL_OVERLAP_MS`: a row committed just before the cursor by a
 * transaction that started earlier is still caught by the next pull, at the price of a few rows the
 * device sees twice (it upserts by id, so twice is harmless).
 */
const PULL_OVERLAP_MS = 5_000

@Injectable()
export class SyncService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly registry: SyncRegistry,
  ) {}

  /**
   * Each op is its own transaction: one bad row must not block the rest of the batch. Outcomes are durable in
   * sync_ops (>= 180 days) so a device that retries after a lost response replays without side effects.
   */
  async upload(input: In): Promise<Out> {
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const out: Out = {
      accepted: 0,
      replayed: 0,
      rejected: [],
      warnings: [],
      upgradeRequired: false,
    }
    if (input.protocol !== SYNC_PROTOCOL_VERSION) {
      // Old app build: answer 2xx so the device queue is not wedged, but reject everything and ask for an upgrade.
      out.upgradeRequired = true
      for (const op of input.ops)
        out.rejected.push(
          reject(op, 'protocol_unsupported', 'App update required', 'ऐप अपडेट ज़रूरी है'),
        )
      return out
    }
    const now = Date.now()
    for (const op of input.ops) {
      if (op.clientTime) {
        const skew = Math.abs(now - Date.parse(op.clientTime))
        if (Number.isFinite(skew) && skew > MAX_CLOCK_SKEW_MS)
          out.warnings.push({
            opId: op.opId,
            code: 'clock_skew',
            messageEn: `device clock is off by ${Math.round(skew / 60_000)} min`,
          })
      }
      const result = await withTenant(db, ctx, async (tx) => {
        const [prior] = await tx
          .select({ outcome: syncOps.outcome })
          .from(syncOps)
          .where(
            and(
              eq(syncOps.tenantId, ctx.tenantId),
              eq(syncOps.deviceId, input.deviceId),
              eq(syncOps.opId, op.opId),
            ),
          )
        if (prior)
          return {
            replayed: true,
            outcome: prior.outcome as { ok: boolean; rejection?: Rejection },
          }
        const handler = this.registry.get(op.table)
        let outcome: { ok: boolean; rejection?: Rejection }
        if (!handler) {
          outcome = {
            ok: false,
            rejection: reject(
              op,
              'unknown_table',
              `No sync handler for ${op.table}`,
              `${op.table} के लिए सिंक समर्थित नहीं`,
            ),
          }
        } else {
          try {
            // Savepoint so a rejected op leaves no partial writes but the sync_ops/sync_errors rows still commit.
            await tx.transaction(async (inner) => {
              // The LWW veto, applied to every table by the uploader rather than remembered by each
              // module's handler (sync.registry.ts `vetoIfStale`): an edit whose base is older than
              // the server's row is refused `stale`, still 2xx, and the tray tells the user why.
              await vetoIfStale(inner, op)
              await handler(inner, op)
            })
            outcome = { ok: true }
          } catch (error) {
            if (error instanceof SyncRejection) {
              outcome = {
                ok: false,
                rejection: reject(op, error.code, error.messageEn, error.messageHi),
              }
            } else if (error instanceof ORPCError && error.status >= 400 && error.status < 500) {
              outcome = {
                ok: false,
                rejection: reject(
                  op,
                  String(error.code).toLowerCase(),
                  error.message,
                  error.message,
                ),
              }
            } else {
              throw error // transient: let the request fail 5xx so the device retries the whole batch
            }
          }
        }
        if (outcome.rejection) {
          const r = outcome.rejection
          await tx.insert(syncErrors).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            userId: ctx.actorId,
            deviceId: input.deviceId,
            opId: op.opId,
            tableName: op.table,
            rowId: op.id,
            code: r.code,
            messageHi: r.messageHi,
            messageEn: r.messageEn,
          })
        }
        await tx
          .insert(syncOps)
          .values({ tenantId: ctx.tenantId, deviceId: input.deviceId, opId: op.opId, outcome })
          .onConflictDoNothing()
        return { replayed: false, outcome }
      })
      if (result.replayed) out.replayed += 1
      if (result.outcome.ok) out.accepted += 1
      else if (result.outcome.rejection) out.rejected.push(result.outcome.rejection)
    }
    return out
  }

  /**
   * The "Needs attention" tray after the upload response is gone (docs/23 §8.11). A field role always
   * reads its OWN rows — `user_id = actor` is forced here and RLS says the same — and the desk reads
   * everyone's for support triage. Newest first, cursor on the row id.
   */
  async listErrors(input: ErrorsIn): Promise<ErrorsOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(syncErrors.tenantId, ctx.tenantId),
        TRIAGE.includes(ctx.actorRole) ? undefined : eq(syncErrors.userId, ctx.actorId),
        input.deviceId ? eq(syncErrors.deviceId, input.deviceId) : undefined,
        input.since ? gte(syncErrors.createdAt, new Date(input.since)) : undefined,
        input.unresolvedOnly ? isNull(syncErrors.resolvedAt) : undefined,
        input.cursor ? lt(syncErrors.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(syncErrors)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(syncErrors.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const last = page[page.length - 1]
      return {
        items: page.map((r) => ({
          id: r.id,
          opId: r.opId,
          table: r.tableName,
          rowId: r.rowId,
          code: r.code,
          messageHi: r.messageHi,
          messageEn: r.messageEn,
          deviceId: r.deviceId,
          createdAt: r.createdAt.toISOString(),
          resolved: r.resolvedAt !== null,
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
        })),
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  /**
   * WHAT THE PHONE IS ALLOWED TO KEEP — the first call the app makes after a sign-in, a role switch or
   * a distributor switch, and the one that decides whether the local database survives an app update.
   *
   * The answer is built from the registry, so it is the read set THIS server can really serve rows
   * for, and from the Drizzle tables behind it, so a column added by a migration appears here and in
   * `pull` in the same deploy or in neither. It touches no table: a manifest is a description of the
   * schema, not a read of anybody's data, which is why it is cheap enough to ask on every app start.
   *
   * `schemaVersion` is a hash of the protocol number and the published tables. Different from the one
   * the device stored means the local tables are stale — drop them, re-create from `tables`, and
   * re-snapshot with a `pull` that carries no `since`; equal means keep the rows and pull a delta.
   * `role` rides along because a phone that signs in as somebody else holds the wrong read set even
   * when the hash matches, and the shape of the answer is what tells it so.
   */
  manifest(input: ManifestIn): ManifestOut {
    // The SAME gate `pull` uses, and `permissions.ts` says ANY_MEMBER for both: the shop's app holds
    // its own bills, orders and dues on the phone and opens them in a dead spot (docs/07 §0). What a
    // shopkeeper receives is not decided here but three layers down — the 18 tables `sync-tables.ts`
    // gives the `retailer` role, the module's own predicate, and RLS underneath both. `upload` and
    // `errors.list` stay STAFF, so the shop carries no write queue.
    requireRole(ANY_MEMBER)
    const ctx = currentTenant()
    const role = deviceRole(ctx.actorRole)
    const tables = this.registry.manifest(ctx.actorRole)
    const schemaVersion = schemaHash(role, tables)
    return {
      protocol: SYNC_PROTOCOL_VERSION,
      schemaVersion,
      changed: input.knownSchemaVersion !== schemaVersion,
      role,
      tables,
      asOf: new Date().toISOString(),
    }
  }

  /**
   * The delta download (docs/23 §8.11): every table registered for the actor's role (or the ones the
   * device names), rows changed since the cursor, `limit` rows in total. RLS narrows every table to
   * what the actor may hold — a rep never receives a cost column because no pulled table has one.
   * `cursor` is the server clock at the start of the read minus an overlap; the device sends it back
   * as `since`. `hasMore` means at least one table hit its share of the limit: pull again with the
   * SAME cursor until it is false, then keep the cursor for the next delta.
   */
  async pull(input: PullIn): Promise<PullOut> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const sinceText = decodeCursor(input.since)
    const since = sinceText ? new Date(sinceText) : null
    const registered = this.registry.pullTables(ctx.actorRole)
    const tables = input.tables ? input.tables.filter((t) => registered.includes(t)) : registered
    const startedAt = new Date()
    const perTable = Math.max(1, Math.floor(input.limit / Math.max(1, tables.length)))
    return withTenant(db, ctx, async (tx) => {
      const changes: PullOut['changes'] = []
      let hasMore = false
      // How far a SATURATED table is complete. One cursor serves every table, so it may only move to
      // the earliest of these — the point past which no table has been read yet. The empty string
      // sorts before every timestamp and is what a table that cannot say reports.
      const wm: { at: string | null } = { at: null }
      const mark = (at: string | null | undefined): void => {
        const value = at ?? ''
        if (wm.at === null || value < wm.at) wm.at = value
      }
      for (const table of tables) {
        const spec = this.registry.pull(table)
        if (!spec) continue
        const result = await spec.handler(tx, { ctx, since, sinceText, limit: perTable })
        // The handler owns its own paging: it knows the table's key, and it may hand back a few rows
        // MORE than the budget to finish a group that shares one `updated_at` (see `tablePull`), which
        // is the only way a one-instant cursor can move at all. So nothing is sliced here.
        if (result.hasMore) {
          hasMore = true
          mark(result.watermark)
        }
        if (result.rows.length > 0 || result.deleted.length > 0 || since === null)
          changes.push({ table, rows: result.rows, deleted: result.deleted })
      }
      // A complete pass moves the cursor to the server clock minus the overlap. An INCOMPLETE one
      // still has to move it, or the next call answers the same page and the device never finishes
      // its read set: it moves to the earliest point EVERY table has finished. A table that filled
      // its page mid-instant and could not finish that instant (see `TIE_COMPLETION_LIMIT`) reports
      // no watermark, and then the cursor stays where it was — repeating a page is recoverable,
      // stepping over a row is not.
      const asOf = new Date(startedAt.getTime() - PULL_OVERLAP_MS).toISOString()
      const forward = wm.at && wm.at > (sinceText ?? '') ? wm.at : sinceText
      const cursor = hasMore ? encodeCursor(forward ?? EPOCH) : encodeCursor(asOf)
      return { changes, cursor, hasMore, asOf: startedAt.toISOString() }
    })
  }
}

function reject(op: SyncOp, code: string, messageEn: string, messageHi: string): Rejection {
  return { opId: op.opId, table: op.table, rowId: op.id, code, messageEn, messageHi }
}

/** Every value an actor role and a MEMBERSHIP role share; the rest belong to no device. */
const MEMBERSHIP_ROLES = new Set<string>([
  'owner',
  'manager',
  'accountant',
  'salesperson',
  'warehouse',
  'delivery',
  'retailer',
])

/**
 * `system`, `curator`, `support` and `platform_admin` are actor roles and not MEMBERSHIP roles: they
 * belong to the worker, the global catalogue desk and Distribution OS's own console, never to a
 * phone, so they have no device schema to answer. `requireRole(ANY_MEMBER)` lets `system` through
 * (every other procedure in the codebase wants it to), and this is the one line that says a device
 * schema belongs to a person who signed in on a device.
 */
function deviceRole(role: ActorRole): MembershipRole {
  if (!MEMBERSHIP_ROLES.has(role))
    throw new ORPCError('FORBIDDEN', { message: 'A device manifest belongs to a signed-in member' })
  return role as MembershipRole
}

/**
 * The version a device compares against what it stored. It hashes the ROLE as well as the tables:
 * two roles can be served the same table list today and diverge the moment one of them starts
 * stripping a column, and a hash that ignored the role would tell the second phone its schema is
 * still good. Sixteen hex characters is plenty for an equality check that never has to be unique
 * across tenants — it is compared to one stored string, never looked up.
 */
function schemaHash(role: MembershipRole, tables: ManifestOut['tables']): string {
  return createHash('sha256')
    .update(JSON.stringify({ p: SYNC_PROTOCOL_VERSION, role, tables }))
    .digest('hex')
    .slice(0, 16)
}

/** Before every row there is: what a pull answers when it cannot advance and has no floor to keep. */
const EPOCH = '1970-01-01T00:00:00.000000Z'

/**
 * The cursor is base64url `{v:1,t:<instant>}`, where the instant is ISO-8601 UTC to the MICROsecond —
 * the resolution the database stamps `updated_at` with. Millisecond precision (what `Date.toISOString`
 * gives) is not enough: a bound truncated down re-reads every row inside that millisecond on every
 * pull, and when a page is exactly those rows the device never gets past them. It is opaque to the
 * device, which only ever stores it and sends it back.
 */
function encodeCursor(at: string): string {
  return Buffer.from(JSON.stringify({ v: 1, t: at })).toString('base64url')
}

function decodeCursor(cursor: string | undefined): string | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { t?: string }
    const at = parsed.t ? new Date(parsed.t) : null
    if (!parsed.t || !at || Number.isNaN(at.getTime())) throw new Error('bad cursor')
    return parsed.t
  } catch {
    throw new ORPCError('BAD_REQUEST', { message: 'since is not a cursor this server issued' })
  }
}
