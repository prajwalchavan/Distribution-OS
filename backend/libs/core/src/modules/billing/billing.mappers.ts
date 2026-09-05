import { asc, eq } from 'drizzle-orm'
import type {
  Address,
  CreditNote,
  CreditNoteDetail,
  CreditNoteLine,
  CreditNoteListItem,
  Invoice,
  InvoiceCreditNoteRef,
  InvoiceDetail,
  InvoiceLine,
  InvoiceListItem,
  SellerBranding,
} from '@dos/contracts'
import type { creditNoteLines, creditNotes, invoiceLines, invoices } from '@dos/db'
import {
  creditNoteLines as cnLines,
  creditNotes as cnTable,
  invoiceLines as ilTable,
} from '@dos/db'
import type { Db } from '@dos/db'

/**
 * Drizzle rows in, contract shapes out (docs/16 §2): no Drizzle row ever leaves this module, and no
 * output shape here carries a purchase cost, a landed cost, a PTD or a margin — an invoice never does,
 * which is exactly why every role including the shopkeeper may read one.
 */

export type InvoiceRow = typeof invoices.$inferSelect
export type InvoiceLineRow = typeof invoiceLines.$inferSelect
export type CreditNoteRow = typeof creditNotes.$inferSelect
export type CreditNoteLineRow = typeof creditNoteLines.$inferSelect

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)
const address = (value: unknown): Address | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Address) : null

export function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    invoiceNo: row.invoiceNo,
    seriesCode: row.seriesCode,
    fy: row.fy,
    invoiceDate: row.invoiceDate,
    orderId: row.orderId,
    retailerId: row.retailerId,
    source: row.source,
    externalInvoiceNo: row.externalInvoiceNo,
    state: row.state,
    supplyType: row.supplyType,
    sellerGstin: row.sellerGstin,
    buyerGstin: row.buyerGstin,
    buyerName: row.buyerName,
    buyerAddress: address(row.buyerAddress),
    placeOfSupplyState: row.placeOfSupplyState,
    buyerFssai: row.buyerFssai,
    sellerFssai: row.sellerFssai,
    isInterState: row.isInterState,
    subtotalPaise: row.subtotalPaise,
    discountPaise: row.discountPaise,
    taxablePaise: row.taxablePaise,
    cgstPaise: row.cgstPaise,
    sgstPaise: row.sgstPaise,
    igstPaise: row.igstPaise,
    cessPaise: row.cessPaise,
    roundOffPaise: row.roundOffPaise,
    totalPaise: row.totalPaise,
    cashDiscountBps: row.cashDiscountBps,
    cashDiscountUntil: row.cashDiscountUntil,
    dueDate: row.dueDate,
    irn: row.irn,
    ackNo: row.ackNo,
    ackDate: iso(row.ackDate),
    signedQr: row.signedQr,
    ewayBillNo: row.ewayBillNo,
    ewayBillValidUntil: iso(row.ewayBillValidUntil),
    transportMode: row.transportMode,
    vehicleNo: row.vehicleNo,
    upiQrPayload: row.upiQrPayload,
    pdfObjectKey: row.pdfObjectKey,
    issuedBy: row.issuedBy,
    issuedAt: iso(row.issuedAt),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toInvoiceLine(row: InvoiceLineRow): InvoiceLine {
  return {
    id: row.id,
    lineNo: row.lineNo,
    orderLineId: row.orderLineId,
    variantId: row.variantId,
    lotId: row.lotId,
    description: row.description,
    hsnCode: row.hsnCode,
    batchNo: row.batchNo,
    expiryDate: row.expiryDate,
    mrpPaise: row.mrpPaise,
    qtyPcs: row.qtyPcs,
    freeQtyPcs: row.freeQtyPcs,
    enteredQty: row.enteredQty,
    enteredUnit: row.enteredUnit,
    packSizeAtEntry: row.packSizeAtEntry,
    caseSize: row.caseSize,
    ratePaise: row.ratePaise,
    discountBps: row.discountBps,
    discountPaise: row.discountPaise,
    taxablePaise: row.taxablePaise,
    gstBps: row.gstBps,
    cgstPaise: row.cgstPaise,
    sgstPaise: row.sgstPaise,
    igstPaise: row.igstPaise,
    cessBps: row.cessBps,
    cessPaise: row.cessPaise,
    lineTotalPaise: row.lineTotalPaise,
    appliedRules: row.appliedRules,
  }
}

export function toInvoiceCreditNoteRef(row: CreditNoteRow): InvoiceCreditNoteRef {
  return {
    id: row.id,
    creditNoteNo: row.creditNoteNo,
    noteDate: row.noteDate,
    reason: row.reason,
    state: row.state,
    totalPaise: row.totalPaise,
  }
}

