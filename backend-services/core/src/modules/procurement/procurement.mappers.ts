import type {
  Discrepancy,
  Grn,
  GrnLine,
  GrnWithLines,
  PurchaseOrder,
  SupplierInvoice,
  SupplierInvoiceLine,
  SupplierInvoiceWithLines,
} from '@dos/contracts'
import type {
  grnLines,
  grns,
  inboundDiscrepancies,
  purchaseOrders,
  supplierInvoiceLines,
  supplierInvoices,
} from '@dos/db'

export type InvoiceRow = typeof supplierInvoices.$inferSelect
export type InvoiceLineRow = typeof supplierInvoiceLines.$inferSelect
export type GrnRow = typeof grns.$inferSelect
export type GrnLineRow = typeof grnLines.$inferSelect
export type DiscrepancyRow = typeof inboundDiscrepancies.$inferSelect
export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect

const iso = (d: Date | null) => (d ? d.toISOString() : null)

/** Rates live here; only back-office procedures return these shapes. */
export function toInvoice(row: InvoiceRow): SupplierInvoice {
  return {
    id: row.id,
    supplierId: row.supplierId,
    purchaseOrderId: row.purchaseOrderId,
    documentId: row.documentId,
    source: row.source,
    status: row.status,
    invoiceNo: row.invoiceNo,
    invoiceDate: row.invoiceDate,
    irn: row.irn,
    ackNo: row.ackNo,
    ewayBillNo: row.ewayBillNo,
    supplierGstin: row.supplierGstin,
    placeOfSupplyState: row.placeOfSupplyState,
    subtotalPaise: row.subtotalPaise,
    discountPaise: row.discountPaise,
    cgstPaise: row.cgstPaise,
    sgstPaise: row.sgstPaise,
    igstPaise: row.igstPaise,
    cessPaise: row.cessPaise,
    freightPaise: row.freightPaise,
    roundOffPaise: row.roundOffPaise,
    totalPaise: row.totalPaise,
    dueDate: row.dueDate,
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    createdAt: row.createdAt.toISOString(),
  }
}

export function toInvoiceLine(row: InvoiceLineRow): SupplierInvoiceLine {
  return {
    id: row.id,
    lineNo: row.lineNo,
    description: row.description,
    supplierCode: row.supplierCode,
    variantId: row.variantId,
    hsnCode: row.hsnCode,
    batchNo: row.batchNo,
    mfgDate: row.mfgDate,
    expiryDate: row.expiryDate,
    mrpPaise: row.mrpPaise,
    printedQty: row.printedQty,
    printedUnit: row.printedUnit,
    qtyPcs: row.qtyPcs,
    freeQtyPcs: row.freeQtyPcs,
    ratePaise: row.ratePaise,
    discountBps: row.discountBps,
    discountPaise: row.discountPaise,
    gstBps: row.gstBps,
    cessBps: row.cessBps,
    taxablePaise: row.taxablePaise,
    taxPaise: row.taxPaise,
    lineTotalPaise: row.lineTotalPaise,
  }
}

export function toInvoiceWithLines(
  row: InvoiceRow,
  lines: InvoiceLineRow[],
): SupplierInvoiceWithLines {
  return { ...toInvoice(row), lines: lines.map(toInvoiceLine) }
}

/** Pieces only: what the gate sees. */
export function toGrn(row: GrnRow): Grn {
  return {
    id: row.id,
    grnNo: row.grnNo,
    supplierInvoiceId: row.supplierInvoiceId,
    locationId: row.locationId,
    status: row.status,
    countedBy: row.countedBy,
    countedAt: iso(row.countedAt),
    postedBy: row.postedBy,
    postedAt: iso(row.postedAt),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toGrnLine(row: GrnLineRow): GrnLine {
  return {
    id: row.id,
    supplierInvoiceLineId: row.supplierInvoiceLineId,
    variantId: row.variantId,
    lotId: row.lotId,
    expectedQtyPcs: row.expectedQtyPcs,
    countedQtyPcs: row.countedQtyPcs,
    damagedQtyPcs: row.damagedQtyPcs,
  }
}

/** `amount_paise` is deliberately not exposed: a rate could be derived from it, and this table is tenant-wide. */
export function toDiscrepancy(row: DiscrepancyRow): Discrepancy {
  return {
    id: row.id,
    grnId: row.grnId,
    grnLineId: row.grnLineId,
    kind: row.kind,
    qtyPcs: row.qtyPcs,
    status: row.status,
    note: row.note,
    resolvedAt: iso(row.resolvedAt),
    createdAt: row.createdAt.toISOString(),
  }
}

export function toGrnWithLines(
  row: GrnRow,
  lines: GrnLineRow[],
  discrepancies: DiscrepancyRow[],
): GrnWithLines {
  return {
    ...toGrn(row),
    lines: lines.map(toGrnLine),
    discrepancies: discrepancies.map(toDiscrepancy),
  }
}

export function toPurchaseOrder(row: PurchaseOrderRow): PurchaseOrder {
  return {
    id: row.id,
    poNo: row.poNo,
    supplierId: row.supplierId,
    status: row.status,
    expectedOn: row.expectedOn,
    lines: row.lines.map((l) => ({
      variantId: l.variantId,
      qtyPcs: l.qtyPcs,
      ...(l.ratePaise === undefined ? {} : { ratePaise: l.ratePaise }),
    })),
    totalPaise: row.totalPaise,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }
}
