import { oc } from '@orpc/contract'
import { z } from 'zod'
import { IdSchema, MembershipRoleSchema, QueryBoolSchema, QueryIntSchema } from './common.js'

/**
 * ADR 0007 — the offline protocol, ours end to end (docs/22 §8, founder 2026-09-05: PowerSync is not
 * used; the device keeps SQLite and talks to these three procedures). The uploader posts CRUD batches
 * to `upload`, which NEVER answers 4xx: a business rejection is a 2xx with a `rejected` entry (and a
 * `sync_errors` row for the "Needs attention" tray). Only transient faults are 5xx (retry).
 *
 * The protocol is three procedures and one cursor (docs/07 "Our own sync"):
 *
 *   `manifest` — what tables this role's device holds, their columns and primary key, and a
 *                `schemaVersion`. A device whose stored version differs re-creates its tables and
 *                re-snapshots (a `pull` with no `since`); a device that matches pulls a delta.
 *   `pull`     — rows changed since the cursor, plus the ids that left the read set (tombstones).
 *   `upload`   — the write queue, last-write-wins with a backend veto: an op carrying `baseUpdatedAt`
 *                older than the server's row is rejected `stale` into `sync_errors`, never 4xx.
 *   `errors.list` — the tray's rows back after the upload response is gone (docs/23 §8.11).
 *
 * WHICH SERVICES SERVE THE `sync` KEY:
 *
 *   owner :3001, manager :3002, sales :3003, warehouse :3004, delivery :3005 — YES, all four procedures
 *   retailer :3006 — YES, but for `manifest` and `pull` ALONE: the shop's app holds its own bills,
 *                    orders and dues offline and writes nothing through the queue. PERMISSIONS refuses
 *                    the `retailer` role on `upload` and `errors.list`, the same read-only mount
 *                    sales-service already uses for `receivables` and `billing`.
 *
 * Every read is bounded: `limit` caps rows per call and a cursor continues.
 */
export const SYNC_PROTOCOL_VERSION = 1

/**
 * The rejection codes the protocol itself produces, next to the module codes handlers throw
 * (`SyncRejection`). The device switches on these: `stale` re-reads the row and offers the shopkeeper
 * or the rep the server's version; `protocol_unsupported` asks for an app update; `unknown_table`
 * means the app is newer than the server and the op is dropped from the queue.
 */
export const SYNC_REJECTION_CODES = {
  /** LWW with backend veto: the server row moved on after `baseUpdatedAt` (docs/07 §7.3). */
  stale: 'stale',
  /** No handler is registered for `table` on this server. */
  unknownTable: 'unknown_table',
  /** The batch's `protocol` is not this server's `SYNC_PROTOCOL_VERSION`. */
  protocolUnsupported: 'protocol_unsupported',
} as const
export type SyncRejectionCode = (typeof SYNC_REJECTION_CODES)[keyof typeof SYNC_REJECTION_CODES]

export const SyncOpSchema = z.object({
  opId: z.string().min(1).max(64),
  op: z.enum(['PUT', 'PATCH', 'DELETE']),
  table: z.string().min(1).max(64),
  id: IdSchema,
  /** Column values for PUT/PATCH (snake_case as in the device schema); absent for DELETE. */
  data: z.record(z.string(), z.unknown()).optional(),
  /**
   * The `updated_at` the device's copy of the row carried when the user changed it, exactly as `pull`
   * delivered it. This is the veto half of last-write-wins (docs/07 §7.3): if the server's row has
   * moved on since, the op is NOT applied — it comes back as a `stale` rejection with a `sync_errors`
   * row, still 2xx, and the device re-reads the row before offering the edit again. Absent on an
   * insert and on an insert-only table (a receipt, a visit, a delivery), where nothing can be overwritten.
   */
  baseUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  /** Device clock at write time (ISO); skew > 10 min is reported as a warning, never rejected. */
  clientTime: z.string().optional(),
})
export type SyncOp = z.infer<typeof SyncOpSchema>

export const SyncUploadInput = z.object({
  protocol: z.number().int().default(SYNC_PROTOCOL_VERSION),
  deviceId: z.string().min(4).max(128),
  ops: z.array(SyncOpSchema).max(500),
})

