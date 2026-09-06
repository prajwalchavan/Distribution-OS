/**
 * `SyncEngine` — the whole of docs/27 in one object: the manifest handshake, the pull cursor loop, the
 * outbox, the uploader with its backoff, the GPS buffer and the status object `<ConnectionStrip>`
 * renders.
 *
 * It owns the ONLY writer to the device database in this process, which is what makes the live queries
 * of `useTable` correct: every mutation goes through here and publishes the tables it touched.
 *
 * Everything is driven by explicit calls (`sync()`, `flush()`), with the timers as a thin layer on
 * top, so the eleven tests of docs/27 §13 run with a fake transport, a fake clock and no network.
 */
import { uuidv7 } from '@dos/domain'

import type { ManifestOutput, PullOutput, SyncOp, SyncTableManifest } from './wire.js'

import { ChangeBus, ERRORS_CHANNEL, OUTBOX_CHANNEL } from './bus.js'
import {
  createDataTables,
  createSystemTables,
  decodeRow,
  dropDataTables,
  encodeValue,
  GPS_TABLE,
  LOCAL_REV_COLUMN,
  OUTBOX_TABLE,
  PENDING_COLUMN,
  quoteIdent,
  shapeOf,
  SYNC_ERRORS_TABLE,
  type TableShape,
} from './schema.js'
import { readState, writeState } from './state.js'
import type {
  EnqueueInput,
  LocalSyncError,
  NeedsAttentionItem,
  OutboxRow,
  SqlValue,
  StoreFactory,
  SyncStatus,
  SyncStore,
  SyncTransport,
  TableQuery,
} from './types.js'

/** The wire version this client speaks; the server rejects anything else with `upgradeRequired`. */
export const CLIENT_SYNC_PROTOCOL = 1

/** docs/27 §6: at most 50 ops in flight, one batch at a time, FIFO by `seq`. */
const DEFAULT_UPLOAD_BATCH = 50
/** docs/27 §5: 500 rows per pull call, looped while `hasMore`. */
const DEFAULT_PULL_LIMIT = 500
/** docs/27 §5: a foreground poll, never a background timer. */
const DEFAULT_PULL_INTERVAL_MS = 60_000
/** docs/27 §6: 1 s → 2 s → 4 s … 60 s, retried for ever while online. */
const BACKOFF_START_MS = 1_000
const BACKOFF_CEILING_MS = 60_000
/** docs/27 §8: breadcrumbs are pruned locally after a week. */
const GPS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export interface SyncEngineOptions {
  transport: SyncTransport
  /** One id per install (docs/27 §4); the app already has it for `auth_sessions`. */
  deviceId: string
  storeFactory: StoreFactory
  /** The database file name; a second signed-in tenant gets its own. */
  databaseName?: string
  /** Hold only these manifest tables. Omit for the whole read set. */
  tables?: readonly string[]
  /**
   * The distributor this database belongs to. docs/27 §5 re-snapshots on a distributor switch, and
   * `sync.manifest` cannot say which one it answered for — the hash is over the role's TABLES, so a
   * rep who switches between two distributors with the same role gets the identical `schemaVersion`.
   * Without this the second distributor's delta would land on top of the first one's rows.
   */
  tenantId?: string
  pullLimit?: number
  uploadBatchSize?: number
  /** 0 turns the foreground poll off (what the tests use). */
  pullIntervalMs?: number
  now?: () => number
  /** Whether the platform believes there is a network at all (`navigator.onLine`, NetInfo). */
  networkHint?: () => boolean
  onLog?: (line: string, detail?: unknown) => void
}

type Timer = ReturnType<typeof setTimeout>

export class SyncEngine {
  private store: SyncStore | null = null
  private readonly bus = new ChangeBus()
  private readonly statusListeners = new Set<(status: SyncStatus) => void>()
  private shapes = new Map<string, TableShape>()
  private manifestTables: SyncTableManifest[] = []

  private readonly now: () => number
  private readonly networkHint: () => boolean
  private readonly pullLimit: number
  private readonly uploadBatchSize: number
  private readonly pullIntervalMs: number

  private reachable = true
  private radioOn: boolean | null = null
  private lastContactAt: number | null = null
  /** Set once `sync.errors.list` answers 403: the role has no tray, so stop asking on every sync. */
  private errorsDenied = false
  private pulling = false
  private uploading = false
  private upgradeRequired = false
  private ready = false
  private lastError: string | null = null
  private schemaVersion: string | null = null
  private lastPulledAt: string | null = null
  private pending = 0
  private oldestPendingAt: string | null = null
  private rejected = 0
  private backoffMs = BACKOFF_START_MS
  private retryTimer: Timer | null = null
  private pollTimer: Timer | null = null
  private started = false
  private flushChain: Promise<void> = Promise.resolve()

  constructor(private readonly options: SyncEngineOptions) {
    this.now = options.now ?? (() => Date.now())
    this.networkHint = options.networkHint ?? defaultNetworkHint
    this.pullLimit = options.pullLimit ?? DEFAULT_PULL_LIMIT
    this.uploadBatchSize = options.uploadBatchSize ?? DEFAULT_UPLOAD_BATCH
    this.pullIntervalMs = options.pullIntervalMs ?? DEFAULT_PULL_INTERVAL_MS
  }

  // -------------------------------------------------------------------------------------------------------------
  // Lifecycle

