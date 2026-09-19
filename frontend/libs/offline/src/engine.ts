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
import { isMoneyTable } from './money.js'
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
import { readState, writeState, type SyncStateKey } from './state.js'
import { createMemoryStore } from './store/memory.js'
import type {
  EnqueueInput,
  LocalSyncError,
  NeedsAttentionItem,
  OutboxRow,
  SqlValue,
  StoreFactory,
  StoreFallback,
  StoreKind,
  SyncIdentity,
  SyncStatus,
  SyncStore,
  SyncTransport,
  TableQuery,
} from './types.js'

/** The wire version this client speaks; the server rejects anything else with `upgradeRequired`. */
export const CLIENT_SYNC_PROTOCOL = 1

/** A file-name part: letters, digits and hyphens. Every UUID fits; nothing that can walk a path does. */
const STORE_PREFIX = /^[A-Za-z0-9-]+$/
const STORE_ID = /^[A-Za-z0-9-]{1,64}$/

/**
 * The letter that names the app in its store file (DOS-167 ruling 2 (s)). `storePrefix` is a literal per app,
 * so a prefix outside this table is a bug, and it gets no file rather than a guessed one.
 */
const STORE_APP_LETTERS: ReadonlyMap<string, string> = new Map([
  ['dos-sales', 's'],
  ['dos-delivery', 'd'],
  ['dos-warehouse', 'w'],
  ['dos-harness', 'h'],
])
const STORE_APP_PREFIXES: ReadonlyMap<string, string> = new Map(
  [...STORE_APP_LETTERS].map(([prefix, letter]) => [letter, prefix]),
)
/** Every id in this system is a UUID; a file name never carries an unchecked string. Any case goes in. */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 36^24 < 2^128 < 36^25: twenty-five base-36 digits hold every UUID, zero-padded to a fixed width. */
const ID_DIGITS = 25
const STORE_NAME = /^([sdwh])([0-9a-z]{25})([0-9a-z]{25})$/

/**
 * The device database of one person inside one distributorship, for one app (DOS-167, docs/27 §2):
 * `<app><user><distributor>` — the app's letter, then each id's 128 bits in base 36, zero-padded to 25 digits —
 * exactly 51 characters of `[0-9a-z]`, e.g. `s80j3azqcg6our25a35rhwbg7r03guzv9zghwmmy1imsvb8cmft`. Two identities can
 * never open the same file, so a person who signs in on a phone somebody else used starts with no rows and no
 * cursor by construction.
 *
 * SHORT BECAUSE IT HAS TO OPEN (ruling 2 (s)). expo-sqlite's web build opens `./<name>` through wa-sqlite, whose
 * VFS allows 64 characters of path, and SQLite keeps 8 of those for the journal suffix: a name longer than 54
 * does not open at all. The 199952b name (`dos-sales__u-<uuid>__t-<uuid>.db`, 92 characters) failed on every
 * browser, and the open fell back to a store in memory. This one leaves `./` + 51 = 53.
 *
 * LOSSLESS AND COLLISION-FREE, with no hash anywhere: a canonical UUID and its 128-bit number are the same thing,
 * a number has one zero-padded base-36 spelling, the widths are fixed so the parts cannot run into each other,
 * and the alphabet has ONE case, so no case-folding file system (the iOS simulator's container sits on one) can
 * take two people's files for one. `parseStoreName` reads a name back.
 */
export function storeNameFor(prefix: string, identity: SyncIdentity): string {
  const letter = STORE_APP_LETTERS.get(prefix)
  if (letter === undefined) throw new Error(`offline: no store file for the app prefix ${prefix}`)
  return `${letter}${idDigits(identity.userId)}${idDigits(identity.tenantId)}`
}

function idDigits(id: string): string {
  if (!CANONICAL_UUID.test(id))
    throw new Error('offline: a store name takes a user id and a distributor id that are UUIDs')
  /*
   * `BigInt`: Hermes has it from React Native 0.70 (the apps run 0.86), and the Android proof checks `typeof BigInt` on its
   * first run. Should a platform lack it, the same digits come from four 32-bit limbs: the format is the rule, not the
   * arithmetic (ruling 2 (s), docs/27 §2).
   */
  return BigInt(`0x${id.toLowerCase().replaceAll('-', '')}`)
    .toString(36)
    .padStart(ID_DIGITS, '0')
}

/**
 * Whose file a name is — the app prefix and the two ids, as `storeNameFor` wrote them — or null for anything that
 * is not a store name (a `-wal` or `-shm` beside it, another app's file). For a QA listing of a phone or a browser.
 */
export function parseStoreName(
  name: string,
): { prefix: string; userId: string; tenantId: string } | null {
  const match = STORE_NAME.exec(name)
  if (match === null) return null
  const prefix = STORE_APP_PREFIXES.get(match[1] ?? '')
  const userId = uuidOfDigits(match[2] ?? '')
  const tenantId = uuidOfDigits(match[3] ?? '')
  if (prefix === undefined || userId === null || tenantId === null) return null
  return { prefix, userId, tenantId }
}

