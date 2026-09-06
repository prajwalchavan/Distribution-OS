# Offline sync client (`@dos/offline`) — design

Written 2026-09-06 by the architect session (Fable) for the developer session that builds it (frontend chain, slice F4). Binding
where it is specific; where it is silent, `docs/07 §0` (the server side of our own sync) and `backend/libs/core/src/modules/sync/**`
decide. No PowerSync, no vendor: SQLite on the device, four procedures of the `sync` contract, and the ordinary access token.

## 1. Scope and roles

| App | Holds | Sends |
| --- | --- | --- |
| sales, delivery, warehouse | the role's read set (manifest) | the write queue (`sync.upload`) |
| owner, manager | the read set, for reading on a bad connection | nothing offline in v1 — every desk write is an online oRPC call; the queue is present but unused |
| retailer | the read set (own bills, orders, dues, catalog, prices) | nothing: `upload` is refused for the role by the permission matrix |
| admin | nothing | nothing |

Thirteen tables accept uploads today (`SyncRegistry.register` in the owning modules): `sales_orders`, `sales_order_lines`, `visits`,
`receipts`, `allocations`, `collections`, `deliveries`, `pod_evidence`, `trip_stops`, `trip_expenses`, `pick_lines`, `documents`,
`document_pages`. The manifest's `writable` flag is the client's authority; a table not marked writable never gets an outbox row.

## 2. Storage

One interface, three adapters, chosen at start-up and named in the status object so `ConnectionStrip` can say which one runs:

```ts
interface SyncStore {
  exec(sql: string, params?: unknown[]): Promise<void>
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  transaction<T>(fn: (tx: SyncStore) => Promise<T>): Promise<T>
  persistent: boolean            // false only for the memory adapter
  kind: 'sqlite-native' | 'sqlite-web' | 'memory'
}
```

- `sqlite-native`: `expo-sqlite` (Android, iOS). WAL mode, `PRAGMA synchronous=NORMAL`.
- `sqlite-web`: `expo-sqlite`'s web build (wa-sqlite on OPFS in a worker). It needs the page to be cross-origin isolated
  (COOP/COEP headers); the dev server and the CloudFront distribution send them. If OPFS is unavailable the client falls to:
- `memory`: an in-memory SQL-compatible store (better-sqlite3-style API over `sql.js` is acceptable on web only). It is honest:
  `persistent=false`, and the strip says "Offline data is not saved on this browser".

Everything below is plain SQL that all three run identically. No ORM on the device.

## 3. Local schema

Created from the manifest at first start and re-created (drop + snapshot) when `schemaVersion` or `role` or `tenantId` changes.

- One table per manifest entry, columns exactly as published (snake_case, JSON types → `TEXT | INTEGER | REAL`), primary key as
  published (`primaryKey` array; two tables have no `id`). Money columns are integers (paise) — never REAL.
- Every writable table gets two extra local columns: `_pending TEXT` (`NULL | 'queued' | 'sending' | 'rejected'`) and
  `_local_rev INTEGER` (bumped on each local write), so a list can show a queued order distinctly and a pull can tell local from
  server rows.
- System tables:
  - `_sync_state(key TEXT PRIMARY KEY, value TEXT)` — `cursor`, `schemaVersion`, `role`, `tenantId`, `deviceId`, `lastPulledAt`,
    `lastUploadAt`, `protocol`.
  - `_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT UNIQUE, tbl TEXT, row_id TEXT, op TEXT, data TEXT, base_updated_at TEXT,
    idempotency_key TEXT, status TEXT, attempts INTEGER, created_at TEXT, sent_at TEXT, acked_at TEXT, rejection_code TEXT,
    rejection_message TEXT)` — `status ∈ queued | sending | acked | rejected`.
  - `_gps_buffer(ts TEXT, trip_id TEXT, lat REAL, lng REAL, accuracy_m REAL, speed_mps REAL, posted INTEGER)` — delivery only (§8).
  - `_sync_errors` — a mirror of the server's `sync_errors` rows for this device, so "Needs attention" works offline.

Indexes: `(tbl, row_id)` on `_outbox`; on each data table the columns the screens filter by (`retailer_id`, `trip_id`, `beat_id`,
`status`, `updated_at`). The manifest does not publish indexes; the client owns a small per-table index list.

## 4. Identity and keys

