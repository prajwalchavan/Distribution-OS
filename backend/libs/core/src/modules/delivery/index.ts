/**
 * Delivery's only entry point (`eslint-plugin-boundaries`). What later modules import, and why:
 *
 *   reporting (9)   `deliveryPerformanceRows(tx, filter)` — the per-trip / per-driver rows the
 *                   `deliveryPerformance` register is built from (coordination §4: reporting →
 *                   delivery `performanceRows`). A plain function, so the worker's rollup sweep can
 *                   call it without Nest DI.
 *   notifications   react to the outbox events (`DeliveryRecorded`, `CollectionRecorded`, …), never
 *                   to these tables.
 *   ai (12)         `TripsService.tripForRouting` / `tripForReading` / `routingStops` /
 *                   `reorderStopsInTx` / `stopsOfTrip` — the route optimiser reads a trip's stops
 *                   and their shop pins here, and writes a computed sequence back through the SAME
 *                   `reorderStopsInTx` the crew's own drag-and-drop uses. `trip_stops` is delivery's
 *                   table and nothing outside this module ever writes it (coordination §4).
 */
export { DeliveryModule } from './delivery.module.js'
/**
 *   receivables (8)  `TRIP_PREDICATES` — the three `exists (select 1 from trips …)` fragments receivables
 *                    embeds to decide whether money may name a trip (DOS-132, QA DOS-175). `DeliveryModule`
 *                    registers them itself; the export is for a spec that boots receivables without delivery.
 */
export { TRIP_PREDICATES } from './delivery.internals.js'
export { TripsService, type RoutingStop } from './trips.service.js'
export { DeliveriesService } from './deliveries.service.js'
export { CollectionsService } from './collections.service.js'
export { SettlementService } from './settlement.service.js'
export {
  deliveryPerformanceRows,
  deliveryStopsByDay,
  type DeliveryPerformanceFilter,
  type DeliveryPerformanceRow,
} from './performance.js'
