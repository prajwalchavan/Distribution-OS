/**
 * Billing's only entry point (`eslint-plugin-boundaries`). What later modules import, and why:
 *
 *   warehouse (3)    `BillingService.issueForPack`      — the document at pack, once the pick and the
 *                                                          order state are its own job (coordination §4)
 *   delivery (4)     `BillingService.issueFromLocation` — the van sale from vehicle stock
 *                    `CreditNotesService.raiseForDelivery` — the doorstep short delivery, in one tap
 *   integrations (6) `BillingService.importBrandDms`    — a brand DMS's own bill, stored verbatim
 *                    `BillingService.recordOpeningInvoice` — a bill carried over from the old software
 *                    `RegistersService.salesRegister`   — the Tally sales voucher, same arithmetic
 *   claims (7)       `RegistersService.invoiceLinesForPeriod` / `creditNoteLinesForPeriod` / `schemeSpend`
 *   reporting (9)    `RegistersService.gstSummary` / `salesRegister` / `schemeSpend`
 */
export { BillingModule } from './billing.module.js'
export {
  BillingService,
  EXTERNAL_INVOICE_SERIES,
  INVOICE_SERIES,
  type IssueForPackInput,
  type IssueForPackLine,
  type IssueFromLocationInput,
  type RecordOpeningInvoiceInput,
} from './invoices.service.js'
export {
  CreditNotesService,
  CREDIT_NOTE_SERIES,
  type RaiseForDeliveryInput,
} from './credit-notes.service.js'
export {
  RegistersService,
  type CreditNoteLineForPeriod,
  type InvoiceLineForPeriod,
  type PeriodFilter,
  type SchemeSpendRow,
} from './registers.service.js'
