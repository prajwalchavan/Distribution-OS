export { InventoryModule } from './inventory.module.js'
export {
  InventoryService,
  pgConstraint,
  type LedgerEntryInput,
  type LedgerReasonFilter,
  type LedgerReasonRow,
  type LedgerRefRow,
  type LotInput,
  type PostPickInput,
  type PostResult,
  type ReservationFilter,
  type ReservationListRow,
  type ReservationState,
  type ReserveInput,
} from './inventory.service.js'
/**
 * Stock on hand per variant and location (coordination §3.9, slice 9). A plain function so the worker's
 * reporting rollup values the godown without Nest DI; `InventoryService` delegates to the same code.
 */
export { valuationByLocation, type ValuationFilter, type ValuationRow } from './valuation.js'
