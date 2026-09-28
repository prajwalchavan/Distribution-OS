export { InventoryModule } from './inventory.module.js'
export {
  coverFromDock,
  InventoryService,
  pgConstraint,
  type DockBalance,
  type DockClaim,
  type DockCover,
  type DockHoldInput,
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
/**
 * The godown: the one location an order reserves from and is packed out of when it names none (DOS-074).
 * Orders, warehouse and `stock.availability` all use this rule; no module keeps a copy of its own.
 */
export { reservableLocationId } from './reservable-location.js'
/**
 * The dock: where packed goods stand between the rack and the van (QA DOS-195). The warehouse's load-out
 * relieves it when the crew counts the cartons onto the vehicle.
 */
export { dockLocationId } from './reservable-location.js'
/**
 * Where an order may be packed from (QA DOS-352, ruling 2): a godown or a van-sale vehicle, never the damaged
 * bin, the dock or a shop's floor. Orders asks it at draft, at a device upload and at confirm.
 */
export { fulfilPlaceRefusal, type FulfilPlaceRefusal } from './reservable-location.js'
/**
 * The fixed places (vans and trips ruling 5): the godown, the dock and the damaged / expiry bin every distributor
 * is set up with. `damagedBinPlace` finds the bin (a goods receipt puts damaged and expired-on-arrival pieces there)
 * and `placeMissing` is the one 409 a service answers when a distributor has none of one — never a 500.
 */
export { damagedBinPlace, placeMissing, type FixedPlaceKind } from './reservable-location.js'
