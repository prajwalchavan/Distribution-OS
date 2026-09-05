import type {
  DocumentKind,
  DocumentPageMimeType,
  ExtractedInvoice,
  ExtractionEngine,
  QrPayload,
} from '@dos/contracts'
import type { Db } from '@dos/db'

/**
 * The docint pipeline (docs/22 §5, docs/plans/docint.md §7) as PLAIN functions: no Nest, no DI. The
 * pg-boss worker imports this folder through `@dos/core/docint` and the Nest services in the parent
 * folder call the same functions inline when `DOCINT_INLINE_JOBS` is on (specs, local demo), so the
 * rules are written exactly once.
 */

/** One page's bytes, pulled from object storage by the step that needs them (docs/20 rule 15). */
export interface PageImage {
  pageNo: number
  mimeType: DocumentPageMimeType
  bytes: Buffer
  width: number | null
  height: number | null
}

/** A tenant catalog row the engine may be told about: what this supplier has printed before. */
export interface CatalogHint {
  variantId: string
  variantName: string
  productName: string
  brandName: string | null
  supplierCode: string | null
  supplierDescription: string | null
  hsnCode: string
  mrpPaise: number | null
  pcsPerCase: number
  gstBps: number | null
  cessBps: number | null
}

/** Everything the pipeline knows before the engine reads the page; the stub builds its reading from it. */
export interface EngineHints {
  tenantId: string
  documentId: string
  kind: DocumentKind
  contentHash: string | null
  supplier: { id: string; name: string; gstin: string | null; stateCode: string | null } | null
  buyer: { name: string; gstin: string | null; stateCode: string | null }
  expectedPages: number | null
  qr: QrPayload | null
  catalog: CatalogHint[]
  /** The capture note ("3 cases short", "reliance kalyan bill"), free text. */
  note: string | null
}

export interface EngineRunInput {
  pages: PageImage[]
  /** Prompt profile chosen at pre-classification: `sap-reliance`, `guiltfree-dms`, `generic`, … */
  profile: string
  hints: EngineHints
  /** The first reading (`llm_vision`) or the escalated second one (`llm_vision_secondary`, docs/05 step 7). */
  engine: 'llm_vision' | 'llm_vision_secondary' | 'template'
  /** Override the model the config would pick for `engine`. */
  model?: string | undefined
}

export interface EngineResult {
  result: ExtractedInvoice
  engine: ExtractionEngine
  model: string
  promptVersion: string
  engineVersion: string
  costPaise: number
  latencyMs: number
  /** 0–1, the engine's own confidence in the whole reading. */
  confidence: number
}

/** The adapter behind `DOCINT_ENGINE`: `stub` (deterministic, no network) or `anthropic` (vision). */
export interface ExtractionEngineAdapter {
  readonly name: 'stub' | 'anthropic'
  run(input: EngineRunInput): Promise<EngineResult>
}

/**
 * A fault the next attempt may not see (rate limit, 5xx, network): the pg-boss job throws it so the
 * queue retries with backoff. Anything else is permanent and counts against `attempt_count`.
 */
export class EngineTransientError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'EngineTransientError'
  }
}

/** The engine answered, but not with a reading this pipeline can use (bad JSON, schema miss). */
export class EngineFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'EngineFailure'
  }
}

/**
 * How a step reaches the database. The worker runs every step inside its own `withTenant` as the
 * system role; the inline path (specs, local demo) reuses the request's transaction, escalated to the
 * system role for the duration of the step. Either way a step never opens a connection of its own.
 */
export interface PipelineRunner {
  readonly tenantId: string
  run<T>(fn: (tx: Db) => Promise<T>): Promise<T>
}

export interface PipelineJob {
  tenantId: string
  documentId: string
}

/** What every step answers: where the document stands now, so the job can decide the next step. */
export interface StepResult {
  documentId: string
  status: string
  /** The extraction the step wrote or worked on, when one exists. */
  extractionId: string | null
  /** Failed checks after this step (`error` severity blocks, `warn` does not). */
  errors: number
  warnings: number
  /** Lines with no chosen candidate after the match step. */
  unmatched: number
  /** Set by the validate step when the reading should be re-read on the secondary engine. */
  escalate: boolean
}