function uuidOfDigits(digits: string): string | null {
  let value = 0n
  for (const digit of digits) value = value * 36n + BigInt(Number.parseInt(digit, 36))
  const hex = value.toString(16).padStart(32, '0')
  // Twenty-five base-36 digits reach past 128 bits; a group that does is nobody's id.
  if (hex.length > 32) return null
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * The name 199952b gave the file (`<prefix>__u-<userId>__t-<tenantId>.db`, 92-96 characters). No browser ever
 * opened it; on the QA phones it did, and still holds what that build kept. It is named here only so the
 * provider can sweep it once for the person signing in (ruling 2 (s)); nothing opens it to use it.
 */
export function interimStoreName(prefix: string, identity: SyncIdentity): string {
  assertStorePrefix(prefix)
  if (!STORE_ID.test(identity.userId) || !STORE_ID.test(identity.tenantId))
    throw new Error(
      'offline: a store name takes a user id and a distributor id of letters, digits and hyphens only',
    )
  return `${prefix}__u-${identity.userId}__t-${identity.tenantId}.db`
}

/** The one fixed file per app that every build before DOS-167 kept, whoever was signed in. */
export function legacyStoreName(prefix: string): string {
  assertStorePrefix(prefix)
  return `${prefix}.db`
}

function assertStorePrefix(prefix: string): void {
  if (!STORE_PREFIX.test(prefix)) throw new Error(`offline: unsafe store prefix: ${prefix}`)
}

type ClearedStateKey = Exclude<SyncStateKey, 'deviceId'>

/**
 * Every `_sync_state` key a store opened by another identity loses: all of them but `deviceId`, which
 * belongs to the install, not to a person. A Record, so a key added to `SyncStateKey` does not compile
 * until somebody decides whether another person's store may keep it.
 */
const CLEARED_FOR_ANOTHER_IDENTITY: Record<ClearedStateKey, true> = {
  cursor: true,
  schemaVersion: true,
  manifest: true,
  role: true,
  tenantId: true,
  userId: true,
  lastPulledAt: true,
  lastUploadAt: true,
  protocol: true,
}

/** docs/27 §6: at most 50 ops in flight, one batch at a time, FIFO by `seq`. */
const DEFAULT_UPLOAD_BATCH = 50
/**
 * docs/27 §6 (DOS-056): at most this much op JSON per batch as well. A doorstep write carries its proof
 * photo inline (≤ 300 KB of JPEG, ~400 KB as base64), so fifty of them would be ~20 MB — far past the
 * sync route's 8 MiB, where the service answers 413 and the batch would be retried for ever. Half the
 * route's limit leaves room for the envelope; an op bigger than the budget still goes, on its own.
 */
const DEFAULT_UPLOAD_BATCH_BYTES = 4 * 1024 * 1024
/** What an op adds on the wire beyond its `data`: opId, table, id, timestamps and the JSON around them. */
const OP_ENVELOPE_BYTES = 256
/** docs/27 §5: 500 rows per pull call, looped while `hasMore`. */
const DEFAULT_PULL_LIMIT = 500
/** docs/27 §5: a foreground poll, never a background timer. */
const DEFAULT_PULL_INTERVAL_MS = 60_000
/** docs/27 §6: 1 s → 2 s → 4 s … 60 s, retried for ever while online. */
const BACKOFF_START_MS = 1_000
const BACKOFF_CEILING_MS = 60_000
/** docs/27 §8: breadcrumbs are pruned locally after a week. */
const GPS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * What every write answers once sign-out has begun (DOS-167, ruling (m)). A write refused here was never
 * saved, so the sign-out cannot delete it, and the screen shows this sentence instead of "saved on this phone".
 */
export class SyncEngineEndedError extends Error {
  readonly code = 'ended'

  constructor() {
    super(
      'This phone is signing out; nothing more can be saved on it. Sign in again and enter it once more.',
    )
    this.name = 'SyncEngineEndedError'
  }
}

/**
 * What `discard()` answers on a refused write that holds money (DOS-178; never-list #13).
 *
 * A person counted notes at a door and entered them. The office refused the op — a settled trip, a cancelled
 * one, a role that may not take money there — and on a settled trip this device's outbox row is the ONLY
 * record anywhere that the shop paid. So it is never deleted: the crew hands the money and the slip to the
 * cashier and calls `handOver()`, which stops the phone asking without losing anything.
 */
export class KeptMoneyError extends Error {
  readonly code = 'kept_money'

  constructor(readonly table: string) {
    super(
      'Money somebody entered is never thrown away. Hand it to the cashier, who records it at the office.',
    )
    this.name = 'KeptMoneyError'
  }
}

/**
 * What `end()` did with the file (DOS-167, ruling (m)): `kept` when it survives for this person — asked for,
 * or because the count taken once the last write and pull had landed found something still waiting — and
 * that count.
 */
export interface EndResult {
  kept: boolean
  pending: number
  rejected: number
}

export interface SyncEngineOptions {
  transport: SyncTransport
  /** One id per install (docs/27 §4); the app already has it for `auth_sessions`. */
  deviceId: string
  storeFactory: StoreFactory
  /** The database file name: `storeNameFor(prefix, identity)` in the apps, one file per person and distributor. */
  databaseName?: string
  /** Hold only these manifest tables. Omit for the whole read set. */
  tables?: readonly string[]
  /**
   * Who this database belongs to. Absent only in the harness and in tests that model a device with no
   * sign-in.
   *
   * It is stamped into `_sync_state` at open and compared there BEFORE anything is read (DOS-167): a
   * store stamped for another person or another distributor is wiped whole, queue included. Its
   * `tenantId` is also what the manifest handshake compares, because `sync.manifest` cannot say which
   * distributor it answered for — the hash is over the role's TABLES, so a rep who switches between two
   * distributors with the same role gets the identical `schemaVersion` (docs/27 §5).
   */
  identity?: SyncIdentity
  pullLimit?: number
  uploadBatchSize?: number
  /** The most op JSON one upload batch carries, in UTF-8 bytes (default 4 MiB, docs/27 §6). */
  uploadBatchBytes?: number
  /** 0 turns the foreground poll off (what the tests use). */
  pullIntervalMs?: number
  now?: () => number
  /** Whether the platform believes there is a network at all (`navigator.onLine`, NetInfo). */
  networkHint?: () => boolean
  onLog?: (line: string, detail?: unknown) => void
}

type Timer = ReturnType<typeof setTimeout>

/**
 * ONE HOLDER OF A FILE AT A TIME, per opener (DOS-167 addendum (y), merge review of ruling 2). Sign-out clears the
 * session before `end()` has finished, so the sign-in form is on the screen while `end()` still waits for a page in
 * flight: the same person signing straight back in had the provider start a second engine on the SAME file — on a
 * phone expo-sqlite hands both the same connection — and the first `end()` counted the second engine's order, dropped
 * its tables and deleted the file under it. The sweep of that person's other files ran the same way under an engine.
 *
 * So an engine takes the file from `start()` until its close has resolved, and waits for whoever held it before; the
 * sweep takes a file only while nobody holds it, and skips one in use. Keyed by the opener as well as the name: two
 * openers are two sets of files (in the apps there is one, `openStore`).
 */
const fileHolders = new WeakMap<StoreFactory, Map<string, Promise<void>>>()

interface FileHold {
  /** The holder before this one letting go; null when nobody held the file. */
  readonly previous: Promise<void> | null
  /** Let go of the file. Once is enough; again does nothing. */
  readonly release: () => void
}

function holdFile(factory: StoreFactory, name: string): FileHold {
  let holders = fileHolders.get(factory)
  if (holders === undefined) {
    holders = new Map()
    fileHolders.set(factory, holders)
  }
  const byName = holders
  const previous = byName.get(name) ?? null
  let letGo = (): void => {}
  const released = new Promise<void>((resolve) => {
    letGo = resolve
  })
  const mine = previous === null ? released : previous.then(() => released)
  byName.set(name, mine)
  void mine.then(() => {
    if (byName.get(name) === mine) byName.delete(name)
  })
  return { previous, release: letGo }
}

function fileInUse(factory: StoreFactory, name: string): boolean {
  return fileHolders.get(factory)?.has(name) ?? false
}

/**
 * The store as the engine holds it (DOS-167 addendum (x)): every call through it is counted from the moment it starts
 * until it settles, and the file is closed only once the last one has landed — once, however often `close()` is asked.
 *
 * "Sign out, keep here" crashed the delivery app on Android and Expo Go on iOS, 2 of 2 each: SIGSEGV in expo-sqlite's
 * `exsqlite3_reset`. expo-sqlite's close finalizes every prepared statement and marks the database closed only after
 * `sqlite3_close` (android SQLiteModule.kt `closeDatabase`), while a `runAsync` already on another dispatcher thread
 * passes that check and resets a statement that is gone. The engine closed the file with reads still in flight.
 */
class HeldStore implements SyncStore {
  readonly persistent: boolean
  readonly kind: StoreKind
  readonly fallback?: StoreFallback
  private readonly inFlight = new Set<Promise<unknown>>()
  private closeOnce: Promise<void> | null = null

  constructor(private readonly inner: SyncStore) {
    this.persistent = inner.persistent
    this.kind = inner.kind
    if (inner.fallback !== undefined) this.fallback = inner.fallback
  }

  exec(sql: string, params?: readonly SqlValue[]): Promise<void> {
    return this.held(this.inner.exec(sql, params))
  }

  query<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]> {
    return this.held(this.inner.query<T>(sql, params))
  }

  transaction<T>(fn: (tx: SyncStore) => Promise<T>): Promise<T> {
    return this.held(this.inner.transaction(fn))
  }

  /** No call started through this store is still running. */
  get idle(): boolean {
    return this.inFlight.size === 0
  }

  /** The close has begun (a `stop()`, or `end()`). */
  get closing(): boolean {
    return this.closeOnce !== null
  }

  /** Until no call started through this store is still running. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight])
  }

  close(): Promise<void> {
    this.closeOnce ??= this.drain().then(() => this.inner.close())
    return this.closeOnce
  }

  /** Only after the close has resolved. */
  async destroy(): Promise<void> {
    await this.close()
    await this.inner.destroy?.()
  }

  private held<T>(call: Promise<T>): Promise<T> {
    this.inFlight.add(call)
    const landed = (): void => {
      this.inFlight.delete(call)
    }
    void call.then(landed, landed)
    return call
  }
}

