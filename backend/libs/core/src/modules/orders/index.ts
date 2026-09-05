export { OrdersModule } from './orders.module.js'
export { OrdersService } from './orders.service.js'
export { ApprovalsService, APPROVAL_REJECTED } from './approvals.service.js'
/**
 * Credit control moved to `modules/receivables` at the receivables slice (coordination §3.1): the rollup
 * table is the source now, not a raw join. Re-exported here so every existing call site is unchanged.
 */
export { checkCredit, outstandingPaise, type CreditVerdict } from '../receivables/index.js'
/**
 * The fulfilment surface warehouse works through (coordination §3.9 and §4): `OrdersService`'s
 * `fulfilmentQueue`, `fulfilmentLines`, `applyFulfilmentEvent` and `recordPick` return and accept these.
 * Types only — the queries themselves stay behind the service, so nothing outside this module can run one.
 */
/**
 * Fill rate (coordination §3.9, slice 9): pieces ordered against pieces picked. Plain functions, so the
 * worker's reporting rollup imports them without Nest DI; `OrdersService` delegates to the same code.
 */
export {
  fillRateByDay,
  fillRateLines,
  type FillRateFilter,
  type FillRateLineRow,
} from './fill-rate.js'
/**
 * What one rep or crew member sold in a window (coordination §3.9, slice 10): value, pieces, lines
 * and distinct outlets off the order book. A plain function, so the incentives achievement sweep in
 * the worker imports it without Nest DI.
 */
export {
  salesAggregate,
  type SalesAggregateFilter,
  type SalesAggregateMetric,
  type SalesAggregateRow,
} from './sales-aggregate.js'
export type {
  DeliveredLine,
  FulfilmentEvent,
  FulfilmentLine,
  FulfilmentOrder,
  FulfilmentQueueFilter,
  PickedLine,
} from './fulfilment.js'
