/**
 * Delivery's only entry point (`eslint-plugin-boundaries`). What later modules import, and why:
 *
 *   reporting (9)   `deliveryPerformanceRows(tx, filter)` — the per-trip / per-driver rows the
 *                   `deliveryPerformance` register is built from (coordination §4: reporting →
 *                   delivery `performanceRows`). A plain function, so the worker's rollup sweep can
 *                   call it without Nest DI.
 *   notifications   react to the outbox events (`DeliveryRecorded`, `CollectionRecorded`, …), never
 *                   to these tables.
 */
export { DeliveryModule } from './delivery.module.js'
export { TripsService } from './trips.service.js'
export { DeliveriesService } from './deliveries.service.js'
export { CollectionsService } from './collections.service.js'
export { SettlementService } from './settlement.service.js'
export {
  deliveryPerformanceRows,
  deliveryStopsByDay,
  type DeliveryPerformanceFilter,
  type DeliveryPerformanceRow,
} from './performance.js'