export class SyncEngine {
  private store: HeldStore | null = null
  private readonly bus = new ChangeBus()
  private readonly statusListeners = new Set<(status: SyncStatus) => void>()
  private shapes = new Map<string, TableShape>()
  private manifestTables: SyncTableManifest[] = []

  private readonly now: () => number
  private readonly networkHint: () => boolean
  private readonly pullLimit: number
  private readonly uploadBatchSize: number
  private readonly uploadBatchBytes: number
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
  /** Refused payments handed to the cashier and still on this phone (DOS-178) — they keep the file. */
  private heldMoney = 0
  private backoffMs = BACKOFF_START_MS
  private retryTimer: Timer | null = null
  private pollTimer: Timer | null = null
  private started = false
  /**
   * Set the moment `end()` begins (DOS-167): every write is refused from then on (`SyncEngineEndedError`),
   * nothing new starts, and a later `stop()` is a no-op.
   */
  private ended = false
  /** The one `end()`: a second call waits for the first rather than starting again. */
  private ending: Promise<EndResult> | null = null
  /**
   * A `stop()` ran before `end()` (addendum (z3)): it closed the file as it stood and never deleted it, so an `end()` that
   * finds no store answers it kept — it may hold this person's queue, and their drafts stay with it.
   */
  private stoppedBeforeEnd = false
  /** Writes that passed the gate and have not landed yet; `end()` waits for every one (ruling (m)). */
  private readonly writes = new Set<Promise<void>>()
  private flushChain: Promise<void> = Promise.resolve()
  /** The open in `start()` and the pull in flight, so `end()` never drops a table under either. */
  private opening: Promise<void> = Promise.resolve()
  private syncing: Promise<void> = Promise.resolve()
  /** This engine's hold on its file (`holdFile`), from `start()` until the file is closed. */
  private fileHold: FileHold | null = null
  /**
   * A PERSISTENT store that opened and then could not be used (DOS-167 ruling 3 (cc)): what it was and why it failed,
   * set by `bringUp` once it has closed the file and left it alone, read by `start()` for its ONE fallback in memory.
   */
  private brokenStore: { kind: StoreKind; reason: string } | null = null

  constructor(private readonly options: SyncEngineOptions) {
    this.now = options.now ?? (() => Date.now())
    this.networkHint = options.networkHint ?? defaultNetworkHint
    this.pullLimit = options.pullLimit ?? DEFAULT_PULL_LIMIT
    this.uploadBatchSize = options.uploadBatchSize ?? DEFAULT_UPLOAD_BATCH
    this.uploadBatchBytes = options.uploadBatchBytes ?? DEFAULT_UPLOAD_BATCH_BYTES
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
    if (this.started || this.ended) return
    this.started = true
    let opened = (): void => {}
    this.opening = new Promise<void>((resolve) => {
      opened = resolve
    })
    try {
      try {
        await this.bringUp(null)
      } catch (error) {
        /*
         * A STORE THAT WILL NOT OPEN IS NEVER A HANG (DOS-167 ruling 3 (cc)). This used to rethrow, and the engine
         * then stood `started` with `ready: false` for the life of the tab: the re-proof measured 240 s with no
         * `/sync` call, "Still loading the beat onto this phone" and Shops 0, while the only catch called an `onLog`
         * no app passed. The broken file has already been CLOSED and left alone — never destroyed, because nothing we
         * failed to read is thrown away (founder answer A) — so the same start sequence runs once more in memory: the
         * app signs in, syncs online, and says what it cannot keep. Exactly one fallback; a second failure throws.
         */
        const broken = this.brokenStore
        this.brokenStore = null
        if (broken === null) throw error
        this.options.onLog?.(
          'offline: the device store could not be used; running in memory',
          error,
        )
        // Said on the screen too, not only in a log: `storeNote` carries the reason for the life of the engine, and
        // the strip's note carries a sentence until the next call succeeds.
        this.lastError = `The offline copy on this device could not be opened (${broken.reason}); changes are held only until this app closes.`
        await this.bringUp(createMemoryStore({ wanted: broken.kind, reason: broken.reason }))
      }
    } finally {
      opened()
    }
    await this.drain('start')
    if (this.started) this.schedulePoll()
  }

  /**
   * THE QUEUE GOES FIRST (founder answer A, 2026-09-14; DOS-183). Every path the ENGINE schedules for itself —
   * this start, a reconnect, a poll tick — sends what is waiting before it asks the server for anything, so a person
   * who signs in over their own unsent work sees it leave before the snapshot comes down.
   *
   * `bringUp` has already put a `sending` op that the last process left back to `queued`, so the flush below sees it.
   * The upload precedes even the manifest handshake: `sync.upload` needs no manifest (the protocol is a constant and
   * the server validates the tables and the role itself, answering 2xx with `sync_errors`), and putting it first is
   * what keeps a stale manifest from dropping a table out from under a row that has not been sent yet — the drop
   * then finds `pending === 0`.
   *
   * A flush that fails changes nothing about the pull: it is caught and named here, and `sync` runs at once. The
   * outbox row survives, and the retry timer owns it from there (1 → 2 → 4 … 60 s).
   */
  private async drain(reason: string): Promise<void> {
    await this.flush({ pullAfter: false }).catch((error: unknown) => {
      this.note(error, `flush(${reason})`)
    })
    await this.sync(reason)
  }

