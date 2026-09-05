export { ProcurementModule } from './procurement.module.js'
export {
  SupplierInvoiceService,
  type CreateInTxInput,
  type SupplierInvoiceForExport,
} from './supplier-invoice.service.js'
export { GrnService, type OpenDiscrepancyFilter, type OpenDiscrepancyRow } from './grn.service.js'
/**
 * The purchase register (coordination §3.9, slice 9): GSTR-2-shaped inward supplies over the supplier
 * invoices that actually landed. A plain function so the worker renders the CSV without Nest DI.
 */
export {
  purchaseRegister,
  type PurchaseRegisterFilter,
  type PurchaseRegisterHsnRow,
  type PurchaseRegisterResult,
  type PurchaseRegisterSupplierRow,
} from './purchase-register.js'
