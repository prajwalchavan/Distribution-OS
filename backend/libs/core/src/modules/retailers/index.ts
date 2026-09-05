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
