export { RetailersModule } from './retailers.module.js'
export { RetailersService } from './retailers.service.js'
/**
 * The importer's transaction-scoped helpers (coordination §3.9: integrations is the first writer of
 * `external_party_codes` and `retailer_purchase_history`). Plain functions, so the worker's commit
 * run uses them without Nest DI; `RetailersService` delegates to the same code.
 */
export {
  matchRetailer,
  upsertRetailerFromImport,
  restoreRetailer,
  deactivateRetailer,
  linkExternalCode,
  removeExternalCodes,
  recordPurchaseHistory,
  removePurchaseHistory,
  findBeatByName,
  retailerLabels,
  type PurchaseHistoryRow,
  type RetailerCandidate,
  type RetailerImportResult,
  type RetailerImportValues,
  type RetailerMatch,
  type RetailerProbe,
  type RetailerSnapshot,
} from './import.js'
/**
 * How a shop may be reached (coordination §3.9 / §4: notifications → retailers). Plain functions so
 * the worker's outbox handlers and sweeps read them without Nest DI; the service delegates to them.
 */
export { contactPreferences, contactPreferencesFor, type ContactPreferences } from './contact.js'
/**
 * Beat reads (coordination §3.9, slice 9): which beat a rep was on across a window, and beat names.
 * Plain functions so the worker's reporting rollup scopes a rep's numbers without Nest DI.
 */
export {
  beatAssignmentsFor,
  beatLabels,
  currentBeatIdsFor,
  retailerIdsOnBeats,
  retailerRefs,
  type BeatAssignmentFilter,
  type BeatAssignmentRow,
  type RetailerRef,
} from './beat-reads.js'
/**
 * Completed beat calls in a window (coordination §3.9, slice 10): the source of a `visits` target's
 * achievement. A plain function, so the incentives sweep in the worker imports it without Nest DI.
 */
export { visitCount, type VisitCountFilter, type VisitCountRow } from './visit-reads.js'
