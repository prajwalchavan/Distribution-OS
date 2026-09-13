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

One file per (app, user, distributor): `<prefix>__u-<userId>__t-<tenantId>.db` (`storeNameFor`, prefix `dos-sales`,
`dos-delivery`, `dos-warehouse`). The ids go in unhashed after a character check, so two people, or one person at two
distributors, never open the same file; a person signing in on a phone somebody else used starts with no rows and no cursor
(DOS-167). The fixed `<prefix>.db` of earlier builds is deleted once at mount.

Everything below is plain SQL that all three run identically. No ORM on the device.

## 3. Local schema

Created from the manifest at first start and re-created (drop + snapshot) when `schemaVersion` or `role` or `tenantId` changes,
or the stored identity differs, checked at open before any read.

- One table per manifest entry, columns exactly as published (snake_case, JSON types → `TEXT | INTEGER | REAL`), primary key as
  published (`primaryKey` array; two tables have no `id`). Money columns are integers (paise) — never REAL.
- Every writable table gets two extra local columns: `_pending TEXT` (`NULL | 'queued' | 'sending' | 'rejected'`) and
  `_local_rev INTEGER` (bumped on each local write), so a list can show a queued order distinctly and a pull can tell local from
  server rows.
- System tables:
  - `_sync_state(key TEXT PRIMARY KEY, value TEXT)` — `cursor`, `schemaVersion`, `role`, `tenantId`, `userId`, `deviceId`,
    `lastPulledAt`, `lastUploadAt`, `protocol`. `userId` and `tenantId` are the stamp of who the file belongs to, written at open.
  - `_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT UNIQUE, tbl TEXT, row_id TEXT, op TEXT, data TEXT, base_updated_at TEXT,
    idempotency_key TEXT, status TEXT, attempts INTEGER, created_at TEXT, sent_at TEXT, acked_at TEXT, rejection_code TEXT,
    rejection_message TEXT)` — `status ∈ queued | sending | acked | rejected`.
  - `_gps_buffer(ts TEXT, trip_id TEXT, lat REAL, lng REAL, accuracy_m REAL, speed_mps REAL, posted INTEGER)` — delivery only (§8).
  - `_sync_errors` — a mirror of the server's `sync_errors` rows for this device, so "Needs attention" works offline.
    Mirroring is BEST EFFORT: `sync.errors.list` is STAFF-only, the oRPC client exposes it to every app because the contract is
    shared, and a shop's app is answered 403. A refusal is logged and the tray is not asked for again — it must never turn a
    pull that has already committed into a failed sync (gate, 2026-09-06).

Indexes: `(tbl, row_id)` on `_outbox`; on each data table the columns the screens filter by (`retailer_id`, `trip_id`, `beat_id`,
`status`, `updated_at`). The manifest does not publish indexes; the client owns a small per-table index list.

## 4. Identity and keys

- `deviceId`: UUIDv7 generated once per install, kept in `platform.storage` (secure store) and mirrored in `_sync_state`. Sign-out
  wipes the read set and deletes the file, and keeps the `deviceId`. With unsent changes (queued or refused) the app asks, and
  what it offers is decided (founder, 2026-09-13): send them now while there is a signal, or sign out keeping them — the file
  and its queue stay on the phone for that person only and go out the next time that person signs in there (§12).