  /**
   * The start sequence over ONE store: the file when `memory` is null, else the announced memory store of (cc)'s
   * single fallback. Everything from `createSystemTables` down is identical either way — which is the point: an app
   * that could not keep anything still holds the same tables, runs the same handshake and answers the same reads.
   */
  private async bringUp(memory: SyncStore | null): Promise<void> {
    let unclaimed: SyncStore | null = null
    const name = this.options.databaseName ?? 'dos-offline.db'
    try {
      let store: SyncStore
      if (memory !== null) {
        store = memory
      } else {
        /*
         * THE FILE IS TAKEN FIRST, and opened only once whoever held it before has let go (merge review of ruling 2,
         * `holdFile`): the engine of this same person still ending after a sign-out, or the sweep counting this file.
         */
        const hold = holdFile(this.options.storeFactory, name)
        this.fileHold = hold
        if (hold.previous !== null) await hold.previous
        if (this.stoppedWhileOpening()) {
          this.releaseFile()
          return
        }
        store = await this.options.storeFactory(name)
        unclaimed = store
        /*
         * STOPPED WHILE IT OPENED (DOS-167, merge review). The provider stops an engine the moment the session
         * changes, and that can land before the open — or the claim below — has finished: `stop()` then had no
         * store to close, and carrying on attached this file to a stopped engine and ran the handshake and the
         * tray mirror through the one api client the app keeps, as whoever is signed in by then, into this
         * file. The file is this call's alone to close. `end()` is not a stop: it waits for the open and counts.
         */
        if (this.stoppedWhileOpening()) {
          await store.close().catch(() => {})
          this.releaseFile()
          return
        }
      }
      /*
       * NEVER SILENT (DOS-167 ruling 2 (t)). A person's store that keeps nothing past this tab or this process says so,
       * once, with the opener's reason: on the web proof of 199952b every open fell back to memory without a word, and
       * a rep was told his order was kept on this phone while only the tab held it. `storeNote` carries the reason.
       */
      if (!store.persistent && this.options.identity !== undefined)
        this.options.onLog?.('offline: no persistent store; running in memory', {
          name,
          fallback: store.fallback,
        })
      await createSystemTables(store)
      await store.exec(
        `UPDATE ${OUTBOX_TABLE} SET status = 'queued', sent_at = NULL WHERE status = 'sending'`,
      )
      /*
       * WHOSE FILE IS THIS — asked before anything in it is read (DOS-167). Before this line existed the
       * only check was the manifest handshake below, which runs over the network: a Sai Distributors rep
       * who signed in after a restart was shown thirty Tarsun shops with their dues for the 0.4 s before it
       * answered, and a colleague at the same distributor was never re-snapshotted at all.
       */
      await this.claimIdentity(store)
      if (this.stoppedWhileOpening()) {
        await store.close().catch(() => {})
        this.releaseFile()
        return
      }
      /*
       * Only now does the engine answer from this file (DOS-167, ruling (o)). `outbox()` and
       * `needsAttention()` have no shape to gate them, and `useOutbox` asks the moment the provider sets the
       * engine: handed the store before the claim, they read another person's queue and refusals for as
       * long as the claim took.
       */
      // Held from here on (addendum (x)): neither `stop()` nor `end()` closes the file under a call in flight.
      const held = new HeldStore(store)
      this.store = held
      unclaimed = null
      await writeState(held, 'deviceId', this.options.deviceId)
      this.schemaVersion = await readState(held, 'schemaVersion')
      this.lastPulledAt = await readState(held, 'lastPulledAt')
      await this.restoreManifest(held)
      await this.refreshCounts()
      this.ready = true
      this.emitStatus()
      /*
       * TELL EVERY MOUNTED READ THAT THE DEVICE IS OPEN FOR BUSINESS.
       *
       * `queryTable` answers `[]` for a table whose SHAPE it does not know yet (line ~826), and the
       * shapes only exist after `restoreManifest`. A screen that mounted first therefore ran its one
       * query against an engine with no shapes, got nothing, and — because `useTable` re-runs only on
       * a table CHANGE — kept nothing for as long as it stayed mounted. On a device whose store is
       * already full and whose delta pull has nothing new to bring, no change ever comes: measured on
       * the Pixel 7, the delivery app's home screen said "Nothing is on the road yet" over a SQLite
       * file holding TRIP-NEXT as `active`, on every cold start, for ever. This is the one moment the
       * device gains the ability to answer, so it says so.
       */
      this.bus.emit([...this.shapes.keys(), OUTBOX_CHANNEL])
    } catch (error) {
      /*
       * WHAT COULD NOT BE USED IS CLOSED AND LEFT ALONE (DOS-167 ruling 3 (cc), founder answer A). A file we failed to
       * read is never destroyed — ruling (p)'s rule for a file that cannot be counted holds for one that cannot be
       * opened — and its hold is let go, so the next holder may try. When it was a PERSISTENT store, `start()` takes
       * the one fallback in memory; a memory store that fails has nowhere left to go and the error stands.
       */
      const failed = unclaimed ?? this.store
      if (memory === null && failed !== null && failed.persistent)
        this.brokenStore = {
          kind: failed.kind,
          reason: error instanceof Error ? error.message : String(error),
        }
      if (failed !== null) {
        this.store = null
        this.ready = false
        await failed.close().catch(() => {})
      }
      this.releaseFile()
      throw error
    }
  }

  async stop(): Promise<void> {
    // After `end()` the file is already closed or gone; the provider's cleanup still calls this.
    if (this.ended) return
    this.stoppedBeforeEnd = true
    this.started = false
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    if (this.pollTimer !== null) clearTimeout(this.pollTimer)
    this.retryTimer = null
    this.pollTimer = null
    /*
     * THROUGH THE SAME DRAIN AS `end()` (addendum (x)): from here every public read answers empty, the calls already in
     * flight land, and only then does the file close, once. A distributor switch is this stop on the old file.
     */
    // Still opening, or never opened: `start()` lets go of the file itself.
    const store = this.store
    if (store === null) return
    try {
      await store.close()
    } finally {
      if (this.store === store) this.store = null
      // Closed: the next holder of this file may open it (`holdFile`).
      this.releaseFile()
    }
  }

  /** `stop()` ran while `start()` was still opening or claiming its file; `end()` does not count. */
  private stoppedWhileOpening(): boolean {
    return !this.started && !this.ended
  }

  private releaseFile(): void {
    this.fileHold?.release()
    this.fileHold = null
  }

  /**
   * The read set goes (docs/27 §12, DOS-167): every data table, the cursor and what the last handshake
   * said, and the GPS buffer. The queue and its tray mirror go too, unless `keepQueue` — which keeps
   * them in THIS file, for this person only. Whose file it is (`userId`, `tenantId`) and the `deviceId`
   * are never cleared here. Every dropped table is told, so a mounted list does not keep the rows in
   * its own state until it unmounts.
   */
  async wipe(options: { keepQueue?: boolean } = {}): Promise<void> {
    await this.dropReadSet(this.requireStore(), options)
  }

  /** `wipe` on the store in hand: what `end()` runs once it has refused new writes and they have all landed. */
  private async dropReadSet(store: SyncStore, options: { keepQueue?: boolean }): Promise<void> {
    const dropped = await this.dataTablesIn(store)
    await dropDataTables(store, dropped)
    await store.exec(`DELETE FROM ${GPS_TABLE}`)
    if (options.keepQueue !== true) {
      await store.exec(`DELETE FROM ${OUTBOX_TABLE}`)
      await store.exec(`DELETE FROM ${SYNC_ERRORS_TABLE}`)
    }
    for (const key of [
      'cursor',
      'schemaVersion',
      'role',
      'lastPulledAt',
      'manifest',
      'protocol',
    ] as const)
      await writeState(store, key, null)
    this.shapes = new Map()
    this.manifestTables = []
    this.schemaVersion = null
    this.lastPulledAt = null
    await this.refreshCounts()
    this.bus.emit([...dropped, OUTBOX_CHANNEL, ERRORS_CHANNEL])
    this.emitStatus()
  }

  /**
   * What the app's sign-out calls, in the same turn as it clears the session on the device (DOS-167; founder,
   * 2026-09-13; addendum (y): a crash in here must never relaunch the app signed in).
   *
   * From the call on every write is refused with `SyncEngineEndedError` (ruling (m)): a write that was
   * never saved is never deleted, and the screen says so instead of "saved on this phone". Nothing is
   * dropped under work in flight: the engine stops starting anything, then waits for the open, the upload
   * batch, the pull page and every write already in hand — a pull page that committed after the drop would
   * put a cursor back into the file, and on SQLite its rollback would undo the drop on the shared
   * connection. Then the file is COUNTED AGAIN: a write that was in hand at the tap, or landed between the
   * tap's count and this call, waits in it now, and a file with anything waiting is kept for this person
   * exactly as `keepQueue: true` keeps it, whatever was asked — `kept` in the result says so. Then the read
   * set goes (`wipe`), the file is closed and, with nothing to keep, deleted. A kept file holds only this
   * person's unsent writes and their refusals: the same person's next `start()` sends them before it
   * re-snapshots, and anyone else's `start()` wipes them unread. The engine is finished either way; a later
   * `stop()` does nothing, and a second `end()` waits for the first.
   */
  end(options: { keepQueue: boolean; after?: Promise<unknown> }): Promise<EndResult> {
    this.ending ??= this.endOnce(options)
    return this.ending
  }

