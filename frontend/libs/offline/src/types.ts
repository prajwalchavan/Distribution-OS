/**
 * The contracts `@dos/offline` is built on (docs/27 §2, §6, §10).
 *
 * Wire shapes are NEVER re-declared here: `SyncManifestOutput`, `SyncPullOutput`, `SyncUploadOutput`
 * and `SyncOp` come from `@dos/contracts`, the backend's own package, linked. What this file adds is
 * what lives on the DEVICE and has no server counterpart — the storage adapter, the outbox row, the
 * status object `<ConnectionStrip>` renders, and the transport seam the tests fake.
 */
import type {
  ErrorsListInput,
  ErrorsListOutput,
  ManifestInput,
  ManifestOutput,
  PullInput,
  PullOutput,
  SyncOp,
  UploadInput,
  UploadOutput,
} from './wire.js'

// ---------------------------------------------------------------------------------------------------------------
// Storage (docs/27 §2) — one interface, three adapters, named in the status object so the strip can
// say which one is running.

/** Values SQLite itself can hold. Everything richer is JSON text; see `encodeValue` in `schema.ts`. */
export type SqlValue = string | number | null

export interface SyncStore {
  exec(sql: string, params?: readonly SqlValue[]): Promise<void>
  query<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>
  /** Atomic: the callback either commits whole or leaves nothing behind. */
  transaction<T>(fn: (tx: SyncStore) => Promise<T>): Promise<T>
  /** False only for the memory adapter — the one the strip must be honest about. */
  readonly persistent: boolean
  readonly kind: StoreKind
  close(): Promise<void>
}

export type StoreKind = 'sqlite-native' | 'sqlite-web' | 'memory'

/** How an app opens its database. `openStore()` is the platform default; tests pass their own. */
export type StoreFactory = (name: string) => Promise<SyncStore>

// ---------------------------------------------------------------------------------------------------------------
// Transport (docs/27 §13) — the four procedures, structurally, so a test can fake them without a
// network and without the oRPC client.

export interface SyncTransport {
  manifest(input: ManifestInput): Promise<ManifestOutput>
  pull(input: PullInput): Promise<PullOutput>
  upload(input: UploadInput): Promise<UploadOutput>
  /** `sync.errors.list` — STAFF only, and absent on a shop's device. */
  listErrors?: (input: ErrorsListInput) => Promise<ErrorsListOutput>
  /** `delivery.gps.points` — outside the queue by ADR 0012; absent on every app but delivery. */
  postGpsPoints?: (input: GpsPostInput) => Promise<GpsPostOutput>
}

export interface GpsPostInput {
  /** `MutationBase`: one key per intent, so a replayed batch costs nothing (docs/07 §7.4). */
  idempotencyKey: string
  tripId: string
  deviceId: string
  points: readonly {
    recordedAt: string
    lat: number
    lng: number
    accuracyM?: number
    speedMps?: number
  }[]
}

export interface GpsPostOutput {
  accepted: number
  duplicates: number
  throttled: boolean
  retryAfterSeconds: number | null
}

// ---------------------------------------------------------------------------------------------------------------
// The outbox (docs/27 §6)

export type OutboxStatus = 'queued' | 'sending' | 'acked' | 'rejected'

/** What a screen hands `enqueue()`. `opId` and `idempotencyKey` are the same UUIDv7 (docs/27 §4). */
export interface EnqueueInput {
  table: string
  /** The row's own client-generated UUIDv7 primary key. */
  id: string
  op: SyncOp['op']
  /** Column values in the DEVICE schema (snake_case), exactly as `pull` delivers them. */
  data?: Record<string, unknown>
  /**
   * The `updated_at` the device's copy carried when the user changed it — the veto half of LWW.
   * Absent on an insert and on an insert-only table, where nothing can be overwritten.
   */
  baseUpdatedAt?: string
  /** Reuse an op id to RETRY one intent; omit for a new one. */
  opId?: string
}

export interface OutboxRow {
  seq: number
  opId: string
  table: string
  rowId: string
  op: SyncOp['op']
  data: Record<string, unknown> | null
  baseUpdatedAt: string | null
  idempotencyKey: string
  status: OutboxStatus
  attempts: number
  createdAt: string
  sentAt: string | null
  ackedAt: string | null
  rejectionCode: string | null
  rejectionMessage: string | null
}

/** A `sync_errors` row as the device mirrors it, so "Needs attention" works with no network. */
export interface LocalSyncError {
  opId: string
  table: string
  rowId: string
  code: string
  message: string
  createdAt: string
  /** Set when the user threw the op away rather than fixing it (docs/27 §11). */
  discardedAt: string | null
}

/** One entry of the tray: what the device tried, and what the server holds instead. */
export interface NeedsAttentionItem {
  error: LocalSyncError
  op: OutboxRow | null
  /** The server's version of the row after the re-pull a `stale` rejection triggers; null otherwise. */
  serverRow: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------------------------------------------
// Status (docs/27 §10) — exactly the object `<ConnectionStrip>` is fed.

export interface SyncStatus {
  /** A successful call (or health probe) inside the last 30 s, and the platform not saying otherwise. */
  online: boolean
  store: StoreKind
  /** False for the memory adapter: the strip says "Offline data is not saved on this browser". */
  persistent: boolean
  lastPulledAt: string | null
  pulling: boolean
  /** queued + sending. */
  pending: number
  oldestPendingAt: string | null
  /** Rejected writes waiting for a person. */
  rejected: number
  uploading: boolean
  schemaVersion: string | null
  /** The server answered `upgradeRequired`: stop uploading, ask for an app update. */
  upgradeRequired: boolean
  /** Set once the engine has created its tables and knows what it holds. */
  ready: boolean
  /** The last failure that is worth a sentence on a screen; cleared by the next success. */
  lastError: string | null
}

// ---------------------------------------------------------------------------------------------------------------
// Local schema

/** A live query, in the small SQL subset every adapter runs identically (docs/27 §11). */
export interface TableQuery {
  /** `retailer_id = ? AND status <> ?` — placeholders only, never interpolated values. */
  where?: string
  params?: readonly SqlValue[]
  /** `updated_at DESC, id ASC`. */
  orderBy?: string
  limit?: number
  offset?: number
}

/** What `useTable` gives a row on top of its own columns. */
export interface LocalRowMeta {
  /** `null` when the row is the server's; otherwise what the outbox is doing with it. */
  _pending?: 'queued' | 'sending' | 'rejected' | null
  _local_rev?: number | null
}
