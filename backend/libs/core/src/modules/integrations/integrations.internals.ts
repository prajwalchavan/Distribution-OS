import { createHash } from 'node:crypto'
import { ORPCError } from '@orpc/server'
import type { ExportKind } from '@dos/contracts'
import {
  importJobMachine,
  TransitionError,
  type ImportJobEvent,
  type ImportJobState,
} from '@dos/domain'
import { outboxEvents, type Db } from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { currentTenant } from '../../platform/index.js'

/**
 * Small shared pieces of the integrations module: configuration, deterministic ids, the job machine
 * wrapper, the outbox event names the worker listens for, and the file naming of an export.
 */

export interface IntegrationsConfig {
  /**
   * Run staging, dry runs, commits and export renders inside the request instead of handing them to
   * the pg-boss worker. `INTEGRATIONS_INLINE_JOBS=1|0`; the default is inline everywhere but
   * production, which is what makes the wizard work on the founder's Mac with no worker running
   * (docint's `DOCINT_INLINE_JOBS` is the same idea).
   */
  inlineJobs: boolean
  /** Rows scored or committed per batch — one huge file never starves another tenant's job (docs/20). */
  batchSize: number
  /** How long an export download link stays good. */
  downloadTtlSeconds: number
}

const truthy = (v: string | undefined): boolean =>
  v !== undefined && ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())