- `deviceId`: UUIDv7 generated once per install, kept in `platform.storage` (secure store) and mirrored in `_sync_state`. Sign-out
  wipes the database but keeps the `deviceId`.
- Row `id`: UUIDv7 generated on the device at creation (the contract's `MutationBase` shape).
- `opId`: UUIDv7 per queued op. `idempotencyKey = opId`. A retry of the same op reuses both; the server's `sync_ops`
  `(tenant_id, device_id, op_id)` makes a replay return the stored outcome.

## 5. Pull

1. `sync.manifest({ knownSchemaVersion })` on app start, after sign-in, after a distributor switch, and once a day. On `changed`:
   drop and re-create the data tables, clear the cursor.
2. No cursor → **snapshot**: `sync.pull({ deviceId, limit: 500 })` in a loop while `hasMore`, always echoing the cursor the last
   response gave. Snapshots carry no tombstones.
3. With a cursor → **delta**, same loop. For each response, in ONE transaction: apply every `deleted` id of every table first, then
   upsert `rows` by the manifest primary key. Rows never overwrite a local row whose `_pending` is `queued|sending` (the local edit
   wins locally until the server answers; the veto decides on the server).
4. Save `cursor` and `lastPulledAt = asOf` only after the transaction commits.
5. Schedule: on foreground, after every successful upload batch, every 60 s while online and the app is in the foreground, and on a
   manual pull-to-refresh. Never on a timer in the background (battery; docs/07 §7.5 says GPS is the only background work).
6. Numeric columns arrive as JSON numbers (paise); store as INTEGER. Dates arrive ISO; store as TEXT.

## 6. Outbox and upload

- `enqueue({ table, id, op, data, baseUpdatedAt })` writes the outbox row AND applies the change locally in the same transaction
  (`_pending='queued'`). The screen shows the order at once, marked as waiting.
- Uploader: one batch in flight at a time; FIFO by `seq`; ≤ 50 ops per batch; `sync.upload({ deviceId, protocol, ops })`.
  Ops keep their order inside the batch so a `sales_order_lines` op follows its `sales_orders` op.
- On 2xx: for each op, `applied` → `acked` and `_pending=NULL`; `rejected` → `rejected`, `_pending='rejected'`, the rejection mirrored
  into `_sync_errors`, and the row kept (never silently dropped). `stale` (LWW veto) additionally re-pulls that row and offers the
  user the server version next to their edit.
- On a network failure or 5xx: leave the batch `queued`, back off 1 s → 2 s → 4 s … 60 s, retry forever while online. The upload
  endpoint never answers 4xx by design; a 4xx therefore means a broken token → refresh once, then surface a sign-in prompt, never
  drop the queue.
- `protocol_unsupported` → stop uploading and show "Update the app". `unknown_table` → mark rejected with that code (app newer
  than server); keep the row.
- Queue survives restarts (it is a table). A pending count and the oldest queued time feed the status object.

## 7. Conflict rules

| Case | Rule |
| --- | --- |
| Insert-only tables (`visits`, `receipts`, `allocations`, `collections`, `deliveries`, `pod_evidence`, `trip_expenses`) | no `baseUpdatedAt`; cannot conflict |
| Edit of a pulled row (`sales_orders` before submit, `trip_stops`, `pick_lines`) | `baseUpdatedAt` = the row's `updated_at` as pulled; server vetoes if stale |
| Same row edited on two devices | the second write is `stale`; that device re-pulls and re-applies or drops, by the user's choice |
| Local delete | `DELETE` op only on tables the server accepts it for; otherwise a status change, never a delete |

The server is always right. The client never resolves a conflict by itself; it shows both versions and asks.

## 8. GPS (delivery)

Trip breadcrumbs never go through the outbox (docs/07 §7.5, ADR 0012). `platform.location` writes points into `_gps_buffer`;
a poster sends batches to `delivery.gps.points` (`POST /gps/points`) every 30 s / 50 m or on reconnect, keyed by
`(tripId, deviceId, ts)` for server-side dedupe, and marks them `posted`. Points older than 7 days are pruned locally. On web there
is no background location; the screen says tracking runs only while the app is open.

## 9. Receipts printed offline

The founder removed device-allocated numbering (docs/17 §D5). A receipt written offline carries `deviceId` and `clientReceiptNo` —
the crew's paper book number. The legal receipt number is assigned by the server when the op syncs. The slip shared or printed
offline shows the book number and the line "Receipt number follows on sync"; after sync the receipt screen shows both numbers and
the shared PDF (rendered by the worker) carries the legal one. A slip is never re-numbered: the book number stays on the row.

## 10. Status object and the honesty strip

```ts
interface SyncStatus {
  online: boolean                      // navigator.onLine / NetInfo AND a /health probe within 30 s
  store: 'sqlite-native' | 'sqlite-web' | 'memory'
  lastPulledAt: string | null
  pulling: boolean
  pending: number                      // queued + sending
  oldestPendingAt: string | null
  rejected: number                     // needs attention
  uploading: boolean
  schemaVersion: string | null
}
```

`ConnectionStrip` (UX-00 §6.11) renders exactly: synced → "Updated 2 min ago"; waiting → "3 orders waiting"; offline → "Offline —
saved on this phone"; rejected > 0 → "2 need attention" (tap opens the tray); `store='memory'` → "Offline data is not saved on this
browser". The strip never shows a spinner without a word.

## 11. React API

- `<OfflineProvider api={apiClient} storeFactory tables?>` — starts the manifest/pull/upload loops; one per app.
- `useSyncStatus(): SyncStatus`
- `useTable<T>(table, { where?, params?, orderBy?, limit? })` — a live query: re-runs when a pull applies rows to that table or the
  outbox touches it (an in-process change bus keyed by table). Returns `{ rows, loading }`.
- `useRow<T>(table, id)`
- `useOutbox()` → `{ enqueue, pending, rejected, retry(opId), discard(opId) }`. `discard` is only offered on a rejected op and writes
  an audit line into `_sync_errors`.
- `useNeedsAttention()` — the rejected ops joined with their rows, for the tray.

Screens never write SQL; only the library does. Screens never call `sync.upload` or `sync.pull` directly.

## 12. Security

Tokens live in `platform.storage` (secure store on native; `localStorage` on web with the documented XSS caveat: no third-party
scripts, strict CSP on the hosted site). The local database is unencrypted for the pilot (SQLCipher is a phase-2 item in docs/25); it
contains no cost or margin column by construction (the manifest strips them server-side). Sign-out wipes every data table and the
outbox after confirming nothing is queued; if something is queued, the user is told what would be lost and must sync or discard first.

## 13. Tests (deterministic, fake transport, no network)

1. Manifest change drops and re-snapshots; role change does the same even with an identical hash.
2. Snapshot then delta: rows upserted by primary key; tombstones applied before rows; a row in both lists ends up present.
3. `hasMore` loop echoes the last cursor; the cursor is saved only after commit (crash between response and commit → re-pull is safe).
4. Outbox FIFO: two batches, second waits for the first; order line follows its order.
5. Replay twice → identical local state; the transport records one upload per `opId`.
6. Rejection → row kept with `_pending='rejected'`, error mirrored, tray shows it; `stale` → row re-pulled and both versions offered.
7. Network failure → backoff, nothing lost across a simulated restart.
8. Pull never overwrites a locally pending row.
9. No cost/margin column ever exists in the local schema for a field role (walk the manifest).
10. Status object transitions: offline → online → pulling → synced; pending counts.
11. Memory adapter reports `persistent=false` and the strip text follows.

## 14. Failure modes

| Failure | Behaviour |
| --- | --- |
| Device clock wrong | cursors are server-issued; only `created_at` on outbox rows uses the device clock and it is informational |
| App killed mid-upload | ops are `sending`; on restart they revert to `queued` and re-send with the same `opId` (server replay returns the stored outcome) |
| Server rolled forward (new manifest) | next manifest call re-snapshots; queued ops are sent before the drop (never lose writes to a re-snapshot) |
| Token expired while offline | queue keeps growing; refresh on reconnect; a dead refresh token prompts sign-in without wiping the queue |
| Storage full | writes fail loudly ("Phone storage is full"); nothing is silently dropped |

## 15. What this does not do (yet)

No push-driven "sync hint" (pull is timer + event driven), no attachment queue beyond `pod_evidence`/`document_pages` object keys
(photos upload through `files` signed URLs before their op is enqueued; an op whose file failed to upload stays `queued` with the
reason "photo not uploaded yet"), no peer-to-peer or multi-user device. Each is a docs/25 item.
