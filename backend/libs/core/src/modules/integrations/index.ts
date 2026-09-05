/**
 * Integrations' only entry point (`eslint-plugin-boundaries`). What later modules and the worker
 * import, and why (coordination §3.5, §3.9):
 *
 *   claims (7)      `ExportJobsService.enqueueExport`   — a claim sheet is an export_jobs row rendered
 *                                                          by the one `exports.render` queue
 *                   `registerExportRenderer`            — registers `claim_sheet` at boot
 *   reporting (9)   `ExportJobsService`                 — `reporting.exports.request` queues here
 *                   `registerExportRenderer`            — registers `report_<register>_<format>`
 *   worker          `worker.ts` (via `@dos/core/integrations`) — the plain job functions and the
 *                                                          services factory, no Nest DI
 */
export { IntegrationsModule } from './integrations.module.js'
export { IntegrationsService, ensureBuiltinProfiles } from './integrations.service.js'
export { ExportJobsService } from './export-jobs.service.js'
export { TallyService } from './tally.service.js'
export {
  registerExportRenderer,
  registerRenderer,
  exportRendererFor,
  registeredExportKinds,
  renderExportJob,
  type ExportKindMeta,
  type ExportRenderContext,
  type ExportRenderer,
  type RenderedExport,
  type RenderExportResult,
} from './renderers/index.js'
export { runStage, runDryRun } from './stage.js'
export { runCommit, failRun, type CommitRunResult } from './commit.js'
export { createImportServices, type ImportServices } from './services.js'
export {
  builtinProfileId,
  rowIdFor,
  entityIdFor,
  stableUuid,
  tallyGuidFor,
  integrationsConfig,
  IMPORT_RUN_EVENT,
  EXPORT_REQUESTED_EVENT,
  IMPORT_COMMITTED_EVENT,
  EXPORT_READY_EVENT,
  type ImportRunPayload,
  type ExportRenderPayload,
  type ImportPhase,
} from './integrations.internals.js'
export { BUILTIN_PROFILES, type BuiltinProfile } from './profiles.data.js'
export { parseSource, SourceFileError, type ParsedSource } from './parsing.js'
export { readXlsx, writeXlsx, parseCsv, XlsxError, type XlsxWorkbook } from './xlsx.js'