export function toInvoiceListItem(row: InvoiceRow, amountDuePaise: number): InvoiceListItem {
  return {
    id: row.id,
    invoiceNo: row.invoiceNo,
    externalInvoiceNo: row.externalInvoiceNo,
    seriesCode: row.seriesCode,
    fy: row.fy,
    invoiceDate: row.invoiceDate,
    source: row.source,
    state: row.state,
    orderId: row.orderId,
    retailerId: row.retailerId,
    buyerName: row.buyerName,
    supplyType: row.supplyType,
    taxablePaise: row.taxablePaise,
    cgstPaise: row.cgstPaise,
    sgstPaise: row.sgstPaise,
    igstPaise: row.igstPaise,
    cessPaise: row.cessPaise,
    roundOffPaise: row.roundOffPaise,
    totalPaise: row.totalPaise,
    dueDate: row.dueDate,
    amountDuePaise,
    hasIrn: row.irn !== null,
    hasPdf: row.pdfObjectKey !== null,
  }
}

/**
 * `amountDuePaise` is never derived from billing's own tables: receivables owns allocations, so it is
 * `ReceivablesService.invoiceOutstandingPaise()` and the caller passes it in.
 */
export async function loadInvoiceDetail(
  tx: Db,
  row: InvoiceRow,
  seller: SellerBranding,
  amountDuePaise: number,
): Promise<InvoiceDetail> {
  const lines = await tx
    .select()
    .from(ilTable)
    .where(eq(ilTable.invoiceId, row.id))
    .orderBy(asc(ilTable.lineNo))
  const notes = await tx
    .select()
    .from(cnTable)
    .where(eq(cnTable.invoiceId, row.id))
    .orderBy(asc(cnTable.id))
  return {
    ...toInvoice(row),
    lines: lines.map(toInvoiceLine),
    creditNotes: notes.map(toInvoiceCreditNoteRef),
    amountDuePaise,
    seller,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// credit notes

export function toCreditNote(
  row: CreditNoteRow,
  invoiceNo: string | null,
  isInterState: boolean,
): CreditNote {
  return {
    id: row.id,
    creditNoteNo: row.creditNoteNo,
    seriesCode: row.seriesCode,
    fy: row.fy,
    noteDate: row.noteDate,
    invoiceId: row.invoiceId,
    invoiceNo,
    retailerId: row.retailerId,
    reason: row.reason,
    state: row.state,
    deliveryId: row.deliveryId,
    isInterState,
    taxablePaise: row.taxablePaise,
    cgstPaise: row.cgstPaise,
    sgstPaise: row.sgstPaise,
    igstPaise: row.igstPaise,
    cessPaise: row.cessPaise,
    roundOffPaise: row.roundOffPaise,
    totalPaise: row.totalPaise,
    irn: row.irn,
    pdfObjectKey: row.pdfObjectKey,
    issuedBy: row.issuedBy,
    issuedAt: iso(row.issuedAt),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The item fields live on the INVOICE line; the note stores only quantity, rate and tax. */
export function toCreditNoteLine(
  row: CreditNoteLineRow,
  from: { variantId: string; description: string; hsnCode: string } | undefined,
): CreditNoteLine {
  return {
    id: row.id,
    invoiceLineId: row.invoiceLineId,
    variantId: from?.variantId ?? '',
    description: from?.description ?? '',
    hsnCode: from?.hsnCode ?? '',
    qtyPcs: row.qtyPcs,
    saleable: row.saleable,
    ratePaise: row.ratePaise,
    taxablePaise: row.taxablePaise,
    gstBps: row.gstBps,
    taxPaise: row.taxPaise,
    lineTotalPaise: row.lineTotalPaise,
  }
}

export function toCreditNoteListItem(
  row: CreditNoteRow,
  invoiceNo: string | null,
): CreditNoteListItem {
  return {
    id: row.id,
    creditNoteNo: row.creditNoteNo,
    noteDate: row.noteDate,
    invoiceId: row.invoiceId,
    invoiceNo,
    retailerId: row.retailerId,
    reason: row.reason,
    state: row.state,
    taxablePaise: row.taxablePaise,
    cgstPaise: row.cgstPaise,
    sgstPaise: row.sgstPaise,
    igstPaise: row.igstPaise,
    cessPaise: row.cessPaise,
    totalPaise: row.totalPaise,
  }
}

export async function loadCreditNoteDetail(
  tx: Db,
  row: CreditNoteRow,
  invoice: { invoiceNo: string | null; isInterState: boolean },
  seller: SellerBranding,
): Promise<CreditNoteDetail> {
  const lines = await tx
    .select()
    .from(cnLines)
    .where(eq(cnLines.creditNoteId, row.id))
    .orderBy(asc(cnLines.id))
  const invoiceLineRows = await tx
    .select({
      id: ilTable.id,
      variantId: ilTable.variantId,
      description: ilTable.description,
      hsnCode: ilTable.hsnCode,
    })
    .from(ilTable)
    .where(eq(ilTable.invoiceId, row.invoiceId))
  const byId = new Map(invoiceLineRows.map((l) => [l.id, l]))
  return {
    ...toCreditNote(row, invoice.invoiceNo, invoice.isInterState),
    lines: lines.map((l) => toCreditNoteLine(l, byId.get(l.invoiceLineId))),
    seller,
  }
}
