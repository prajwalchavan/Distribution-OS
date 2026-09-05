/**
 * Billing's only entry point (`eslint-plugin-boundaries`). What later modules import, and why:
 *
 *   warehouse (3)    `BillingService.issueForPack`      — the document at pack, once the pick and the
 *                                                          order state are its own job (coordination §4)
 *                    `BillingService.invoiceRefs`       — the number and sale total a pack list and a
 *                                                          load sheet print beside an order
 *                    `sellerBranding`                   — the white-label block on the Rule 55 challan
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
  type InvoiceRef,
  type IssueForPackInput,
  type IssueForPackLine,
  type IssueFromLocationInput,
  type RecordOpeningInvoiceInput,
} from './invoices.service.js'
/**
 * The WHITE-LABEL seller block every printed document carries (docs/17 §D6). Exported because the
 * warehouse's Rule 55 delivery challan is such a document and must print the DISTRIBUTOR's own name,
 * exactly the block the invoice prints — one loader, one `tenant_settings` convention, one place to fix
 * when a distributor uploads a logo. Duplicating it in warehouse is how the two documents drift apart.
 */
export { loadSeller as sellerBranding } from './billing.internals.js'
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
