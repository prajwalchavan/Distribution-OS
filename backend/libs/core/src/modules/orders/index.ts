export { OrdersModule } from './orders.module.js'
export { OrdersService } from './orders.service.js'
export { ApprovalsService, APPROVAL_REJECTED } from './approvals.service.js'
/**
 * Credit control moved to `modules/receivables` at the receivables slice (coordination §3.1): the rollup
 * table is the source now, not a raw join. Re-exported here so every existing call site is unchanged.
 */
export { checkCredit, outstandingPaise, type CreditVerdict } from '../receivables/index.js'
