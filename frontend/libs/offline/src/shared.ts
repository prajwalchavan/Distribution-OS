/**
 * `@dos/offline` — our own delta sync client (docs/27; founder 2026-09-05: no PowerSync).
 *
 * Everything here is renderer- and platform-agnostic. The one thing that is not — which SQLite the
 * device actually has — comes from `index.web.ts` / `index.native.ts` beside this file as `openStore`,
 * resolved by the bundler through the package's `exports` conditions, exactly as `@dos/ui` does.
 *
 *   import { OfflineProvider, useTable, useOutbox } from '@dos/offline/react'
 *   import { openStore, transportFromApi } from '@dos/offline'
 */
export { SyncEngine, CLIENT_SYNC_PROTOCOL, type SyncEngineOptions } from './engine.js'
export { transportFromApi, type SyncApiLike } from './transport.js'
export { createMemoryStore, memoryStoreFactory } from './store/memory.js'
export { openExpoSqlite, type ExpoDatabaseLike, type ExpoSqliteLike } from './store/expo-sqlite.js'
export { MemoryDatabase, SqlError, splitStatements, type Row } from './sql.js'
export { ChangeBus, ERRORS_CHANNEL, OUTBOX_CHANNEL, type TableListener } from './bus.js'
export {
  createDataTables,
  createIndexSql,
  createSystemTables,
  createTableSql,
  decodeRow,
  decodeValue,
  dropDataTables,
  encodeValue,
  GPS_TABLE,
  LOCAL_REV_COLUMN,
  OUTBOX_TABLE,
  PENDING_COLUMN,
  quoteIdent,
  shapeOf,
  sqliteType,
  SYNC_ERRORS_TABLE,
  SYNC_STATE_TABLE,
  SYSTEM_TABLE_STATEMENTS,
  type TableShape,
} from './schema.js'
export { readAllState, readState, writeState, type SyncStateKey } from './state.js'
export { connectionStateFrom, type ConnectionStateLike } from './connection.js'

export type * from './types.js'
export type * from './wire.js'
