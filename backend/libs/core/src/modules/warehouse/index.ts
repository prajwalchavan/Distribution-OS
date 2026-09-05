/**
 * Warehouse's only entry point (`eslint-plugin-boundaries`). What later modules import, and why:
 *
 *   delivery (4)  `LoadSheetsService.confirmedForTrip(tx, tripId)` — read-only "is the load actually
 *                 out of the godown, and what van stock went with it" (coordination §4). Delivery must
 *                 NOT post the godown → vehicle transfer again and must NOT dispatch the orders: both
 *                 happen here at `loadSheets.confirm` (§5 items 4 and 5).
 */
export { WarehouseModule } from './warehouse.module.js'
export { LoadSheetsService, type ConfirmedLoad } from './load-sheets.service.js'
export { PackingService } from './packing.service.js'
export { PicklistsService, type RecordedPick } from './picklists.service.js'
