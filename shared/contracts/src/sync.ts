import { oc } from '@orpc/contract'
import { z } from 'zod'
import { IdSchema } from './common.js'

/**
 * ADR 0007 — offline write protocol. The team app's PowerSync uploader posts CRUD batches here.
 * The server NEVER answers 4xx: a business rejection is a 2xx with a `rejected` entry (and a sync_errors
 * row that syncs back to the device's "Needs attention" tray). Only transient faults are 5xx (retry).
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

export const SyncUploadOutput = z.object({
  accepted: z.number().int(),
  replayed: z.number().int(),
  rejected: z.array(SyncRejectionSchema),
  warnings: z.array(z.object({ opId: z.string(), code: z.string(), messageEn: z.string() })),
  upgradeRequired: z.boolean(),
})

export const syncContract = {
  upload: oc
    .route({
      method: 'POST',
      path: '/sync/upload',
      summary: 'Offline write batch (never 4xx; rejections are 2xx + sync_errors)',
    })
    .input(SyncUploadInput)
    .output(SyncUploadOutput),
}