  private async endOnce(options: {
    keepQueue: boolean
    after?: Promise<unknown>
  }): Promise<EndResult> {
    // Before the first `await`: a write that begins from here on is refused (`requireStore`), and a read answers
    // empty without touching the store (`readsOpen`, addendum (x)).
    this.ended = true
    this.started = false
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    if (this.pollTimer !== null) clearTimeout(this.pollTimer)
    this.retryTimer = null
    this.pollTimer = null
    /*
     * NOT BEFORE THE SESSION HAS LEFT THE DEVICE STORE (addendum (y), merge review of ruling 2). `after` is the sign-out's
     * removal of the session from the platform store: on a phone the Keychain / EncryptedSharedPreferences delete is
     * asynchronous, and a native crash in here before it landed relaunched the app signed in. Nothing in the file is
     * touched until it has settled; every write is already refused.
     */
    if (options.after !== undefined)
      await options.after.then(
        () => undefined,
        () => undefined,
      )
    await this.settled()
    const store = this.store
    try {
      if (store === null)
        // Closed by a `stop()` before this (addendum (z3)): the file lives on as it stood, maybe with this person's queue.
        return this.stoppedBeforeEnd
          ? { kept: true, pending: this.pending, rejected: this.rejected }
          : { kept: false, pending: 0, rejected: 0 }
      if (store.closing) {
        // A `stop()` began closing this file first: it is closed as it stands, and nothing more reaches it.
        await store.close()
        return { kept: true, pending: this.pending, rejected: this.rejected }
      }
      await this.refreshCounts()
      const pending = this.pending
      const rejected = this.rejected
      // DOS-178: money handed to the cashier is neither queued nor refused, and it still keeps this file.
      const kept = options.keepQueue || pending + rejected + this.heldMoney > 0
      /*
       * THE ORDER OF THE LAST STEPS IS THE FIX FOR A NATIVE CRASH (addendum (x)): the wipe; its emit, which re-runs
       * every mounted read — each answers empty now and starts no call; `close()`, which waits for any call still in
       * flight before the file closes; and the delete only once the close has resolved.
       */
      await this.dropReadSet(store, { keepQueue: kept })
      await store.close()
      if (!kept) await store.destroy()
      return { kept, pending, rejected }
    } finally {
      // Even when a step threw: the caller signs out regardless, and this engine never writes again.
      this.store = null
      // Closed, and deleted when nothing was kept: only now may the next engine on this file open it (`holdFile`).
      this.releaseFile()
    }
  }

  /**
   * Until no open, no upload batch, no pull, no write in hand and no store call — a screen's read included
   * (addendum (x)) — is in flight. Nothing new starts once `ended` is set, so one pass that finds all of them
   * unchanged and idle is the end.
   */
  private async settled(): Promise<void> {
    await this.opening
    for (;;) {
      const flushing = this.flushChain
      const syncing = this.syncing
      const writes = [...this.writes]
      await flushing.catch(() => {})
      await syncing
      await Promise.all(writes)
      await this.store?.drain()
      if (
        flushing === this.flushChain &&
        syncing === this.syncing &&
        this.writes.size === 0 &&
        (this.store?.idle ?? true)
      )
        return
    }
  }

  /**
   * What still waits in this file — queued or sending, and refused — counted from the file itself once the
   * open in `start()` has finished (DOS-167). The sign-out decision is taken on THIS, never on `status()`:
   * the snapshot reads 0 until the open has counted the outbox, and a sign-out tapped in that window took
   * the one-tap path and deleted the queue it had not seen yet. An open that failed has no file to count.
   * Once `end()` or `stop()` has begun, the last count is the answer and the store is not read (addendum (x)).
   */
  async waiting(): Promise<{ pending: number; rejected: number }> {
    await this.opening
    if (!this.readsOpen()) return { pending: this.pending, rejected: this.rejected }
    await this.refreshCounts()
    this.emitStatus()
    return { pending: this.pending, rejected: this.rejected }
  }

  /**
   * WHOSE FILE IS THIS (DOS-167). Runs in `start()` before a shape is restored, before the first table is
   * published and before anything is uploaded.
   *
   * A store stamped for another person or another distributor is wiped whole — its read set, its queue,
   * its tray mirror, its GPS buffer and every state key but the install's `deviceId` — and the wipe is
   * logged: a foreign outbox is never sent under this person's token. A store with no stamp is simply
   * stamped. An engine with no `identity` (the harness, tests of a device nobody signed in to) skips this.
   */
  private async claimIdentity(store: SyncStore): Promise<void> {
    const wanted = this.options.identity
    if (wanted === undefined) return
    const stored = {
      userId: await readState(store, 'userId'),
      tenantId: await readState(store, 'tenantId'),
      role: await readState(store, 'role'),
    }
    const stamped = stored.userId !== null || stored.tenantId !== null || stored.role !== null
    if (stamped && (stored.userId !== wanted.userId || stored.tenantId !== wanted.tenantId)) {
      await this.wipeAll(store)
      this.options.onLog?.('offline: store belonged to another identity; wiped', {
        stored,
        wanted: { userId: wanted.userId, tenantId: wanted.tenantId, role: wanted.role },
      })
    }
    await writeState(store, 'userId', wanted.userId)
    await writeState(store, 'tenantId', wanted.tenantId)
    /*
     * The ROLE is stamped only where none is stored. For the same person in the same distributorship the
     * stored role is the one the last handshake published, and the manifest compares it with the role it
     * publishes now (docs/27 §5): overwriting it here with the session's role would make the two agree
     * before that comparison runs, and a role changed on the server with an identical hash would keep the
     * old role's read set.
     */
    if ((await readState(store, 'role')) === null) await writeState(store, 'role', wanted.role)
  }

  /** Everything another identity left, except the install's own id. */
  private async wipeAll(store: SyncStore): Promise<void> {
    await dropDataTables(store, await this.dataTablesIn(store))
    await store.exec(`DELETE FROM ${OUTBOX_TABLE}`)
    await store.exec(`DELETE FROM ${SYNC_ERRORS_TABLE}`)
    await store.exec(`DELETE FROM ${GPS_TABLE}`)
    for (const key of Object.keys(CLEARED_FOR_ANOTHER_IDENTITY) as ClearedStateKey[])
      await writeState(store, key, null)
    this.shapes = new Map()
    this.manifestTables = []
    this.schemaVersion = null
    this.lastPulledAt = null
  }