- Row `id`: UUIDv7 generated on the device at creation (the contract's `MutationBase` shape).
- `opId`: UUIDv7 per queued op. `idempotencyKey = opId`. A retry of the same op reuses both; the server's `sync_ops`
  `(tenant_id, device_id, op_id)` makes a replay return the stored outcome.

## 5. Pull

1. The identity is compared at open, before the handshake and before any read (DOS-167): `start()` reads the stamp in
   `_sync_state` (`userId`, `tenantId`) and, when it names another person or another distributor than
   `SyncEngineOptions.identity`, wipes the whole file — read set, cursor, manifest, queue, tray mirror, GPS buffer — and logs it,
   before any shape is restored, any table is published or anything is uploaded. A file with no stamp is stamped. The manifest
   is the second check:
   `sync.manifest({ knownSchemaVersion })` on app start, after sign-in, after a distributor switch, and once a day. On `changed`:
   drop and re-create the data tables, clear the cursor. The DISTRIBUTOR is compared by the client itself (`tenantId` in
   `_sync_state`, `SyncEngineOptions.identity.tenantId`): the manifest cannot say which tenant it answered for — its hash is over
   the ROLE's tables — so a rep who works for two distributors gets an identical `schemaVersion` from both, and without the tenant
   in the comparison the second one's delta lands on top of the first one's rows (gate, 2026-09-06). A role changed on the server
   for the same membership is the manifest's check too: the stamp at open never overwrites a stored role.
2. No cursor → **snapshot**: `sync.pull({ deviceId, limit: 500 })` in a loop while `hasMore`, always echoing the cursor the last
   response gave. The first page of a snapshot carries no tombstones; later pages carry a cursor and may.
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
- Uploader: one batch in flight at a time; FIFO by `seq`; ≤ 50 ops and ≤ 4 MiB of op JSON per batch (an op larger than that
  goes on its own; DOS-056, §15); `sync.upload({ deviceId, protocol, ops })`.
  Ops keep their order inside the batch so a `sales_order_lines` op follows its `sales_orders` op.
- On 2xx: for each op, `applied` → `acked` and `_pending=NULL`; `rejected` → `rejected`, `_pending='rejected'`, the rejection mirrored
  into `_sync_errors`, and the row kept (never silently dropped). `stale` (LWW veto) additionally re-pulls that row and offers the
  user the server version next to their edit.
- On a network failure or 5xx: leave the batch `queued`, back off 1 s → 2 s → 4 s … 60 s, retry forever while online. The upload
  endpoint never answers 4xx by design; a 4xx therefore means a broken token → refresh once, then surface a sign-in prompt, never
  drop the queue.
- `protocol_unsupported` → stop uploading and show "Update the app". `unknown_table` → mark rejected with that code (app newer
  than server); keep the row. `role_not_allowed` (the signed-in role may not make the change that table stands for online, checked
  against `PERMISSIONS` before any handler runs), `not_permitted` (a database policy refused this actor) and `row_too_large` (one
  op over 1 MiB of JSON, §15) → mark rejected with the server's sentence in the tray; keep the row, never retry it (DOS-166,
  DOS-056).
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

**Corrected at the gate, 2026-09-06.** `online` was written below as "the platform's flag AND a successful call inside
the last 30 s". Built that way it lied and then broke the client: the foreground pull runs every **60** s, so a phone
with a perfect connection spent half of every minute saying "Offline — saved on this phone", and because the poll was
itself gated on `online`, the first time it went stale the poll stopped scheduling work — **one pull per launch, for
ever**, on every read-only app (owner, manager, retailer). `online` is now *the radio is on AND the last call reached a
service* — a claim about the last thing we tried, not about the clock. Freshness is a different question and the strip
already answers it from `lastPulledAt` ("Stock as of 9:40 am" past four hours, UX-00 §6.11). The poll is never gated on
the state it produces: **the poll is the probe**.

