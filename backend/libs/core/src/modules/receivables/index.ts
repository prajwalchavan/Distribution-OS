export { ReceivablesModule } from './receivables.module.js'
export {
  ReceivablesService,
  type CreditNoteForPosting,
  type InvoiceForPosting,
  type RecordReceiptInput,
  type RecordReceiptResult,
} from './receivables.service.js'
/** Moved here from `modules/orders/credit.ts` (docs/plans/00-coordination.md §3.1); orders re-exports it. */
export {
  checkCredit,
  loadRetailerCredit,
  outstandingPaise,
  type CreditVerdict,
  type RetailerCredit,
} from './credit.js'
/** The open balance of one bill, as a plain function for the document loaders (billing's renderer data). */
export { invoiceOpenPaise } from './allocation.js'
export { loadReceiptDocument, type ReceiptDocument } from './documents.js'