export const SyncRejectionSchema = z.object({
  opId: z.string(),
  table: z.string(),
  rowId: z.string(),
  code: z.string(),
  messageHi: z.string(),
  messageEn: z.string(),
})
export type SyncRejection = z.infer<typeof SyncRejectionSchema>

export const SyncUploadOutput = z.object({
  accepted: z.number().int(),
  replayed: z.number().int(),
  rejected: z.array(SyncRejectionSchema),
  warnings: z.array(z.object({ opId: z.string(), code: z.string(), messageEn: z.string() })),
  upgradeRequired: z.boolean(),
})

// ---------------------------------------------------------------------------------------------------------------
// errors — the "Needs attention" tray, readable after the upload response is gone

/** One `sync_errors` row: the rejection as it was answered, plus when and whether it was dealt with. */
export const SyncErrorSchema = SyncRejectionSchema.extend({
  id: IdSchema,
  deviceId: z.string(),
  createdAt: z.string(),
  resolved: z.boolean(),
  resolvedAt: z.string().nullable(),
})
export type SyncError = z.infer<typeof SyncErrorSchema>

/**
 * Newest first. A field role (salesperson, delivery, warehouse) always reads its OWN rows — the handler
 * forces `user_id = actor` — and the desk may read everyone's for support triage.
 */
export const SyncErrorsListInput = z.object({
  deviceId: z.string().min(4).max(128).optional(),
  /** Rows created at or after this instant (ISO). */
  since: z.iso.datetime({ offset: true }).optional(),
  unresolvedOnly: QueryBoolSchema.default(true),
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
})
export const SyncErrorsListOutput = z.object({
  items: z.array(SyncErrorSchema),
  nextCursor: z.string().nullable(),
})

// ---------------------------------------------------------------------------------------------------------------
// manifest — what this role's device holds, and the version that says when to throw it away

/**
 * The JSON type a column arrives as in a `sync.pull` row, derived from the column's Zod/Drizzle type,
 * NOT from Postgres: `integer` is what the device stores as an integer (paise, pieces, basis points,
 * a case size), `number` a non-integer, `string` everything textual including a timestamp and a uuid,
 * `object`/`array` a jsonb column (`applied_rules`, a settings blob). The device maps these onto
 * SQLite affinities itself; the contract stays free of any one client's storage.
 */
export const SyncColumnTypeSchema = z.enum([
  'string',
  'integer',
  'number',
  'boolean',
  'object',
  'array',
])
export type SyncColumnType = z.infer<typeof SyncColumnTypeSchema>

export const SyncColumnSchema = z.object({
  /** Column name in the device schema (snake_case) — exactly the key `sync.pull` puts in a row. */
  name: z.string().min(1).max(64),
  type: SyncColumnTypeSchema,
  nullable: z.boolean(),
})
export type SyncColumn = z.infer<typeof SyncColumnSchema>

/**
 * One table of the device's read set. `columns` is what the actor's role actually receives: a column a
 * pull spec strips (a scheme's funding source, any cost) is absent here as well, so the device never
 * even has a place to put it. `writable` says whether the table may go back through `sync.upload`
 * (docs/07 §7.3: prices, schemes and the catalog are download-only), and `primaryKey` is what the
 * device upserts on — `['id']` for every table the protocol has today, an array because a link table
 * will not be.
 */
export const SyncTableManifestSchema = z.object({
  table: z.string().min(1).max(64),
  primaryKey: z.array(z.string().min(1).max(64)).min(1),
  columns: z.array(SyncColumnSchema),
  writable: z.boolean(),
})
export type SyncTableManifest = z.infer<typeof SyncTableManifestSchema>

/**
 * Ask once per app start (and after a role or distributor switch). Send back the `schemaVersion` the
 * device already holds so the answer can say "nothing changed" in one field instead of a diff.
 */
export const SyncManifestInput = z.object({
  /** The `schemaVersion` stored on the device; omit on a first run. */
  knownSchemaVersion: z.string().min(1).max(128).optional(),
})

