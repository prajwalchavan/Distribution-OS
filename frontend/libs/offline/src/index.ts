/**
 * Contract for the offline write path (see docs/07-offline-sync.md).
 * Every local mutation becomes an upload op with a client-generated id that doubles as the
 * server idempotency key. The server NEVER answers 4xx to the upload endpoint: business rejections are
 * 2xx + a row in `sync_errors` so the device queue can keep moving.
 */
export interface UploadOp {
  opId: string
  table: string
  rowId: string
  kind: 'insert' | 'update' | 'delete'
  data: Record<string, unknown>
  clientTime: number
}

export interface SyncError {
  id: string
  opId: string
  code: string
  message: string
  createdAt: number
}

export const SYNC_TABLES = [
  'retailers',
  'products',
  'price_lists',
  'orders',
  'order_lines',
  'visits',
  'stops',
  'receipts',
] as const
export type SyncTable = (typeof SYNC_TABLES)[number]
