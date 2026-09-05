import type { Db, TenantContext } from '@dos/db'
import { registerExportFileKind } from '../integrations.internals.js'
import type { ImportServices } from '../services.js'

/**
 * THE ONE EXPORT RENDERER REGISTRY (coordination §3.5): every kind of file the `exports.render`
 * queue can produce is a function registered here by name. Integrations registers the six kinds of
 * `ExportKindSchema` (plus the CSV twins of the two registers); claims registers `claim_sheet`;
 * reporting registers `report_<register>_<format>`. One queue, one table, one place a kind is looked up.
 *
 * A renderer gets the job's params and a `run(fn)` that opens a tenant transaction as the requesting
 * actor (the worker runs it as the system role for that tenant), reads through the owning modules'
 * services, and answers bytes. It never touches `export_jobs` itself: `renderExportJob` marks the
 * job running / succeeded / failed and writes the file.
 */
export interface ExportRenderContext {
  db: Db
  ctx: TenantContext
  services: ImportServices
  exportJobId: string
  kind: string
  params: Record<string, unknown>
  /** A tenant transaction as the actor the job runs as. */
  run<T>(fn: (tx: Db) => Promise<T>): Promise<T>
}

export interface RenderedExport {
  body: Buffer
  mimeType: string
  /** Vouchers / invoices / rows in the file. */
  rowCount: number
  /** File extension, without the dot. */
  ext: string
}

export type ExportRenderer = (rc: ExportRenderContext) => Promise<RenderedExport>

const registry = new Map<string, ExportRenderer>()

export interface ExportKindMeta {
  /** File extension without the dot, and the MIME type `downloadUrl` reports. */
  ext: string
  mimeType: string
  /** The file-name stem (`claim-sheet`); the kind with dashes when omitted. */
  stem?: string | undefined
}

/**
 * Register (or replace) the renderer of one export kind. Later modules call this at boot — in the
 * API (their Nest module's `onModuleInit`) AND in the worker (`backend/worker/src/main.ts`), since the
 * registry is per process. `meta` names the file the kind produces; integrations' own kinds are
 * pre-named in `integrations.internals.ts`.
 */
export function registerExportRenderer(
  kind: string,
  renderer: ExportRenderer,
  meta?: ExportKindMeta,
): void {
  registry.set(kind, renderer)
  if (meta) registerExportFileKind(kind, meta)
}

/** Alias of `registerExportRenderer`, the name coordination §3.5 and the task use interchangeably. */
export const registerRenderer = registerExportRenderer

export function exportRendererFor(kind: string): ExportRenderer | undefined {
  return registry.get(kind)
}

export function registeredExportKinds(): string[] {
  return [...registry.keys()].sort()
}
