/**
 * The fake transport the eleven tests of docs/27 §13 run against.
 *
 * It is a script, not a simulator: a test queues the exact `sync.pull` responses it wants to see
 * applied, so tombstone ordering, the `hasMore` loop and the cursor can be asserted without a server,
 * a clock or a network. `upload` records every batch and remembers outcomes by `opId`, which is what
 * makes "a replay costs one apply, not two" a real assertion rather than a hope.
 */
import type {
  ErrorsListOutput,
  ManifestInput,
  ManifestOutput,
  PullInput,
  PullOutput,
  SyncColumn,
  SyncColumnType,
  SyncTableManifest,
  UploadInput,
  UploadOutput,
} from './wire.js'
import type { SyncStore, SyncTransport } from './types.js'

export function column(name: string, type: SyncColumnType = 'string', nullable = true): SyncColumn {
  return { name, type, nullable }
}

export function tableManifest(
  table: string,
  columns: readonly SyncColumn[],
  options: { writable?: boolean; primaryKey?: readonly string[] } = {},
): SyncTableManifest {
  return {
    table,
    primaryKey: [...(options.primaryKey ?? ['id'])],
    columns: [...columns],
    writable: options.writable ?? false,
  }
}

export interface FakeRejection {
  code: string
  messageEn: string
  messageHi?: string
}

export class FakeServer {
  manifestOut: ManifestOutput
  /** Responses `pull` hands out, in order; the last one repeats once the script runs dry. */
  pulls: PullOutput[] = []
  readonly manifestCalls: ManifestInput[] = []
  readonly pullCalls: PullInput[] = []
  readonly uploadCalls: UploadInput[] = []
  /** opId -> how many times the server actually APPLIED it (a replay must not raise this). */
  readonly applied = new Map<string, number>()
  /** opId -> the rejection to answer with, instead of applying. */
  readonly rejections = new Map<string, FakeRejection>()
  /** What `sync.errors.list` answers — the tray's rows after the upload response is gone. */
  serverErrors: ErrorsListOutput['items'] = []
  /** While true every call throws the way a dead spot does. */
  offline = false
  upgradeRequired = false
  /** While set, `upload` waits on it — a batch in flight, so a test can pull mid-send. */
  private gate: Promise<void> | null = null
  private openGate: (() => void) | null = null

  constructor(tables: readonly SyncTableManifest[], role = 'salesperson', schemaVersion = 'v1') {
    this.manifestOut = {
      protocol: 1,
      schemaVersion,
      changed: true,
      role: role as ManifestOutput['role'],
      tables: [...tables],
      asOf: '2026-09-06T06:00:00.000Z',
    }
  }

  setManifest(tables: readonly SyncTableManifest[], schemaVersion: string, role?: string): void {
    this.manifestOut = {
      ...this.manifestOut,
      tables: [...tables],
      schemaVersion,
      ...(role === undefined ? {} : { role: role as ManifestOutput['role'] }),
    }
  }

  /** Hold every upload until the returned function is called. */
  hold(): () => void {
    this.gate = new Promise<void>((resolve) => {
      this.openGate = resolve
    })
    return () => {
      this.openGate?.()
      this.gate = null
      this.openGate = null
    }
  }

  queuePull(response: Partial<PullOutput> & { changes: PullOutput['changes'] }): void {
    this.pulls.push({
      cursor: 'c1',
      hasMore: false,
      asOf: '2026-09-06T06:00:00.000Z',
      ...response,
    })
  }

  transport(): SyncTransport {
    return {
      manifest: async (input) => {
        this.guard()
        this.manifestCalls.push(input)
        const changed = input.knownSchemaVersion !== this.manifestOut.schemaVersion
        return { ...this.manifestOut, changed }
      },
      pull: async (input) => {
        this.guard()
        this.pullCalls.push(input)
        const next = this.pulls.length > 1 ? this.pulls.shift() : this.pulls[0]
        return (
          next ?? {
            changes: [],
            cursor: 'c-empty',
            hasMore: false,
            asOf: '2026-09-06T06:00:00.000Z',
          }
        )
      },
      listErrors: async () => ({ items: this.serverErrors, nextCursor: null }),
      upload: async (input) => {
        this.guard()
        this.uploadCalls.push(input)
        if (this.gate !== null) await this.gate
        const out: UploadOutput = {
          accepted: 0,
          replayed: 0,
          rejected: [],
          warnings: [],
          upgradeRequired: this.upgradeRequired,
        }
        if (this.upgradeRequired) {
          for (const op of input.ops)
            out.rejected.push({
              opId: op.opId,
              table: op.table,
              rowId: op.id,
              code: 'protocol_unsupported',
              messageEn: 'App update required',
              messageHi: 'ऐप अपडेट ज़रूरी है',
            })
          return out
        }
        for (const op of input.ops) {
          const seen = this.applied.get(op.opId)
          if (seen !== undefined) {
            out.replayed += 1
            continue
          }
          const rejection = this.rejections.get(op.opId)
          if (rejection) {
            out.rejected.push({
              opId: op.opId,
              table: op.table,
              rowId: op.id,
              code: rejection.code,
              messageEn: rejection.messageEn,
              messageHi: rejection.messageHi ?? rejection.messageEn,
            })
            // A rejection is an outcome too: the server records it and never runs the op twice.
            this.applied.set(op.opId, 0)
            continue
          }
          this.applied.set(op.opId, 1)
          out.accepted += 1
        }
        return out
      },
    }
  }

  private guard(): void {
    if (!this.offline) return
    const error = new TypeError('Failed to fetch')
    throw error
  }
}

/** A store factory that hands back the SAME store every time — a phone that was restarted, not wiped. */
export function fixedStoreFactory(store: SyncStore): (name: string) => Promise<SyncStore> {
  return async (_name: string): Promise<SyncStore> => {
    void _name
    return store
  }
}