  /**
   * Every data table this file may hold: the shapes loaded in this process and the tables the stored
   * manifest names — at open nothing is loaded yet, so the stored manifest is the only list there is.
   */
  private async dataTablesIn(store: SyncStore): Promise<string[]> {
    const names = new Set(this.shapes.keys())
    const raw = await readState(store, 'manifest')
    if (raw === null) return [...names]
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed))
        for (const entry of parsed as unknown[]) {
          const table = (entry as { table?: unknown } | null)?.table
          if (typeof table === 'string') names.add(table)
        }
    } catch {
      /* an unreadable manifest names nothing; the loaded shapes still do */
    }
    return [...names]
  }

  /**
   * The person signing out may belong to other distributorships on this phone (DOS-167). Each of their
   * files is opened in turn: one with nothing queued, sending or refused is deleted, and one still
   * holding that person's unsent work is kept and reported. Best effort, file by file — a file that
   * cannot be opened is logged and skipped. The CURRENT distributorship's file is `end()`'s, not this.
   */
  static async sweepIdentityStores(
    storeFactory: StoreFactory,
    prefix: string,
    identities: readonly SyncIdentity[],
    onLog?: (line: string, detail?: unknown) => void,
  ): Promise<{ destroyed: number; kept: { identity: SyncIdentity; pending: number }[] }> {
    const owners = new Map<string, SyncIdentity>()
    for (const identity of identities) {
      try {
        owners.set(storeNameFor(prefix, identity), identity)
      } catch (error) {
        onLog?.('offline: sweep skipped a store', error)
      }
    }
    const swept = await SyncEngine.sweepStores(storeFactory, [...owners.keys()], onLog)
    const kept: { identity: SyncIdentity; pending: number }[] = []
    for (const file of swept.kept) {
      const identity = owners.get(file.name)
      if (identity !== undefined) kept.push({ identity, pending: file.pending })
    }
    return { destroyed: swept.destroyed, kept }
  }

  /**
   * The sibling rule, by file name (DOS-167 ruling 2 (s)): each file is opened in turn, one with nothing queued,
   * sending or refused is deleted, and one still holding unsent work is kept and reported. Best effort, file by
   * file — a file that cannot be opened or counted is logged, closed and skipped, never deleted.
   * `sweepIdentityStores` runs it over a person's other distributorships; the provider over the file 199952b named.
   *
   * A file somebody holds (`holdFile`) — an engine that has it open, or is still closing it — is skipped and logged,
   * never counted or deleted; a file the sweep is working on is held by the sweep, so an engine opening it waits.
   */
  static async sweepStores(
    storeFactory: StoreFactory,
    names: readonly string[],
    onLog?: (line: string, detail?: unknown) => void,
  ): Promise<{ destroyed: number; kept: { name: string; pending: number }[] }> {
    let destroyed = 0
    const kept: { name: string; pending: number }[] = []
    for (const name of names) {
      if (fileInUse(storeFactory, name)) {
        onLog?.('offline: sweep skipped a store in use', { name })
        continue
      }
      const hold = holdFile(storeFactory, name)
      try {
        const store = await storeFactory(name)
        let pending: number
        try {
          await createSystemTables(store)
          const [row] = await store.query<{ n: number }>(
            `SELECT COUNT(*) AS n FROM ${OUTBOX_TABLE} WHERE status IN ('queued', 'sending', 'rejected', 'kept')`,
          )
          pending = Number(row?.n ?? 0)
        } catch (error) {
          /*
           * A file that could not be counted is never deleted, and it is CLOSED before the sweep moves on
           * (DOS-167, ruling (p)): on a phone expo-sqlite keeps the connection it opened, and every later
           * delete of that file would fail "currently open" for as long as the app runs.
           */
          await store.close().catch(() => {})
          throw error
        }
        if (pending > 0) {
          await store.close()
          kept.push({ name, pending })
        } else if (store.destroy === undefined) {
          await store.close()
        } else {
          await store.destroy()
          destroyed += 1
        }
      } catch (error) {
        onLog?.('offline: sweep skipped a store', error)
      } finally {
        hold.release()
      }
    }
    return { destroyed, kept }
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
      // Null until something has resolved: never “will not keep” over a store that is still opening (ruling 3 (ee)).
      persistent: this.store === null ? null : this.store.persistent,
      storeNote:
        this.store === null || this.store.persistent ? null : (this.store.fallback?.reason ?? null),
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
    /*
     * WHAT THE ENGINE ITSELF KNEW, NEVER `navigator.onLine` (DOS-183). This used to ask `radio()`, which falls back
     * to the browser's flag when no hint was ever given — and inside the browser's own `online` handler that flag is
     * already true. A page that BOOTED in a dead spot (`radioOn` still null) therefore answered "I knew that" to the
     * one event that says the radio is back, and sat on its queue until the 60 s poll: measured at 49.5 s with an
     * order waiting. The only reason to do nothing is that this engine already believed it was connected AND its
     * last call reached a service.
     */
    const believed = this.radioOn === true && this.reachable
    this.radioOn = online
    if (online) {
      this.reachable = true
      this.backoffMs = BACKOFF_START_MS
    }
    this.emitStatus()
    if (!online || believed || !this.started) return
    // The reconnect IS the retry: leaving the timer armed would only send the same ops a second time.
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
    void this.drain('reconnect')
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
    // Once `end()` has begun nothing new starts: the read set is about to be dropped (DOS-167). Nor once
    // `stop()` has: a reconnect landing while it closes the file must not run a handshake (merge review).
    if (this.pulling || this.ended || !this.started) return
    // A timer, a reconnect or the tail of an upload may land after `stop()` closed the database. A
    // pull with nowhere to put its rows is a no-op, never a crash on a screen that is already gone.
    const store = this.store
    if (store === null) return
    this.pulling = true
    let finished = (): void => {}
    this.syncing = new Promise<void>((resolve) => {
      finished = resolve
    })
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
      finished()
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
    // The stamp at open already wrote this `tenantId`; the comparison stays as the handshake's own check.
    const tenantId = this.options.identity?.tenantId ?? null
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
    // A page that was in flight when the engine stopped or began to end does not ask for the tray (DOS-167).
    if (list === undefined || this.errorsDenied || !this.started) return
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
    /*
     * A rejection the user has already dealt with must not come back on the next sync — thrown away, or
     * (DOS-178) handed to the cashier. `INSERT OR REPLACE` writes a whole new row, so without this a
     * handed-over payment would lose its `handed_over_at` and start asking for attention again.
     */
    const settled = new Set(
      (
        await store.query<{ op_id: string }>(
          `SELECT op_id FROM ${SYNC_ERRORS_TABLE} WHERE discarded_at IS NOT NULL OR handed_over_at IS NOT NULL`,
        )
      ).map((row) => row.op_id),
    )
    await store.transaction(async (tx) => {
      for (const item of answer.items) {
        if (settled.has(item.opId)) continue
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
      /*
       * A STOPPED ENGINE STOPS PULLING — this line, and the one in `flush`, are the whole of it.
       *
       * `stop()` clears the timers and closes the database, but a pull loop already inside its
       * `for(;;)` holds the store it was handed and kept going to the last page. A cold read set is
       * many pages (about 25 for a salesperson on the pilot data; 265 before DOS-080), so an engine
       * replaced a second after it started — a token refresh, a distributor switch, or the provider's
       * own effect re-running — crawled the WHOLE thing a second time in parallel: measured 530
       * `sync/pull` calls on one sign-in of the sales app, where the read set was 265 pages before
       * DOS-080. That is twice the data on a phone paying for it (UX-00 §8.3 budgets 10 MB a day)
       * and a signed-out app still calling the service. Rows kept landing in a store nothing reads,
       * so nothing on screen ever said so.
       */
      if (!this.started) return
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
    // Called before the first `await`, so the gate in `enqueueMany` still refuses synchronously (ruling (m)).
    const [opId] = await this.enqueueMany([input])
    if (opId === undefined) throw new Error('offline: the outbox took no op')
    return opId
  }

  /**
   * An aggregate as ONE write (DOS-167 ruling 2 (u)): an order and its lines land in the outbox together, or none of
   * them does. One gate; every input checked against the manifest BEFORE anything is written, so one line this role
   * may not queue refuses the whole order; one transaction that inserts the rows in call order — ascending `seq`,
   * header first, so FIFO still delivers an order before its lines — and applies each locally; then one count, one
   * message to every table touched and one flush.
   *
   * Queued one enqueue at a time, a sign-out that began between the header and its lines refused the lines after the
   * header had landed, and the office got a draft with no lines (web proof V5E). Refused at the gate now, nothing of
   * it is queued; past the gate, `end()` waits for it, counts it and keeps the file (ruling (m)).
   */
  async enqueueMany(inputs: readonly EnqueueInput[]): Promise<string[]> {
    // The gate: once `end()` has begun this refuses, before anything is written (DOS-167, ruling (m)).
    const store = this.requireStore()
    const planned = inputs.map((input) => {
      const shape = this.shapes.get(input.table)
      if (!shape)
        throw new Error(
          `${input.table} is not in this device's manifest; nothing may be queued for it`,
        )
      if (!shape.writable)
        throw new Error(`${input.table} is download-only for this role (manifest writable = false)`)
      return { input, shape, opId: input.opId ?? uuidv7() }
    })
    if (planned.length === 0) return []
    const createdAt = new Date(this.now()).toISOString()
    return this.inHand(async () => {
      await store.transaction(async (tx) => {
        for (const { input, shape, opId } of planned) {
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
        }
      })
      await this.refreshCounts()
      this.bus.emit([...planned.map(({ input }) => input.table), OUTBOX_CHANNEL])
      this.emitStatus()
      /*
       * ASKED WITH `void`, SO IT MUST NAME ITS OWN FAILURE (merge review of this lane, minor 2). A flush now
       * rejects for its caller (R3); on these three there is no caller, and a device store that blinked under
       * `claim` would otherwise be an `unhandledrejection` in the browser and a LogBox warning on the phone, with
       * nothing saying which step it was. The queue itself is safe either way — the row stays `queued` and the
       * poll's drain owns it within the minute.
       */
      void this.flush().catch((error: unknown) => this.note(error, 'flush(write)'))
      return planned.map(({ opId }) => opId)
    })
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

  /**
   * One batch in flight at a time; calls queue behind each other rather than racing.
   *
   * `pullAfter` is true for everyone who calls this on their own account (a write, a retry, the retry timer): what
   * the server made of a write is only on the device once it is pulled back. `drain` passes false because it runs
   * the pull itself, immediately afterwards, whether the upload worked or not (DOS-183).
   */
  flush(options: { pullAfter?: boolean } = {}): Promise<void> {
    const pullAfter = options.pullAfter ?? true
    const run = async (): Promise<void> => {
      const store = this.store
      /*
       * NOT BEFORE THE SHAPES EXIST (merge review of this lane, minor 1). `started` is true from the first line of
       * `start()` and the store is handed over several awaits before `restoreManifest` has run, so a reconnect hint
       * landing in that window found a store and no shapes: `claim` and `settle` both skipped `setPending`, the
       * upload landed, and the local row kept `_pending = 'queued'` — a "waiting" chip on an order the server
       * already had, and a row `pendingKeys` then held back from every pull. `start()`'s own drain runs after
       * `ready`, and the outbox row is a row: whatever this returns for, the next flush sends it.
       */
      if (store === null || !this.ready) return
      await this.flushInternal(store, pullAfter)
    }
    /*
     * A FLUSH THAT FAILS BLOCKS NOTHING (DOS-183). The chain was built with `.then` alone, so one throw out of
     * `claim`/`settle` — a device store that blinked, not a network failure, which `flushInternal` already handles —
     * left `flushChain` rejected and every later flush of this engine dead: the queue never moved again for the life
     * of the tab. Nothing awaited it before, so it was latent; the start now does. The caller still SEES the
     * rejection (`link`); what the next flush waits on never carries it forward.
     */
    const link = this.flushChain.then(run, run)
    this.flushChain = link.catch(() => undefined)
    return link
  }

  private async flushInternal(store: SyncStore, pullAfter = true): Promise<void> {
    if (this.upgradeRequired) return
    let sent = false
    for (;;) {
      // See `pullLoop`: a stopped engine stops talking to the service. The ops stay `queued` in the
      // outbox, which is a table, so the engine that replaces this one sends them.
      if (!this.started) return
      const batch = await this.claim(store)
      if (batch.length === 0) {
        // docs/27 §5, the pull schedule: "after every successful upload batch". What the server made
        // of the write — a number, a state, a price — is only on the device once it is pulled back.
        // Skipped only for `drain`, which pulls itself the moment this returns (DOS-183).
        if (sent && pullAfter && !this.pulling) await this.sync('after-upload')
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
    // FIFO within the byte budget too (DOS-056): stop before the op that would push the batch past
    // it, but always take the first, so an op larger than the budget is sent alone, never stranded.
    const batch: OutboxRow[] = []
    let bytes = 0
    for (const row of rows) {
      const size = wireBytes(row)
      if (batch.length > 0 && bytes + size > this.uploadBatchBytes) break
      batch.push(toOutboxRow(row))
      bytes += size
    }
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
    value: 'queued' | 'sending' | 'rejected' | 'kept' | null,
  ): Promise<void> {
    const key = shape.primaryKey[0] ?? 'id'
    await tx.exec(
      `UPDATE ${quoteIdent(shape.table)} SET ${quoteIdent(PENDING_COLUMN)} = ? WHERE ${quoteIdent(key)} = ?`,
      [value, rowId],
    )
  }

  /** Send a rejected op again after the user fixed what was wrong. The `opId` is deliberately kept. */
  async retry(opId: string): Promise<void> {
    // The gate (ruling (m)): refused once `end()` has begun.
    const store = this.requireStore()
    return this.inHand(async () => {
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
      // Named for the same reason as the write's own kick above.
      void this.flush().catch((error: unknown) => this.note(error, 'flush(retry)'))
    })
  }

  /**
   * Throwing a rejected write away. Only ever offered on a rejection, and it leaves an audit line.
   *
   * NEVER on money (DOS-178). A refused op on `receipts`, `allocations` or `collections` carries rupees a
   * person counted at a door, and on a settled trip this row is the only record of them anywhere — so it is
   * refused here, at the engine, and not merely hidden by whichever screen happens to draw the tray.
   */
  async discard(opId: string): Promise<void> {
    // The gate (ruling (m)): refused once `end()` has begun.
    const store = this.requireStore()
    return this.inHand(async () => {
      const rows = await store.query<Record<string, SqlValue>>(
        `SELECT * FROM ${OUTBOX_TABLE} WHERE op_id = ?`,
        [opId],
      )
      const op = rows[0] === undefined ? null : toOutboxRow(rows[0])
      const at = new Date(this.now()).toISOString()
      /*
       * A tray item does NOT always have an outbox row behind it: `pullErrors` brings back rejections
       * the server still holds for this device after a reinstall or a cleared browser, and returning
       * early on a missing op left those un-dismissable for ever. So the table is read from whichever of
       * the two the device still has — and a money refusal is refused either way.
       */
      const table = op?.table ?? (await this.errorTable(store, opId))
      if (table !== null && isMoneyTable(table)) throw new KeptMoneyError(table)
      await store.exec(`DELETE FROM ${OUTBOX_TABLE} WHERE op_id = ?`, [opId])
      await store.exec(`UPDATE ${SYNC_ERRORS_TABLE} SET discarded_at = ? WHERE op_id = ?`, [
        at,
        opId,
      ])
      if (op !== null) {
        const shape = this.shapes.get(op.table)
        if (shape) await this.setPending(store, shape, op.rowId, null)
      }
      await this.refreshCounts()
      this.bus.emit([op?.table ?? ERRORS_CHANNEL, OUTBOX_CHANNEL, ERRORS_CHANNEL])
      this.emitStatus()
    })
  }

  /**
   * THE WAY OUT FOR A REFUSED PAYMENT (DOS-178): the crew handed the money and the slip to the cashier, who
   * records it at the office against the same paper-book number.
   *
   * Nothing is deleted. The op moves to `kept`, which is not a status `claim()` will ever pick up — sending
   * it again would only replay the server's stored refusal (S-73) — the row's `_pending` says `kept` so D8
   * stops asking the driver to hand the same rupee over twice, and `_sync_errors.handed_over_at` records
   * when. It leaves the "need attention" count and never leaves the phone.
   */
  async handOver(opId: string): Promise<void> {
    // The gate (ruling (m)): refused once `end()` has begun.
    const store = this.requireStore()
    return this.inHand(async () => {
      const rows = await store.query<Record<string, SqlValue>>(
        `SELECT * FROM ${OUTBOX_TABLE} WHERE op_id = ?`,
        [opId],
      )
      const op = rows[0] === undefined ? null : toOutboxRow(rows[0])
      const at = new Date(this.now()).toISOString()
      await store.exec(`UPDATE ${OUTBOX_TABLE} SET status = 'kept' WHERE op_id = ?`, [opId])
      await store.exec(`UPDATE ${SYNC_ERRORS_TABLE} SET handed_over_at = ? WHERE op_id = ?`, [
        at,
        opId,
      ])
      if (op !== null) {
        const shape = this.shapes.get(op.table)
        if (shape) await this.setPending(store, shape, op.rowId, 'kept')
      }
      await this.refreshCounts()
      this.bus.emit([op?.table ?? ERRORS_CHANNEL, OUTBOX_CHANNEL, ERRORS_CHANNEL])
      this.emitStatus()
    })
  }

  /** The table a tray item names when the op itself is gone: `_sync_errors` is the other half of the record. */
  private async errorTable(store: SyncStore, opId: string): Promise<string | null> {
    const rows = await store.query<Record<string, SqlValue>>(
      `SELECT tbl FROM ${SYNC_ERRORS_TABLE} WHERE op_id = ?`,
      [opId],
    )
    const table = rows[0]?.tbl
    return table === undefined || table === null ? null : String(table)
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
    if (store === null || !this.readsOpen() || !this.shapes.has(table)) return 0
    const [row] = await store.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`)
    return Number(row?.n ?? 0)
  }

  async queryTable<T>(table: string, options: TableQuery = {}): Promise<T[]> {
    const store = this.store
    const shape = this.shapes.get(table)
    if (store === null || !shape || !this.readsOpen()) return []
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
    if (store === null || !this.readsOpen()) return []
    const rows = await store.query<Record<string, SqlValue>>(
      `SELECT * FROM ${OUTBOX_TABLE} ORDER BY seq`,
    )
    return rows.map(toOutboxRow)
  }

  /** The tray (docs/27 §11): the rejection, the op the device still holds, and the server's row. */
  async needsAttention(): Promise<NeedsAttentionItem[]> {
    const store = this.store
    if (store === null || !this.readsOpen()) return []
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
        handedOverAt:
          raw.handed_over_at === null || raw.handed_over_at === undefined
            ? null
            : String(raw.handed_over_at),
      }
      // A sign-out or a stop that began while this read ran ends it here: no call starts after it (addendum (x)).
      if (!this.readsOpen()) return []
      const opRows = await store.query<Record<string, SqlValue>>(
        `SELECT * FROM ${OUTBOX_TABLE} WHERE op_id = ?`,
        [error.opId],
      )
      const first = opRows[0]
      items.push({
        error,
        op: first === undefined ? null : toOutboxRow(first),
        serverRow: await this.getRow<Record<string, unknown>>(error.table, error.rowId),
        // DOS-178: decided by the TABLE, so it cannot drift as the server adds refusal codes.
        kept: isMoneyTable(error.table),
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
    // The gate (ruling (m)): refused once `end()` has begun, like every other write.
    const store = this.requireStore()
    return this.inHand(async () => {
      const ts = point.at ?? new Date(this.now()).toISOString()
      await store.exec(
        `INSERT OR REPLACE INTO ${GPS_TABLE} (ts, trip_id, lat, lng, accuracy_m, speed_mps, posted) VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [ts, point.tripId, point.lat, point.lng, point.accuracyM ?? null, point.speedMps ?? null],
      )
      const cutoff = new Date(this.now() - GPS_RETENTION_MS).toISOString()
      await store.exec(`DELETE FROM ${GPS_TABLE} WHERE posted = 1 AND ts < ?`, [cutoff])
    })
  }

  /**
   * Post the buffer for one trip. Dedupe is `(trip, device, recordedAt)` on the server, so a batch
   * that was stored but whose answer was lost costs duplicates and never a second breadcrumb.
   */
  async flushGps(tripId: string): Promise<void> {
    const store = this.store
    const post = this.options.transport.postGpsPoints
    if (store === null || post === undefined || !this.readsOpen()) return
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
    if (!this.readsOpen()) return
    for (const row of rows)
      await store.exec(`UPDATE ${GPS_TABLE} SET posted = 1 WHERE trip_id = ? AND ts = ?`, [
        tripId,
        String(row.ts ?? ''),
      ])
  }

  // -------------------------------------------------------------------------------------------------------------
  // Plumbing

  /**
   * The store a write may use, and the gate every write passes first (DOS-167, ruling (m)): from the moment
   * `end()` begins, and after it has finished, nothing more is saved on this phone and the person is told so
   * in a sentence — never shown a write that the sign-out would then delete.
   */
  /**
   * Whether a public read may still touch the store (DOS-167 addendum (x)): not once `end()` or `stop()` has begun.
   * From then on a read answers empty and starts no call the close would have to wait for — the emit of the dropped
   * tables re-runs every mounted read, and those reads were still in flight when expo-sqlite closed the file under
   * them.
   */
  private readsOpen(): boolean {
    return this.started && !this.ended
  }

  private requireStore(): SyncStore {
    if (this.ended) throw new SyncEngineEndedError()
    if (this.store === null) throw new Error('the sync engine has not started yet')
    return this.store
  }

  /**
   * A write that passed the gate, held in `writes` from before its first `await` until it has landed and told
   * the bus (DOS-167, ruling (m)). `end()` waits for every one, so a write begun a moment before the tap lands
   * whole and is counted and kept, rather than having its tables dropped under its transaction.
   */
  private async inHand<T>(write: () => Promise<T>): Promise<T> {
    let landed = (): void => {}
    const held = new Promise<void>((resolve) => {
      landed = resolve
    })
    this.writes.add(held)
    try {
      return await write()
    } finally {
      this.writes.delete(held)
      landed()
    }
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
    /*
     * DOS-178: a payment handed to the cashier is nobody's work any more, so it leaves `rejected` — but it
     * is still the only record that the shop paid, so it is counted here and a sign-out keeps the file.
     */
    const [held] = await store.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${OUTBOX_TABLE} WHERE status = 'kept'`,
    )
    this.pending = Number(pending?.n ?? 0)
    this.oldestPendingAt = pending?.at ?? null
    this.rejected = Number(rejected?.n ?? 0)
    this.heldMoney = Number(held?.n ?? 0)
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
      // Named for the same reason as the write's own kick: nobody is waiting on this one either.
      void this.flush().catch((error: unknown) => this.note(error, 'flush(retry-timer)'))
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
        // The queue before the pull on this tick too (DOS-183): a row a crash left behind, or one whose upload
        // failed between ticks, goes out before the engine asks for anything.
        if (this.started && this.radio()) await this.drain('poll')
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

/** An outbox row's weight on the wire, in UTF-8 bytes: its `data` JSON plus the envelope. */
function wireBytes(row: Record<string, SqlValue>): number {
  return OP_ENVELOPE_BYTES + (typeof row.data === 'string' ? utf8Length(row.data) : 0)
}

function utf8Length(text: string): number {
  // Base64, ids and numbers are ASCII — one byte a character — so most ops never reach the loop.
  if (!/[\u0080-\uffff]/.test(text)) return text.length
  let bytes = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff)
      bytes += 4 // a surrogate pair is 4 bytes in all
    else if (code >= 0xdc00 && code <= 0xdfff) bytes += 0
    else bytes += 3
  }
  return bytes
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