  /**
   * Open the database, recover anything the last run left mid-flight, then handshake and pull.
   * An op that was `sending` when the app was killed goes back to `queued` and is re-sent with the
   * SAME `opId`, which the server's `sync_ops` turns into a replay rather than a second row
   * (docs/27 §14).
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const store = await this.options.storeFactory(this.options.databaseName ?? 'dos-offline.db')
    this.store = store
    await createSystemTables(store)
    await store.exec(
      `UPDATE ${OUTBOX_TABLE} SET status = 'queued', sent_at = NULL WHERE status = 'sending'`,
    )
    await writeState(store, 'deviceId', this.options.deviceId)
    this.schemaVersion = await readState(store, 'schemaVersion')
    this.lastPulledAt = await readState(store, 'lastPulledAt')
    await this.restoreManifest(store)
    await this.refreshCounts()
    this.ready = true
    this.emitStatus()
    await this.sync('start')
    this.schedulePoll()
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    if (this.pollTimer !== null) clearTimeout(this.pollTimer)
    this.retryTimer = null
    this.pollTimer = null
    await this.store?.close()
    this.store = null
  }

  /**
   * Sign-out (docs/27 §12): every data table and the queue go, the device id stays. The caller is
   * expected to have shown the user what is queued first — `status().pending` is that number.
   */
  async wipe(): Promise<void> {
    const store = this.requireStore()
    await dropDataTables(store, [...this.shapes.keys()])
    await store.exec(`DELETE FROM ${OUTBOX_TABLE}`)
    await store.exec(`DELETE FROM ${SYNC_ERRORS_TABLE}`)
    await store.exec(`DELETE FROM ${GPS_TABLE}`)
    for (const key of [
      'cursor',
      'schemaVersion',
      'role',
      'tenantId',
      'lastPulledAt',
      'manifest',
    ] as const)
      await writeState(store, key, null)
    this.shapes = new Map()
    this.manifestTables = []
    this.schemaVersion = null
    this.lastPulledAt = null
    await this.refreshCounts()
    this.emitStatus()
  }

  // -------------------------------------------------------------------------------------------------------------
  // Status and subscriptions

  /**
   * `online` is a claim about the LAST THING WE TRIED, not about the clock (docs/27 §10).
   *
   * It used to also require a successful call inside the last 30 seconds. That read as honest and was
   * not: the foreground pull runs every 60 s, so a perfectly connected phone spent half of every
   * minute saying "Offline — saved on this phone", and because the poll itself was gated on `online`
   * the FIRST time it went stale the poll stopped scheduling work — one pull per launch, for ever.
   * Freshness is a different question, and the strip already answers it from `lastPulledAt`
   * ("Stock as of 9:40 am" past four hours, UX-00 §6.11). This says only: the radio is on, and the
   * last call reached a service.
   */
  status(): SyncStatus {
    return {
      online: this.radio() && this.reachable,
      store: this.store?.kind ?? 'memory',
      persistent: this.store?.persistent ?? false,
      lastPulledAt: this.lastPulledAt,
      pulling: this.pulling,
      pending: this.pending,
      oldestPendingAt: this.oldestPendingAt,
      rejected: this.rejected,
      uploading: this.uploading,
      schemaVersion: this.schemaVersion,
      upgradeRequired: this.upgradeRequired,
      ready: this.ready,
      lastError: this.lastError,
    }
  }