export function integrationsConfig(env: NodeJS.ProcessEnv = process.env): IntegrationsConfig {
  const inline = env.INTEGRATIONS_INLINE_JOBS
  const production = env.NODE_ENV === 'production'
  return {
    inlineJobs: inline === undefined ? !production : truthy(inline),
    batchSize: 500,
    downloadTtlSeconds: 10 * 60,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// deterministic ids

/**
 * A UUIDv7-shaped id derived from a seed: the same seed gives the same id on every machine, which is
 * what makes staging, committing and the built-in profiles idempotent by construction — a replay
 * lands on the row it created the first time. Time-ordering is not needed for these rows (a row is
 * ordered by `row_no`, a profile by name), so the timestamp bits are hash bits.
 */
export function stableUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest()
  const b = Buffer.from(h.subarray(0, 16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = b.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** `import_rows.id` for row N of a job: staging the same file twice writes the same ids. */
export const rowIdFor = (jobId: string, rowNo: number): string =>
  stableUuid(`import-row:${jobId}:${String(rowNo)}`)

/** The entity a row creates (a shop, a listing, an opening bill), so a replayed commit is a no-op. */
export const entityIdFor = (jobId: string, rowNo: number, kind: string): string =>
  stableUuid(`import-entity:${jobId}:${String(rowNo)}:${kind}`)

/** A built-in profile's id in one tenant. */
export const builtinProfileId = (tenantId: string, key: string): string =>
  stableUuid(`builtin-profile:${tenantId}:${key}`)

/** The Tally GUID of one of our documents: stable across exports so Tally updates instead of duplicating. */
export function tallyGuidFor(tenantId: string, docType: string, docId: string): string {
  const hex = createHash('sha256').update(`${tenantId}:${docType}:${docId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export const contentHash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

// ---------------------------------------------------------------------------------------------------------------
// the machine

const IMPORT_STATES = new Set<string>(Object.keys(importJobMachine.transitions))

/** `importJobMachine.next` as a 409 the wizard can show, never a 500 (`succeeded` is an export's state, never an import's). */
export function jobTransition(from: string, event: ImportJobEvent): ImportJobState {
  if (!IMPORT_STATES.has(from))
    throw new ORPCError('CONFLICT', { message: `the import is in an unknown state (${from})` })
  try {
    return importJobMachine.next(from as ImportJobState, event)
  } catch (error) {
    if (error instanceof TransitionError)
      throw new ORPCError('CONFLICT', {
        message: `the import is ${from}; it cannot be ${describe(event)} now`,
        data: { from, event },
      })
    throw error
  }
}

function describe(event: ImportJobEvent): string {
  switch (event) {
    case 'stage':
      return 'staged'
    case 'commit':
      return 'committed'
    case 'committed':
      return 'finished'
    case 'confirm':
      return 'confirmed'
    case 'rollback':
      return 'rolled back'
    case 'fail':
      return 'failed'
    case 'cancel':
      return 'cancelled'
  }
}

/** The one-line English a row or a job stores when something threw; never a stack, never a SQLSTATE. */
export function friendlyMessage(error: unknown): string {
  if (error instanceof ORPCError) return String(error.message).slice(0, 300)
  if (error instanceof Error) {
    const cause = (error as { cause?: { message?: string } }).cause
    const text = cause?.message ?? error.message
    return text.replace(/\s+/g, ' ').slice(0, 300)
  }
  return 'an unexpected error stopped this row'
}

// ---------------------------------------------------------------------------------------------------------------
// outbox

/** The worker's hand-off: a job phase to run (`payload.phase`), or an export to render. */
export const IMPORT_RUN_EVENT = 'integrations.import.run'
export const EXPORT_REQUESTED_EVENT = 'integrations.export.requested'
/** Published for notifications / reporting (brief §7). */
export const IMPORT_COMMITTED_EVENT = 'ImportCommitted'
export const EXPORT_READY_EVENT = 'ExportReady'

export type ImportPhase = 'stage' | 'dry_run' | 'commit'

export interface ImportRunPayload {
  tenantId: string
  jobId: string
  phase: ImportPhase
  /** The user who pressed the button; the worker records it as the system actor's id. */
  actorId: string
  /** Rows the worker may leave out (`skipUnresolved` on commit). */
  skipUnresolved?: boolean | undefined
}

export interface ExportRenderPayload {
  tenantId: string
  exportJobId: string
  actorId: string
}

export async function emitIntegrationsEvent(
  tx: Db,
  aggregateType: 'import_job' | 'export_job',
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(outboxEvents).values({
    id: uuidv7(),
    tenantId: currentTenant().tenantId,
    aggregateType,
    aggregateId,
    eventType,
    payload,
  })
}

// ---------------------------------------------------------------------------------------------------------------
// export naming

const EXPORT_FILES: Record<string, { ext: string; mime: string; stem: string }> = {
  tally_xml: { ext: 'xml', mime: 'application/xml', stem: 'tally' },
  gstr1_json: { ext: 'json', mime: 'application/json', stem: 'gstr1' },
  sales_register_xlsx: {
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    stem: 'sales-register',
  },
  outstanding_xlsx: {
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    stem: 'outstanding',
  },
  sales_register_csv: { ext: 'csv', mime: 'text/csv', stem: 'sales-register' },
  outstanding_csv: { ext: 'csv', mime: 'text/csv', stem: 'outstanding' },
  eway_bill_json: { ext: 'json', mime: 'application/json', stem: 'eway-bills' },
  einvoice_json: { ext: 'json', mime: 'application/json', stem: 'einvoices' },
}

/**
 * How a kind another module renders is named and typed (`claim_sheet` → `claim-sheet-….xlsx`). Called
 * through `registerExportRenderer(kind, fn, meta)`; a kind nobody registered names a `.bin`.
 */
export function registerExportFileKind(
  kind: string,
  meta: { ext: string; mimeType: string; stem?: string | undefined },
): void {
  EXPORT_FILES[kind] = {
    ext: meta.ext,
    mime: meta.mimeType,
    stem: meta.stem ?? kind.replace(/_/g, '-'),
  }
}

/** `tally-2026-08-01-to-2026-08-31.xml`: derived from the kind and the window, what the browser saves it as. */
export function exportFileName(kind: string, params: Record<string, unknown>): string {
  const spec = EXPORT_FILES[kind]
  const from = typeof params.from === 'string' ? params.from : null
  const to = typeof params.to === 'string' ? params.to : null
  const stem = spec?.stem ?? kind.replace(/_/g, '-')
  const window = from && to ? (from === to ? `-${from}` : `-${from}-to-${to}`) : ''
  return `${stem}${window}.${spec?.ext ?? 'bin'}`
}

export function exportMimeType(kind: string): string {
  return EXPORT_FILES[kind]?.mime ?? 'application/octet-stream'
}

export function exportExtension(kind: string): string {
  return EXPORT_FILES[kind]?.ext ?? 'bin'
}

export const isKnownExportKind = (kind: string): kind is ExportKind => kind in EXPORT_FILES
