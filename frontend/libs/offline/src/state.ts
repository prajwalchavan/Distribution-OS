/**
 * `_sync_state` — the eight strings that decide, on the next launch, whether the device may keep what
 * it holds (docs/27 §3). Everything else on the device is derivable; these are not.
 */
import { SYNC_STATE_TABLE } from './schema.js'
import type { SyncStore } from './types.js'

export type SyncStateKey =
  | 'cursor'
  | 'schemaVersion'
  /**
   * The manifest itself, as JSON. Without it an app opened in a dead spot has the TABLES on disk and
   * no idea what shape they are — which is the one moment a rep most needs to write an order. The
   * device keeps what the server last published and uses it until the next successful handshake.
   */
  | 'manifest'
  | 'role'
  | 'tenantId'
  | 'deviceId'
  | 'lastPulledAt'
  | 'lastUploadAt'
  | 'protocol'

export async function readState(store: SyncStore, key: SyncStateKey): Promise<string | null> {
  const rows = await store.query<{ value: string | null }>(
    `SELECT value FROM ${SYNC_STATE_TABLE} WHERE key = ?`,
    [key],
  )
  return rows[0]?.value ?? null
}

export async function writeState(
  store: SyncStore,
  key: SyncStateKey,
  value: string | null,
): Promise<void> {
  await store.exec(`INSERT OR REPLACE INTO ${SYNC_STATE_TABLE} (key, value) VALUES (?, ?)`, [
    key,
    value,
  ])
}

export async function readAllState(
  store: SyncStore,
): Promise<Partial<Record<SyncStateKey, string>>> {
  const rows = await store.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM ${SYNC_STATE_TABLE}`,
  )
  const out: Partial<Record<SyncStateKey, string>> = {}
  for (const row of rows) if (row.value !== null) out[row.key as SyncStateKey] = row.value
  return out
}
