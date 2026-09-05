/**
 * `@dos/core/docint` — the docint pipeline as plain functions (no Nest, no DI), for the pg-boss
 * worker (`backend/worker/src/jobs/docint.ts`) and for the Nest module beside this folder.
 * Coordination §3.9 worker rule: anything the worker calls is a plain exported function.
 */
export * from './types.js'
export {
  docintConfig,
  DEFAULT_DOCINT_MODEL,
  DEFAULT_DOCINT_ESCALATION_MODEL,
  type DocintConfig,
} from './config.js'
export {
  decodeQr,
  irnHash,
  parseIrpKeys,
  qrDateToIso,
  qrDateTimeToIso,
  qrGstinsValid,
  qrStatusFor,
  type DecodedQr,
} from './qr.js'
export {
  validateInvoice,
  blockingCount,
  summarise,
  shouldEscalate,
  suggestGstin,
  lineGrossPaise,
  TOLERANCE_PAISE,
  type CheckResult,
  type ValidatableInvoice,
  type ValidatableHeader,
  type ValidatableLine,
  type ValidationContext,
} from './validators.js'
export { applyReviewPatch, diffReadings, headerPath, linePath, type Correction } from './paths.js'
export {
  matchLines,
  writeCandidates,
  normalizeDescription,
  normalizeTight,
  GREEN_THRESHOLD,
  AMBER_THRESHOLD,
  type Band,
  type CandidateDraft,
  type MatchLineInput,
  type MatchLineResult,
} from './matcher.js'
export * from './engines/index.js'
export * from './steps.js'
export { runPipeline, systemRunner, inlineRunner, type RunPipelineOptions } from './run.js'
