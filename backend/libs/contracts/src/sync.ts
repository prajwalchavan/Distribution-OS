import { oc } from '@orpc/contract'
import { z } from 'zod'
import { IdSchema, QueryBoolSchema, QueryIntSchema } from './common.js'

/**
 * ADR 0007 — offline write protocol. The team app's PowerSync uploader posts CRUD batches here.
 * The server NEVER answers 4xx: a business rejection is a 2xx with a `rejected` entry (and a sync_errors
 * row that syncs back to the device's "Needs attention" tray). Only transient faults are 5xx (retry).
 *
 * WHICH SERVICES MOUNT `sync` (the staff apps that work offline; the retailer app is online-first):
 *
 *   owner :3001, manager :3002, sales :3003, warehouse :3004, delivery :3005 — YES
 *   retailer :3006 — NO
 *
 * Until PowerSync streams `sync_errors` and the read set to the device (frontend/libs/offline says
 * "later"), two reads complete the protocol (docs/23 §8.11): `errors.list` gives the "Needs attention"
 * tray its rows back after the upload response is gone, and `pull` is the delta download — every
 * open of the sales or delivery app would otherwise re-read full lists (≤ 500 rows each) and break the
 * 10 MB/day budget (UX-00 §8.3). Both are bounded: `limit` caps rows per call and a cursor continues.
 */
export const SYNC_PROTOCOL_VERSION = 1

export const SyncOpSchema = z.object({
  opId: z.string().min(1).max(64),
  op: z.enum(['PUT', 'PATCH', 'DELETE']),
  table: z.string().min(1).max(64),
  id: IdSchema,
  /** Column values for PUT/PATCH (snake_case as in the device schema); absent for DELETE. */
  data: z.record(z.string(), z.unknown()).optional(),
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
// pull — the delta download

/**
 * One table's changes since the cursor: rows the device may hold (RLS narrows them to the actor —
 * a rep gets the shops of its own beats and never a cost column), in the device schema (snake_case),
 * plus the ids of rows deleted or moved out of the actor's view.
 */
export const SyncTableChangesSchema = z.object({
  table: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())),
  deleted: z.array(IdSchema),
})
export type SyncTableChanges = z.infer<typeof SyncTableChangesSchema>

/**
 * `since` is the opaque server cursor from the previous pull; omit it for a full snapshot of the
 * device's read set. `tables` names the tables the device holds (`sales_orders`, `retailers`,
 * `visits`, …, the same names `SyncOpSchema.table` uses); omit it for every table registered for
 * the actor's role. A table nobody registered a pull for is simply absent from `changes`.
 */
export const SyncPullInput = z.object({
  deviceId: z.string().min(4).max(128),
  since: z.string().min(1).max(256).optional(),
  tables: z.array(z.string().min(1).max(64)).max(32).optional(),
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
  pull: oc
    .route({
      method: 'GET',
      path: '/sync/pull',
      summary: 'Delta download of the device read set since a cursor (never a cost column)',
    })
    .input(SyncPullInput)
    .output(SyncPullOutput),
}
