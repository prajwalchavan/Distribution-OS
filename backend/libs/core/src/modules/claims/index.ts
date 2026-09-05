/**
 * Claims' only entry point (`eslint-plugin-boundaries`). What later modules and the worker import:
 *
 *   notifications (8)  the outbox event names a claim emits (`CLAIM_EVENTS`)
 *   reporting (9)      `ClaimReportsService` (ageing, register) for the owner's graphs
 *   worker             `worker.ts` (via `@dos/core/claims`) — `registerClaimSheetRenderer`, no Nest DI
 */
export { ClaimsModule } from './claims.module.js'
export { ClaimsService, periodWindows } from './claims.service.js'
export { ClaimReportsService } from './reports.service.js'
export { ClaimBuildService, defaultSourcesFor, type Candidate } from './build.service.js'
export { CLAIM_EVENTS, builtLineId, journalKeys } from './claims.internals.js'
export {
  registerClaimSheetRenderer,
  renderClaimSheet,
  snapshotClaimSheet,
  claimSheetObjectKey,
} from './statements.js'
export {
  CLAIM_SHEET_FORMATS,
  claimSheetFormat,
  casesAndPieces,
  type ClaimSheetFormat,
  type ClaimSheetPayload,
  type ClaimSheetRow,
} from './formats.js'