  onStatus(listener: (status: SyncStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  onTables(listener: (tables: ReadonlySet<string>) => void): () => void {
    return this.bus.subscribe(listener)
  }

  /**
   * The platform telling us the radio came back or went away (NetInfo, `online`/`offline` events); it
   * never ends the session. The ANSWER is kept — discarding it left a React Native app, where there is
   * no `navigator.onLine` to fall back on, unable to say it was offline at all — and coming back is
   * the moment to clear the backoff and go: docs/27 §6 "retry for ever while online" and §8 "or on
   * reconnect". Reads AND writes: a rep who walks out of a dead spot wants both.
   */
  setNetworkHint(online: boolean): void {
    const was = this.radio()
    this.radioOn = online
    if (online) {
      this.reachable = true
      this.backoffMs = BACKOFF_START_MS
    }
    this.emitStatus()
    if (!online || was || !this.started) return
    void this.sync('reconnect')
    void this.flush()
  }

  /** What the platform says about the radio: its last answer, else the browser's own flag. */
  private radio(): boolean {
    return this.radioOn ?? this.networkHint()
  }

  private emitStatus(): void {
    const snapshot = this.status()
    for (const listener of [...this.statusListeners]) listener(snapshot)
  }

  // -------------------------------------------------------------------------------------------------------------
  // The manifest handshake and the pull loop (docs/27 §5)

  async sync(reason: string): Promise<void> {
    if (this.pulling) return
    // A timer, a reconnect or the tail of an upload may land after `stop()` closed the database. A
    // pull with nowhere to put its rows is a no-op, never a crash on a screen that is already gone.
    const store = this.store
    if (store === null) return
    this.pulling = true
    this.emitStatus()
    try {
      const manifest = await this.call(() =>
        this.options.transport.manifest(
          this.schemaVersion === null ? {} : { knownSchemaVersion: this.schemaVersion },
        ),
      )
      await this.applyManifest(store, manifest)
      await this.pullLoop(store)
      await this.pullErrors(store)
      this.lastError = null
    } catch (error) {
      this.note(error, `sync(${reason})`)
    } finally {
      this.pulling = false
      this.emitStatus()
    }
  }

  /**
   * A changed hash, a different role or a different distributor all mean the same thing: what is on
   * the device belongs to somebody else's read set. Queued writes are FLUSHED FIRST — docs/27 §14
   * failure mode 3, "never lose writes to a re-snapshot" — and only then are the tables dropped.
   */
  private async applyManifest(store: SyncStore, manifest: ManifestOutput): Promise<void> {
    const known = {
      schemaVersion: await readState(store, 'schemaVersion'),
      role: await readState(store, 'role'),
      tenantId: await readState(store, 'tenantId'),
    }
    const tenantId = this.options.tenantId ?? null
    const wanted = this.options.tables
    const tables = wanted
      ? manifest.tables.filter((table) => wanted.includes(table.table))
      : manifest.tables
    const stale =
      manifest.changed ||
      known.schemaVersion !== manifest.schemaVersion ||
      known.role !== manifest.role ||
      (tenantId !== null && known.tenantId !== null && known.tenantId !== tenantId)
    this.manifestTables = tables
    if (tenantId !== null && known.tenantId === null) await writeState(store, 'tenantId', tenantId)
    if (!stale) {
      // The shapes still have to be loaded — this may be the first call of a fresh process.
      this.shapes = new Map(tables.map((table) => [table.table, shapeOf(table)]))
      this.schemaVersion = manifest.schemaVersion
      // The tables exist only if some earlier run created them; a device that kept its cursor but
      // lost its file (a cleared browser, a reinstall) needs them back before the delta lands.
      await createDataTables(store, tables)
      await writeState(store, 'manifest', JSON.stringify(tables))
      return
    }
    // A different role may have a tray where the last one did not (or the other way round).
    this.errorsDenied = false
    if (this.pending > 0) await this.flushInternal(store)
    await dropDataTables(store, [...this.shapes.keys(), ...tables.map((table) => table.table)])
    await createDataTables(store, tables)
    this.shapes = new Map(tables.map((table) => [table.table, shapeOf(table)]))
    await writeState(store, 'manifest', JSON.stringify(tables))
    await writeState(store, 'schemaVersion', manifest.schemaVersion)
    await writeState(store, 'role', manifest.role)
    await writeState(store, 'tenantId', tenantId)
    await writeState(store, 'protocol', String(manifest.protocol))
    await writeState(store, 'cursor', null)
    await writeState(store, 'lastPulledAt', null)
    this.schemaVersion = manifest.schemaVersion
    this.lastPulledAt = null
    this.bus.emit(this.shapes.keys())
  }

  /**
   * The tray, from the SERVER's copy (docs/23 §8.11). `_sync_errors` is a mirror, and a mirror can be
   * lost — a reinstall, a browser that cleared its data, the memory adapter after a reload — while the
   * rejection itself is a durable row the rep still has to deal with. So every successful sync asks
   * for this device's unresolved ones and mirrors them back. A shop's app has no `errors.list` at all
   * (`sync.upload` and `sync.errors.list` are STAFF) and simply skips this.
   */
  private async pullErrors(store: SyncStore): Promise<void> {
    const list = this.options.transport.listErrors
    if (list === undefined || this.errorsDenied) return
    /*
     * BEST EFFORT, ALWAYS. The tray mirror is a convenience; the pull that just committed is the
     * work. `transportFromApi` wires this whenever the oRPC client exposes the procedure — which it
     * always does, because the contract is shared — so a shop's app, where the permission matrix
     * answers 403 for `GET /sync/errors`, would otherwise throw here AFTER a perfectly good pull and
     * leave "the retailer role may not call GET /sync/errors" on the strip for ever. A refusal means
     * this role has no tray: stop asking.
     */
    let answer
    try {
      answer = await this.call(() =>
        list({ deviceId: this.options.deviceId, unresolvedOnly: true, limit: 50 }),
      )
    } catch (error) {
      if (isForbidden(error)) this.errorsDenied = true
      this.options.onLog?.('sync.errors.list skipped', error)
      return
    }
    if (answer.items.length === 0) return
    // A rejection the user has already thrown away must not come back on the next sync.
    const discarded = new Set(
      (
        await store.query<{ op_id: string }>(
          `SELECT op_id FROM ${SYNC_ERRORS_TABLE} WHERE discarded_at IS NOT NULL`,
        )
      ).map((row) => row.op_id),
    )
    await store.transaction(async (tx) => {
      for (const item of answer.items) {
        if (discarded.has(item.opId)) continue
        await tx.exec(
          `INSERT OR REPLACE INTO ${SYNC_ERRORS_TABLE} (op_id, tbl, row_id, code, message, created_at, discarded_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          [item.opId, item.table, item.rowId, item.code, item.messageEn, item.createdAt],
        )
      }
    })
    this.bus.emit([ERRORS_CHANNEL])
  }

  /** Loop while `hasMore`, always echoing the cursor the LAST response gave (docs/07 §0 rule 3). */
  private async pullLoop(store: SyncStore): Promise<void> {
    let guard = 0
    for (;;) {
      const since = await readState(store, 'cursor')
      const response = await this.call(() =>
        this.options.transport.pull({
          deviceId: this.options.deviceId,
          limit: this.pullLimit,
          ...(since === null ? {} : { since }),
          ...(this.options.tables ? { tables: [...this.options.tables] } : {}),
        }),
      )
      await this.applyPull(store, response)
      if (!response.hasMore) return
      guard += 1
      // A server that answered `hasMore` for ever would spin here; 1000 pages is far past any read set.
      if (guard > 1000) throw new Error('sync.pull did not finish: hasMore after 1000 pages')
    }
  }

  /**
   * ONE transaction per response (docs/07 §0): every tombstone of every table first, then the rows,
   * then the cursor — so a crash between the answer and the commit costs a re-pull and never a row.
   * A row never overwrites a local one the outbox is still holding (docs/27 §5 rule 3).
   */
  private async applyPull(store: SyncStore, response: PullOutput): Promise<void> {
    const touched = new Set<string>()
    await store.transaction(async (tx) => {
      for (const change of response.changes) {
        const shape = this.shapes.get(change.table)
        if (!shape || change.deleted.length === 0) continue
        for (const key of change.deleted) {
          const parts = splitDeviceKey(key, shape.primaryKey.length)
          const where = shape.primaryKey.map((column) => `${quoteIdent(column)} = ?`).join(' AND ')
          await tx.exec(`DELETE FROM ${quoteIdent(shape.table)} WHERE ${where}`, parts)
        }
        touched.add(change.table)
      }
      for (const change of response.changes) {
        const shape = this.shapes.get(change.table)
        if (!shape || change.rows.length === 0) continue
        const held = shape.writable ? await this.pendingKeys(tx, shape) : new Set<string>()
        for (const row of change.rows) {
          const key = shape.primaryKey.map((column) => keyPart(row[column])).join(':')
          if (held.has(key)) continue
          await this.upsert(tx, shape, row)
        }
        touched.add(change.table)
      }
      await writeState(tx, 'cursor', response.cursor)
      await writeState(tx, 'lastPulledAt', response.asOf)
    })
    this.lastPulledAt = response.asOf
    if (touched.size > 0) this.bus.emit(touched)
    this.emitStatus()
  }

  private async pendingKeys(tx: SyncStore, shape: TableShape): Promise<Set<string>> {
    const columns = shape.primaryKey.map(quoteIdent).join(', ')
    const rows = await tx.query<Record<string, SqlValue>>(
      `SELECT ${columns} FROM ${quoteIdent(shape.table)} WHERE ${quoteIdent(PENDING_COLUMN)} IN ('queued', 'sending')`,
    )
    return new Set(
      rows.map((row) => shape.primaryKey.map((column) => String(row[column] ?? '')).join(':')),
    )
  }

  private async upsert(
    tx: SyncStore,
    shape: TableShape,
    row: Record<string, unknown>,
  ): Promise<void> {
    const names: string[] = []
    const params: SqlValue[] = []
    for (const [column, type] of shape.types) {
      if (!Object.prototype.hasOwnProperty.call(row, column)) continue
      names.push(column)
      params.push(encodeValue(row[column], type))
    }
    if (names.length === 0) return
    const placeholders = names.map(() => '?').join(', ')
    await tx.exec(
      `INSERT OR REPLACE INTO ${quoteIdent(shape.table)} (${names.map(quoteIdent).join(', ')}) VALUES (${placeholders})`,
      params,
    )
  }

  // -------------------------------------------------------------------------------------------------------------
  // The outbox (docs/27 §6)

  /**
   * The write path a screen sees. The outbox row and the local change land in ONE transaction, so the
   * order is on the screen the instant the rep taps Submit, marked as waiting — never a row that is
   * visible but unqueued, or queued but invisible.
   */
  async enqueue(input: EnqueueInput): Promise<string> {
    const store = this.requireStore()
    const shape = this.shapes.get(input.table)
    if (!shape)
      throw new Error(
        `${input.table} is not in this device's manifest; nothing may be queued for it`,
      )
    if (!shape.writable)
      throw new Error(`${input.table} is download-only for this role (manifest writable = false)`)
    const opId = input.opId ?? uuidv7()
    const createdAt = new Date(this.now()).toISOString()
    await store.transaction(async (tx) => {
      await tx.exec(
        `INSERT OR REPLACE INTO ${OUTBOX_TABLE}
           (op_id, tbl, row_id, op, data, base_updated_at, idempotency_key, status, attempts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)`,
        [
          opId,
          input.table,
          input.id,
          input.op,
          input.data === undefined ? null : JSON.stringify(input.data),
          input.baseUpdatedAt ?? null,
          opId,
          createdAt,
        ],
      )
      await this.applyLocally(tx, shape, input)
    })
    await this.refreshCounts()
    this.bus.emit([input.table, OUTBOX_CHANNEL])
    this.emitStatus()
    void this.flush()
    return opId
  }

  private async applyLocally(tx: SyncStore, shape: TableShape, input: EnqueueInput): Promise<void> {
    const pk = shape.primaryKey
    const where = pk.map((column) => `${quoteIdent(column)} = ?`).join(' AND ')
    const keyParams: SqlValue[] = pk.map((column) =>
      column === 'id' ? input.id : ((input.data?.[column] as SqlValue | undefined) ?? null),
    )
    if (input.op === 'DELETE') {
      await tx.exec(`DELETE FROM ${quoteIdent(shape.table)} WHERE ${where}`, keyParams)
      return
    }
    const existing = await tx.query<Record<string, SqlValue>>(
      `SELECT ${quoteIdent(LOCAL_REV_COLUMN)} FROM ${quoteIdent(shape.table)} WHERE ${where}`,
      keyParams,
    )
    const rev = Number(existing[0]?.[LOCAL_REV_COLUMN] ?? 0) + 1
    const data: Record<string, unknown> = { ...(input.data ?? {}), id: input.id }
    if (existing.length > 0 && input.op === 'PATCH') {
      const sets: string[] = []
      const params: SqlValue[] = []
      for (const [column, value] of Object.entries(input.data ?? {})) {
        const type = shape.types.get(column)
        if (type === undefined) continue
        sets.push(`${quoteIdent(column)} = ?`)
        params.push(encodeValue(value, type))
      }
      sets.push(`${quoteIdent(PENDING_COLUMN)} = ?`, `${quoteIdent(LOCAL_REV_COLUMN)} = ?`)
      params.push('queued', rev)
      await tx.exec(`UPDATE ${quoteIdent(shape.table)} SET ${sets.join(', ')} WHERE ${where}`, [
        ...params,
        ...keyParams,
      ])
      return
    }
    const names: string[] = []
    const params: SqlValue[] = []
    for (const [column, type] of shape.types) {
      if (!Object.prototype.hasOwnProperty.call(data, column)) continue
      names.push(column)
      params.push(encodeValue(data[column], type))
    }
    names.push(PENDING_COLUMN, LOCAL_REV_COLUMN)
    params.push('queued', rev)
    await tx.exec(
      `INSERT OR REPLACE INTO ${quoteIdent(shape.table)} (${names.map(quoteIdent).join(', ')}) VALUES (${names
        .map(() => '?')
        .join(', ')})`,
      params,
    )
  }

  /** One batch in flight at a time; calls queue behind each other rather than racing. */
  flush(): Promise<void> {
    this.flushChain = this.flushChain.then(async () => {
      const store = this.store
      if (store === null) return
      await this.flushInternal(store)
    })
    return this.flushChain
  }

  private async flushInternal(store: SyncStore): Promise<void> {
    if (this.upgradeRequired) return
    let sent = false
    for (;;) {
      const batch = await this.claim(store)
      if (batch.length === 0) {
        // docs/27 §5, the pull schedule: "after every successful upload batch". What the server made
        // of the write — a number, a state, a price — is only on the device once it is pulled back.
        if (sent && !this.pulling) await this.sync('after-upload')
        return
      }
      this.uploading = true
      this.emitStatus()
      try {
        const response = await this.call(() =>
          this.options.transport.upload({
            protocol: CLIENT_SYNC_PROTOCOL,
            deviceId: this.options.deviceId,
            ops: batch.map(toWireOp),
          }),
        )
        await this.settle(store, batch, response.rejected, response.upgradeRequired)
        sent = sent || !response.upgradeRequired
        if (response.upgradeRequired) {
          this.upgradeRequired = true
          this.uploading = false
          this.emitStatus()
          return
        }
        this.backoffMs = BACKOFF_START_MS
        this.lastError = null
      } catch (error) {
        await this.release(store, batch)
        this.note(error, 'sync.upload')
        this.uploading = false
        this.emitStatus()
        this.scheduleRetry()
        return
      } finally {
        await this.refreshCounts()
      }
      this.uploading = false
      this.emitStatus()
    }
  }

  private async claim(store: SyncStore): Promise<OutboxRow[]> {
    const rows = await store.query<Record<string, SqlValue>>(
      `SELECT * FROM ${OUTBOX_TABLE} WHERE status = 'queued' ORDER BY seq LIMIT ?`,
      [this.uploadBatchSize],
    )
    const batch = rows.map(toOutboxRow)
    if (batch.length === 0) return batch
    const sentAt = new Date(this.now()).toISOString()
    for (const op of batch) {
      await store.exec(
        `UPDATE ${OUTBOX_TABLE} SET status = 'sending', sent_at = ?, attempts = ? WHERE op_id = ?`,
        [sentAt, op.attempts + 1, op.opId],
      )
      const shape = this.shapes.get(op.table)
      if (shape) await this.setPending(store, shape, op.rowId, 'sending')
    }
    return batch
  }

  /** A batch that never reached a service goes back to `queued` with its `opId` intact. */
  private async release(store: SyncStore, batch: readonly OutboxRow[]): Promise<void> {
    for (const op of batch) {
      await store.exec(
        `UPDATE ${OUTBOX_TABLE} SET status = 'queued', sent_at = NULL WHERE op_id = ? AND status = 'sending'`,
        [op.opId],
      )
      const shape = this.shapes.get(op.table)
      if (shape) await this.setPending(store, shape, op.rowId, 'queued')
    }
    this.bus.emit([...batch.map((op) => op.table), OUTBOX_CHANNEL])
  }

  /**
   * The 2xx answer. `accepted` and `replayed` are both success — a replay is what a device that lost
   * the response gets, and it must look identical (docs/27 §13 test 5). A rejection keeps the row and
   * mirrors the reason into `_sync_errors`, because the upload response is gone by the time the rep
   * looks at the tray.
   */
  private async settle(
    store: SyncStore,
    batch: readonly OutboxRow[],
    rejections: SyncUploadRejection[],
    upgradeRequired: boolean,
  ): Promise<void> {
    const byOpId = new Map(rejections.map((rejection) => [rejection.opId, rejection]))
    const at = new Date(this.now()).toISOString()
    const touched = new Set<string>([OUTBOX_CHANNEL])
    let stale = false
    await store.transaction(async (tx) => {
      for (const op of batch) {
        const rejection = byOpId.get(op.opId)
        const shape = this.shapes.get(op.table)
        touched.add(op.table)
        if (rejection === undefined) {
          await tx.exec(
            `UPDATE ${OUTBOX_TABLE} SET status = 'acked', acked_at = ?, rejection_code = NULL, rejection_message = NULL WHERE op_id = ?`,
            [at, op.opId],
          )
          if (shape) await this.setPending(tx, shape, op.rowId, null)
          continue
        }
        if (upgradeRequired) {
          // The server did not run the op at all: keep it queued for a build that can send it.
          await tx.exec(
            `UPDATE ${OUTBOX_TABLE} SET status = 'queued', sent_at = NULL WHERE op_id = ?`,
            [op.opId],
          )
          if (shape) await this.setPending(tx, shape, op.rowId, 'queued')
          continue
        }
        if (rejection.code === 'stale') stale = true
        await tx.exec(
          `UPDATE ${OUTBOX_TABLE} SET status = 'rejected', rejection_code = ?, rejection_message = ? WHERE op_id = ?`,
          [rejection.code, rejection.messageEn, op.opId],
        )
        await tx.exec(
          `INSERT OR REPLACE INTO ${SYNC_ERRORS_TABLE} (op_id, tbl, row_id, code, message, created_at, discarded_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          [op.opId, rejection.table, rejection.rowId, rejection.code, rejection.messageEn, at],
        )
        touched.add(ERRORS_CHANNEL)
        if (shape) await this.setPending(tx, shape, op.rowId, 'rejected')
      }
      await writeState(tx, 'lastUploadAt', at)
    })
    this.bus.emit(touched)
    // A `stale` op means the server's row moved on: fetch it so the tray can show both versions.
    if (stale && !this.pulling) await this.sync('stale-rejection')
  }

  private async setPending(
    tx: SyncStore,
    shape: TableShape,
    rowId: string,
    value: 'queued' | 'sending' | 'rejected' | null,
  ): Promise<void> {
    const key = shape.primaryKey[0] ?? 'id'
    await tx.exec(
      `UPDATE ${quoteIdent(shape.table)} SET ${quoteIdent(PENDING_COLUMN)} = ? WHERE ${quoteIdent(key)} = ?`,
      [value, rowId],
    )
  }

  /** Send a rejected op again after the user fixed what was wrong. The `opId` is deliberately kept. */
  async retry(opId: string): Promise<void> {
    const store = this.requireStore()
    const rows = await store.query<Record<string, SqlValue>>(
      `SELECT * FROM ${OUTBOX_TABLE} WHERE op_id = ?`,
      [opId],
    )
    const op = rows[0] === undefined ? null : toOutboxRow(rows[0])
    if (op === null) return
    await store.exec(
      `UPDATE ${OUTBOX_TABLE} SET status = 'queued', rejection_code = NULL, rejection_message = NULL WHERE op_id = ?`,
      [opId],
    )
    await store.exec(`DELETE FROM ${SYNC_ERRORS_TABLE} WHERE op_id = ?`, [opId])
    const shape = this.shapes.get(op.table)
    if (shape) await this.setPending(store, shape, op.rowId, 'queued')
    await this.refreshCounts()
    this.bus.emit([op.table, OUTBOX_CHANNEL, ERRORS_CHANNEL])
    this.emitStatus()
    void this.flush()
  }

  /** Throwing a rejected write away. Only ever offered on a rejection, and it leaves an audit line. */
  async discard(opId: string): Promise<void> {
    const store = this.requireStore()
    const rows = await store.query<Record<string, SqlValue>>(
      `SELECT * FROM ${OUTBOX_TABLE} WHERE op_id = ?`,
      [opId],
    )
    const op = rows[0] === undefined ? null : toOutboxRow(rows[0])
    const at = new Date(this.now()).toISOString()
    /*
     * A tray item does NOT always have an outbox row behind it: `pullErrors` brings back rejections
     * the server still holds for this device after a reinstall or a cleared browser, and returning
     * early on a missing op left those un-dismissable for ever.
     */
    await store.exec(`DELETE FROM ${OUTBOX_TABLE} WHERE op_id = ?`, [opId])
    await store.exec(`UPDATE ${SYNC_ERRORS_TABLE} SET discarded_at = ? WHERE op_id = ?`, [at, opId])
    if (op !== null) {
      const shape = this.shapes.get(op.table)
      if (shape) await this.setPending(store, shape, op.rowId, null)
    }
    await this.refreshCounts()
    this.bus.emit([op?.table ?? ERRORS_CHANNEL, OUTBOX_CHANNEL, ERRORS_CHANNEL])
    this.emitStatus()
  }

  // -------------------------------------------------------------------------------------------------------------
  // Reads

  /** What this device holds, as the last handshake published it — names, keys and who may write. */
  tables(): { table: string; primaryKey: readonly string[]; writable: boolean }[] {
    return [...this.shapes.values()].map((shape) => ({
      table: shape.table,
      primaryKey: shape.primaryKey,
      writable: shape.writable,
    }))
  }

  async countRows(table: string): Promise<number> {
    const store = this.store
    if (store === null || !this.shapes.has(table)) return 0
    const [row] = await store.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`)
    return Number(row?.n ?? 0)
  }

  async queryTable<T>(table: string, options: TableQuery = {}): Promise<T[]> {
    const store = this.store
    const shape = this.shapes.get(table)
    if (store === null || !shape) return []
    const where = options.where === undefined ? '' : ` WHERE ${options.where}`
    const order = options.orderBy === undefined ? '' : ` ORDER BY ${options.orderBy}`
    const limit = options.limit === undefined ? '' : ` LIMIT ${String(Math.trunc(options.limit))}`
    const offset =
      options.offset === undefined ? '' : ` OFFSET ${String(Math.trunc(options.offset))}`
    const rows = await store.query<Record<string, SqlValue>>(
      `SELECT * FROM ${quoteIdent(table)}${where}${order}${limit}${offset}`,
      options.params ?? [],
    )
    return rows.map((row) => decodeRow(row, shape)) as T[]
  }

  async getRow<T>(table: string, id: string): Promise<T | null> {
    const shape = this.shapes.get(table)
    if (!shape) return null
    const key = shape.primaryKey[0] ?? 'id'
    const rows = await this.queryTable<T>(table, { where: `${quoteIdent(key)} = ?`, params: [id] })
    return rows[0] ?? null
  }

  async outbox(): Promise<OutboxRow[]> {
    const store = this.store
    if (store === null) return []
    const rows = await store.query<Record<string, SqlValue>>(
      `SELECT * FROM ${OUTBOX_TABLE} ORDER BY seq`,
    )
    return rows.map(toOutboxRow)
  }

  /** The tray (docs/27 §11): the rejection, the op the device still holds, and the server's row. */
  async needsAttention(): Promise<NeedsAttentionItem[]> {
    const store = this.store
    if (store === null) return []
    const errors = await store.query<Record<string, SqlValue>>(
      `SELECT * FROM ${SYNC_ERRORS_TABLE} WHERE discarded_at IS NULL ORDER BY created_at DESC`,
    )
    const items: NeedsAttentionItem[] = []
    for (const raw of errors) {
      const error: LocalSyncError = {
        opId: String(raw.op_id ?? ''),
        table: String(raw.tbl ?? ''),
        rowId: String(raw.row_id ?? ''),
        code: String(raw.code ?? ''),
        message: String(raw.message ?? ''),
        createdAt: String(raw.created_at ?? ''),
        discardedAt: raw.discarded_at === null ? null : String(raw.discarded_at),
      }
      const opRows = await store.query<Record<string, SqlValue>>(
        `SELECT * FROM ${OUTBOX_TABLE} WHERE op_id = ?`,
        [error.opId],
      )
      const first = opRows[0]
      items.push({
        error,
        op: first === undefined ? null : toOutboxRow(first),
        serverRow: await this.getRow<Record<string, unknown>>(error.table, error.rowId),
      })
    }
    return items
  }

  // -------------------------------------------------------------------------------------------------------------
  // GPS (docs/27 §8) — never through the outbox.

  async recordGpsPoint(point: {
    tripId: string
    lat: number
    lng: number
    at?: string
    accuracyM?: number
    speedMps?: number
  }): Promise<void> {
    const store = this.requireStore()
    const ts = point.at ?? new Date(this.now()).toISOString()
    await store.exec(
      `INSERT OR REPLACE INTO ${GPS_TABLE} (ts, trip_id, lat, lng, accuracy_m, speed_mps, posted) VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [ts, point.tripId, point.lat, point.lng, point.accuracyM ?? null, point.speedMps ?? null],
    )
    const cutoff = new Date(this.now() - GPS_RETENTION_MS).toISOString()
    await store.exec(`DELETE FROM ${GPS_TABLE} WHERE posted = 1 AND ts < ?`, [cutoff])
  }

  /**
   * Post the buffer for one trip. Dedupe is `(trip, device, recordedAt)` on the server, so a batch
   * that was stored but whose answer was lost costs duplicates and never a second breadcrumb.
   */
  async flushGps(tripId: string): Promise<void> {
    const store = this.store
    const post = this.options.transport.postGpsPoints
    if (store === null || post === undefined) return
    const rows = await store.query<Record<string, SqlValue>>(
      `SELECT * FROM ${GPS_TABLE} WHERE trip_id = ? AND posted = 0 ORDER BY ts LIMIT 500`,
      [tripId],
    )
    if (rows.length === 0) return
    const idempotencyKey = uuidv7()
    await this.call(() =>
      post({
        idempotencyKey,
        tripId,
        deviceId: this.options.deviceId,
        points: rows.map((row) => ({
          recordedAt: String(row.ts ?? ''),
          lat: Number(row.lat ?? 0),
          lng: Number(row.lng ?? 0),
          ...(row.accuracy_m === null ? {} : { accuracyM: Number(row.accuracy_m) }),
          ...(row.speed_mps === null ? {} : { speedMps: Number(row.speed_mps) }),
        })),
      }),
    )
    for (const row of rows)
      await store.exec(`UPDATE ${GPS_TABLE} SET posted = 1 WHERE trip_id = ? AND ts = ?`, [
        tripId,
        String(row.ts ?? ''),
      ])
  }

  // -------------------------------------------------------------------------------------------------------------
  // Plumbing

  private requireStore(): SyncStore {
    if (this.store === null) throw new Error('the sync engine has not started yet')
    return this.store
  }

  /**
   * The read set as the last successful handshake published it. A device that starts with no signal
   * has its tables and, from here, their shapes — so `enqueue` works in a dead spot, which is the
   * whole point of the queue (docs/27 §14: "token expired while offline — the queue keeps growing").
   */
  private async restoreManifest(store: SyncStore): Promise<void> {
    const raw = await readState(store, 'manifest')
    if (raw === null) return
    try {
      this.manifestTables = JSON.parse(raw) as SyncTableManifest[]
      this.shapes = new Map(this.manifestTables.map((table) => [table.table, shapeOf(table)]))
    } catch {
      this.manifestTables = []
    }
  }

  private async refreshCounts(): Promise<void> {
    const store = this.store
    if (store === null) return
    const [pending] = await store.query<{ n: number; at: string | null }>(
      `SELECT COUNT(*) AS n, MIN(created_at) AS at FROM ${OUTBOX_TABLE} WHERE status IN ('queued', 'sending')`,
    )
    const [rejected] = await store.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${OUTBOX_TABLE} WHERE status = 'rejected'`,
    )
    this.pending = Number(pending?.n ?? 0)
    this.oldestPendingAt = pending?.at ?? null
    this.rejected = Number(rejected?.n ?? 0)
  }

  /** Every transport call goes through here, so "online" means "something answered", not a guess. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn()
      this.reachable = true
      this.lastContactAt = this.now()
      return result
    } catch (error) {
      if (isNetworkFailure(error)) this.reachable = false
      throw error
    }
  }

  private note(error: unknown, where: string): void {
    this.lastError = error instanceof Error ? error.message : String(error)
    this.options.onLog?.(`${where}: ${this.lastError}`, error)
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    const wait = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_CEILING_MS)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.flush()
    }, wait)
  }

  /**
   * The foreground poll (docs/27 §5). It is NOT gated on `online`: the poll IS the probe — its answer
   * is what sets `reachable` either way — and gating it on the state it produces is what turned one
   * bad minute into a device that never pulled again. The radio being off is the one reason to skip a
   * call, and even then the timer keeps its place so the next tick tries.
   */
  private schedulePoll(): void {
    if (this.pullIntervalMs <= 0) return
    if (this.pollTimer !== null) clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null
      void (async () => {
        if (this.started && this.radio()) {
          await this.sync('poll')
          await this.flush()
        }
        if (this.started) this.schedulePoll()
      })()
    }, this.pullIntervalMs)
  }
}

interface SyncUploadRejection {
  opId: string
  table: string
  rowId: string
  code: string
  messageEn: string
}

function toWireOp(op: OutboxRow): SyncOp {
  return {
    opId: op.opId,
    op: op.op,
    table: op.table,
    id: op.rowId,
    ...(op.data === null ? {} : { data: op.data }),
    ...(op.baseUpdatedAt === null ? {} : { baseUpdatedAt: op.baseUpdatedAt }),
    clientTime: op.createdAt,
  }
}

function toOutboxRow(row: Record<string, SqlValue>): OutboxRow {
  let data: Record<string, unknown> | null = null
  if (typeof row.data === 'string') {
    try {
      data = JSON.parse(row.data) as Record<string, unknown>
    } catch {
      data = null
    }
  }
  return {
    seq: Number(row.seq ?? 0),
    opId: String(row.op_id ?? ''),
    table: String(row.tbl ?? ''),
    rowId: String(row.row_id ?? ''),
    op: (row.op ?? 'PUT') as SyncOp['op'],
    data,
    baseUpdatedAt: row.base_updated_at === null ? null : String(row.base_updated_at),
    idempotencyKey: String(row.idempotency_key ?? ''),
    status: (row.status ?? 'queued') as OutboxRow['status'],
    attempts: Number(row.attempts ?? 0),
    createdAt: String(row.created_at ?? ''),
    sentAt: row.sent_at === null ? null : String(row.sent_at),
    ackedAt: row.acked_at === null ? null : String(row.acked_at),
    rejectionCode: row.rejection_code === null ? null : String(row.rejection_code),
    rejectionMessage: row.rejection_message === null ? null : String(row.rejection_message),
  }
}

/**
 * `stock_balances` is `lot_id:location_id` and `retailer_outstanding_summary` is `retailer_id`; every
 * other pull-able table is keyed by its uuid, which contains no colon (docs/07 §0).
 */
function splitDeviceKey(key: string, parts: number): string[] {
  if (parts <= 1) return [key]
  const split = key.split(':')
  if (split.length === parts) return split
  // A key that does not split as advertised is still a key: pad so the DELETE simply matches nothing.
  return [...split, ...Array.from({ length: Math.max(0, parts - split.length) }, () => '')].slice(
    0,
    parts,
  )
}

/** A primary-key value as the device key spells it. A jsonb column is never part of a primary key. */
function keyPart(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

function defaultNetworkHint(): boolean {
  const scope = globalThis as { navigator?: { onLine?: boolean } }
  return scope.navigator?.onLine !== false
}

/**
 * A failure that says nothing about the token or the request — the phone in a basement, a dead spot, a
 * 502 at the load balancer. `@dos/api-client` already labels these `kind: 'network'`; a raw `fetch`
 * throws a `TypeError`. Anything else (a 4xx, a 5xx with a body) is a real answer.
 */
/**
 * The permission matrix saying no. `@dos/api-client` labels these `kind: 'http'` with a `status`, and
 * a raw oRPC error carries `status`/`code` — a role that may not read the tray is a fact about the
 * role, not a fault to retry.
 */
function isForbidden(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const candidate = error as { status?: number; code?: string; message?: string }
  if (candidate.status === 403 || candidate.status === 401) return true
  if (candidate.code === 'FORBIDDEN' || candidate.code === 'UNAUTHORIZED') return true
  return (candidate.message ?? '').toLowerCase().includes('may not call')
}

function isNetworkFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const candidate = error as { kind?: string; name?: string; message?: string }
  if (candidate.kind === 'network' || candidate.kind === 'timeout') return true
  if (candidate.name === 'TypeError' || candidate.name === 'AbortError') return true
  const message = (candidate.message ?? '').toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('offline')
  )
}