```ts
interface SyncStatus {
  online: boolean                      // navigator.onLine / NetInfo AND the last call reached a service
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
- `useLeaveSession()` → `{ pending, rejected, online, waiting(), sendNow(), end({ keepQueue }) }` — the app's sign-out flow
  (DOS-167). `leaveDecision({ pending, rejected })` is the rule: `'leave'` when both are 0, `'ask'` otherwise. It is given
  `waiting()`, the counts read from the file once the engine has opened it, never the `pending`/`rejected` snapshot, which reads 0
  until then. `end` is called before the session is cleared; `SyncEngine.sweepIdentityStores` deletes the person's
  other-distributor files that hold nothing unsent.
- `<OfflineProvider identity storePrefix>` — `identity` is `sessionIdentity(session)` from `@dos/api-client` (`null` signed out),
  `storePrefix` the app's literal file prefix. A distributor switch stops the engine on one file and starts it on the other.

Screens never write SQL; only the library does. Screens never call `sync.upload` or `sync.pull` directly.

## 12. Security

Tokens live in `platform.storage` (secure store on native; `localStorage` on web with the documented XSS caveat: no third-party
scripts, strict CSP on the hosted site). The local database is unencrypted for the pilot (SQLCipher is a phase-2 item in docs/25); it
contains no cost or margin column by construction (the manifest strips them server-side). A device file belongs to one person in
one distributorship (DOS-167, §2) and is checked at open before any read (§5). Sign-out ends the engine before the session is
cleared: with nothing queued or refused it is one tap, the read set is dropped and the file deleted, and the person's files at their
other distributors are deleted when they hold nothing unsent. From the tap on the phone refuses new writes with a sentence; a
write already in hand is finished, counted and kept for that person. With anything queued or refused the app names the count and the
person and offers "Send now" only while online, or "Sign out, keep them here": the file keeps only that queue and its refusals, for
that person only, and they go out the next time that person signs in on this phone, before the re-snapshot. Discarding is never
offered at sign-out; it stays in the Needs-attention tray (§11). A session that ends by itself (a refresh answered 401) keeps the
queue in that person's file the same way (§14). Decided by the founder, 2026-09-13.

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
12. One store per app, person and distributor (DOS-167): `storeNameFor` is lossless and refuses an unsafe id; a second person on
    the same store sees no row and pulls with no cursor, even before the handshake; another distributor's store after a restart is
    wiped before any table is published and its queue is never uploaded; the same person keeps rows, cursor and queue.
13. `end()` at sign-out: with nothing queued it drops the read set, tells every table and deletes the file; `keepQueue` keeps the
    queue and the tray for the same person only, who sends it before the re-snapshot, while anyone else's start wipes it; `end()`
    under a pull page and an upload batch in flight waits for both and lets nothing land after the drop. A write that begins once
    `end()` has begun is refused with `SyncEngineEndedError`, never saved and so never deleted; a write already in hand when `end()`
    begins, or landed between the tap's count and `end()`, is finished and counted, and the file is kept for that person, who sends
    it at the next sign-in, while anyone else's start wipes it.
14. `sweepIdentityStores` deletes the person's other-distributor file with nothing unsent and keeps, and reports, one with a queue.
15. The SQLite adapter's `destroy` closes once, then deletes the file by name; a file already gone is no error. `leaveDecision` asks
    only when something is queued or refused, and a sign-out tapped while the store is still opening counts the file through
    `waiting()` and asks.
16. `@dos/api-client`: `identityKey` changes with the user or the distributor, not with a password flag or a role, and the query
    cache is cleared on every identity change, a forced sign-out included; the sales draft is keyed by the signed-in user.

## 14. Failure modes

| Failure | Behaviour |
| --- | --- |
| Device clock wrong | cursors are server-issued; only `created_at` on outbox rows uses the device clock and it is informational |
| App killed mid-upload | ops are `sending`; on restart they revert to `queued` and re-send with the same `opId` (server replay returns the stored outcome) |
| Server rolled forward (new manifest) | next manifest call re-snapshots; queued ops are sent before the drop (never lose writes to a re-snapshot) |
| Token expired while offline | queue keeps growing; refresh on reconnect; a dead refresh token prompts sign-in without wiping the queue |
| Another person signs in on this phone | a different file; a stamped file opened by the wrong identity is wiped before any read (DOS-167) |
| Sign out tapped while a write is in hand | finished, counted, file kept for that person; a write attempted after the tap → refused, never saved, never deleted (DOS-167) |
| Storage full | writes fail loudly ("Phone storage is full"); nothing is silently dropped |

## 15. What this does not do (yet)

No push-driven "sync hint" (pull is timer + event driven), no separate attachment queue, no peer-to-peer or multi-user device.
Each is a docs/25 item.

**Proof of delivery with no signal (DOS-056, approved 2026-09-13).** A photo does not wait for a signal of its own:

- **With a signal** the proof goes through `files` signed URLs: `files.uploadUrl`, the PUT, then only the `objectKey` travels on
  `deliveries.record`.
- **With no answer from the office**, D4 saves ONE `deliveries` op to the outbox carrying its lines and its proof INLINE
  (`pod[].inline = { mimeType, contentBase64 }`). That covers the phone that knows it is offline and the call that never got a reply:
  a browser `TypeError`, the 20 s deadline, or Expo's native `FetchError` ('fetch failed: …', which `@dos/api-client` reads as
  `network`). A call the office answered with a refusal is never queued. If the PUT already landed and only the record call lost its
  reply, the op carries that `objectKey` and no bytes.
- **Size.** The camera module squeezes the proof to ≤ 300 KB of JPEG before anything is queued (`camera.photograph({ maxBytes })`),
  about 400 KB as base64, under `InlineFileInput`'s 700 000-character cap. The uploader keeps a batch ≤ 4 MiB (§6);
  `POST /sync/upload` takes a body up to 8 MiB; an op over 1 MiB is refused `row_too_large` into `sync_errors`, 2xx like every other
  refusal and never a 413.
- **On the server** the `deliveries` handler stores the inline bytes through the files platform inside the op's transaction (object
  storage plus a `file_objects` row, keyed on the delivery the stop completes), and `pod_evidence` holds only the object key. No
  base64 is kept in any row, so no pull ever carries a photo back to a phone.
- **A lost reply** after the office committed leaves a second op, which the LWW veto refuses `stale`: no double delivery, and the
  crew throws the refusal away from the tray.

This is the one bounded exception to docs/20 rule 15 (nothing binary passes through a service), on the no-signal path only.
