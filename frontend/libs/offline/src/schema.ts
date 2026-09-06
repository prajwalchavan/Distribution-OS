/**
 * The local schema (docs/27 §3): one table per manifest entry, created from what the SERVER published,
 * plus the four system tables the protocol needs and the two local columns a writable table carries.
 *
 * Nothing here is a hand-kept list of columns. The manifest is the schema contract — a column a pull
 * spec strips for this role is absent from it, so the device has nowhere to put a cost even by
 * accident (docs/27 §13 test 9 walks that).
 */
import type { SyncColumnType, SyncTableManifest } from '@dos/contracts'

import type { SqlValue, SyncStore } from './types.js'

/** Manifest tables are server-published, but an identifier still never reaches SQL unchecked. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

export function quoteIdent(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`unsafe identifier from the manifest: ${name}`)
  return `"${name}"`
}

/**
 * SQLite affinities for the six JSON types the contract publishes. Money is `integer` (paise) and
 * must never become REAL — a rupee that has been through a float is not the rupee on the invoice.
 */
export function sqliteType(type: SyncColumnType): string {
  switch (type) {
    case 'integer':
    case 'boolean':
      return 'INTEGER'
    case 'number':
      return 'REAL'
    default:
      return 'TEXT'
  }
}

/** JSON value -> what SQLite stores. Objects and arrays are JSON text; booleans are 0/1. */
export function encodeValue(value: unknown, type: SyncColumnType): SqlValue {
  if (value === null || value === undefined) return null
  switch (type) {
    case 'boolean':
      return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0
    case 'integer': {
      const n = typeof value === 'string' ? Number(value) : (value as number)
      return Number.isFinite(n) ? Math.trunc(n) : null
    }
    case 'number': {
      const n = typeof value === 'string' ? Number(value) : (value as number)
      return Number.isFinite(n) ? n : null
    }
    case 'object':
    case 'array':
      return typeof value === 'string' ? value : JSON.stringify(value)
    default:
      // A `string` column that is handed an object is a server bug, not a value to stringify blindly.
      return typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
          ? String(value)
          : JSON.stringify(value)
  }
}

/** What SQLite stored -> the shape a screen expects back. */
export function decodeValue(value: SqlValue, type: SyncColumnType): unknown {
  if (value === null) return null
  switch (type) {
    case 'boolean':
      return value === 1 || value === '1' || value === 'true'
    case 'object':
    case 'array':
      try {
        return JSON.parse(String(value))
      } catch {
        return null
      }
    default:
      return value
  }
}

export interface TableShape {
  table: string
  primaryKey: readonly string[]
  writable: boolean
  types: ReadonlyMap<string, SyncColumnType>
}

export function shapeOf(manifest: SyncTableManifest): TableShape {
  return {
    table: manifest.table,
    primaryKey: manifest.primaryKey,
    writable: manifest.writable,
    types: new Map(manifest.columns.map((column) => [column.name, column.type])),
  }
}

export function decodeRow(
  row: Record<string, SqlValue>,
  shape: TableShape,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const type = shape.types.get(key)
    out[key] = type === undefined ? value : decodeValue(value, type)
  }
  return out
}

/**
 * The columns the screens filter and sort by. The manifest does not publish indexes — the client owns
 * this list (docs/27 §3) — and an index on a column the table does not have is simply skipped.
 */
const LOCAL_INDEX_COLUMNS: readonly string[] = [
  'updated_at',
  'retailer_id',
  'trip_id',
  'beat_id',
  'order_id',
  'invoice_id',
  'status',
  'state',
  'variant_id',
  'stop_id',
]

/** `_pending` and `_local_rev` exist only where a local write is possible (docs/27 §3). */
export const PENDING_COLUMN = '_pending'
export const LOCAL_REV_COLUMN = '_local_rev'

export function createTableSql(manifest: SyncTableManifest): string {
  const columns = manifest.columns.map(
    (column) => `${quoteIdent(column.name)} ${sqliteType(column.type)}`,
  )
  if (manifest.writable) {
    columns.push(`${quoteIdent(PENDING_COLUMN)} TEXT`, `${quoteIdent(LOCAL_REV_COLUMN)} INTEGER`)
  }
  const key = manifest.primaryKey.map(quoteIdent).join(', ')
  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(manifest.table)} (${columns.join(', ')}, PRIMARY KEY (${key}))`
}

export function createIndexSql(manifest: SyncTableManifest): string[] {
  const present = new Set(manifest.columns.map((column) => column.name))
  return LOCAL_INDEX_COLUMNS.filter((column) => present.has(column)).map(
    (column) =>
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(`ix_${manifest.table}_${column}`)} ON ${quoteIdent(
        manifest.table,
      )} (${quoteIdent(column)})`,
  )
}

// ---------------------------------------------------------------------------------------------------------------
// System tables (docs/27 §3)

export const SYNC_STATE_TABLE = '_sync_state'
export const OUTBOX_TABLE = '_outbox'
export const GPS_TABLE = '_gps_buffer'
export const SYNC_ERRORS_TABLE = '_sync_errors'

export const SYSTEM_TABLE_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ${SYNC_STATE_TABLE} (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS ${OUTBOX_TABLE} (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     op_id TEXT UNIQUE,
     tbl TEXT,
     row_id TEXT,
     op TEXT,
     data TEXT,
     base_updated_at TEXT,
     idempotency_key TEXT,
     status TEXT,
     attempts INTEGER,
     created_at TEXT,
     sent_at TEXT,
     acked_at TEXT,
     rejection_code TEXT,
     rejection_message TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS ix_outbox_row ON ${OUTBOX_TABLE} (tbl, row_id)`,
  `CREATE INDEX IF NOT EXISTS ix_outbox_status ON ${OUTBOX_TABLE} (status, seq)`,
  `CREATE TABLE IF NOT EXISTS ${GPS_TABLE} (
     ts TEXT,
     trip_id TEXT,
     lat REAL,
     lng REAL,
     accuracy_m REAL,
     speed_mps REAL,
     posted INTEGER,
     PRIMARY KEY (trip_id, ts)
   )`,
  `CREATE TABLE IF NOT EXISTS ${SYNC_ERRORS_TABLE} (
     op_id TEXT PRIMARY KEY,
     tbl TEXT,
     row_id TEXT,
     code TEXT,
     message TEXT,
     created_at TEXT,
     discarded_at TEXT
   )`,
]

export async function createSystemTables(store: SyncStore): Promise<void> {
  for (const statement of SYSTEM_TABLE_STATEMENTS) await store.exec(statement)
}

export async function createDataTables(
  store: SyncStore,
  tables: readonly SyncTableManifest[],
): Promise<void> {
  for (const manifest of tables) {
    await store.exec(createTableSql(manifest))
    for (const index of createIndexSql(manifest)) await store.exec(index)
  }
}

/**
 * Dropping the data tables is what a `schemaVersion`, role or distributor change costs (docs/27 §5).
 * The outbox, the errors and `_sync_state` are NOT dropped: a queued write must survive a
 * re-snapshot, which is failure mode 3 in docs/27 §14.
 */
export async function dropDataTables(store: SyncStore, tables: readonly string[]): Promise<void> {
  for (const table of tables) await store.exec(`DROP TABLE IF EXISTS ${quoteIdent(table)}`)
}