/**
 * The device's schema contract for this role. `schemaVersion` is a hash of `protocol` + `tables` (the
 * server computes it; the device only compares it): different from the stored one means the local
 * tables are stale — drop them, re-create from `tables`, and re-snapshot with a `pull` that carries no
 * `since`. Equal means keep the rows and pull a delta. `role` is on the answer because a phone that
 * signs in as somebody else holds the wrong read set even when the hash matches.
 */
export const SyncManifestOutput = z.object({
  protocol: z.number().int(),
  schemaVersion: z.string(),
  /** False only when `knownSchemaVersion` equals `schemaVersion`. */
  changed: z.boolean(),
  role: MembershipRoleSchema,
  tables: z.array(SyncTableManifestSchema),
  /** Server time the manifest was built (ISO). */
  asOf: z.string(),
})

// ---------------------------------------------------------------------------------------------------------------
// pull — the delta download

/**
 * One table's changes since the cursor: rows the device may hold (RLS narrows them to the actor —
 * a rep gets the shops of its own beats and never a cost column), in the device schema (snake_case),
 * plus the ids of rows deleted or moved out of the actor's view.
 */
export const SyncTableChangesSchema = z.object({
  table: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())),
  /**
   * The DEVICE KEY of each row to forget, which is the row's `id` for 35 of the 37 pull-able tables
   * and its `primaryKey` parts joined by `:` for the two that have no `id` column at all
   * (`stock_balances` = `lot_id:location_id`, `retailer_outstanding_summary` = `retailer_id`). It is
   * therefore a string and not a uuid: the same value `sync_tombstones.row_id` holds, and the same
   * `primaryKey` the manifest publishes for the table.
   */
  deleted: z.array(z.string().min(1).max(160)),
})
export type SyncTableChanges = z.infer<typeof SyncTableChangesSchema>

/**
 * `since` is the opaque server cursor from the previous pull; omit it for a full snapshot of the
 * device's read set. `tables` names the tables the device holds (`sales_orders`, `retailers`,
 * `visits`, …, the same names `SyncOpSchema.table` and `sync.manifest` use); omit it for every table
 * registered for the actor's role. The cap is deliberately above the longest read set any role has in
 * the manifest, so a device may always name EVERY table it holds — naming them is how a device that
 * fell behind on one table catches that table up without re-reading the rest. A table nobody
 * registered a pull for is simply absent from `changes`.
 */
export const SyncPullInput = z.object({
  deviceId: z.string().min(4).max(128),
  since: z.string().min(1).max(256).optional(),
  tables: z.array(z.string().min(1).max(64)).max(64).optional(),
  /** Rows per call across all tables; `hasMore` + `cursor` continue. */
  limit: QueryIntSchema.min(1).max(500).default(200),
})
export const SyncPullOutput = z.object({
  changes: z.array(SyncTableChangesSchema),
  /** Send this back as `since` on the next pull. */
  cursor: z.string(),
  hasMore: z.boolean(),
  /** Server time the cursor is good to (ISO); the device shows it as "updated at". */
  asOf: z.string(),
})

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `sync: syncContract` in contract.ts

export const syncContract = {
  upload: oc
    .route({
      method: 'POST',
      path: '/sync/upload',
      summary: 'Offline write batch (never 4xx; rejections are 2xx + sync_errors)',
    })
    .input(SyncUploadInput)
    .output(SyncUploadOutput),
  errors: {
    list: oc
      .route({
        method: 'GET',
        path: '/sync/errors',
        summary:
          'Rejected offline writes for the "Needs attention" tray (own rows for field roles)',
      })
      .input(SyncErrorsListInput)
      .output(SyncErrorsListOutput),
  },
  manifest: oc
    .route({
      method: 'GET',
      path: '/sync/manifest',
      summary: 'Tables, columns and schema version the device of this role should hold',
    })
    .input(SyncManifestInput)
    .output(SyncManifestOutput),
  pull: oc
    .route({
      method: 'GET',
      path: '/sync/pull',
      summary: 'Delta download of the device read set since a cursor (never a cost column)',
    })
    .input(SyncPullInput)
    .output(SyncPullOutput),
}
