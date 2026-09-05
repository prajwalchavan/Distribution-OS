export { DocintModule } from './docint.module.js'
export { DocumentsService } from './documents.service.js'
export { ExtractionsService } from './extractions.service.js'
export { MatchesService } from './matches.service.js'
export { ReviewService } from './review.service.js'
export { QueueService } from './queue.service.js'
/**
 * The pipeline the worker runs (plain functions, no DI; `@dos/core/docint` is the worker's subpath).
 * Re-exported here so a module that needs a document's reading (claims: `DocintService.get`, per
 * coordination §4) reaches it through this index.
 */
export {
  DOCINT_EVENTS,
  bestExtraction,
  latestExtraction,
  loadDocumentRow,
  readingOf,
  runPipeline,
  systemRunner,
  docintConfig,
  type DocumentRow,
  type PipelineJob,
  type PipelineRunner,
  type StepResult,
} from './pipeline/index.js'
