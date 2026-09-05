import { sql } from 'drizzle-orm'
import type { Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * The GSTR-2-shaped purchase register (coordination §3.9: "9 reporting → `modules/procurement`
 * `SupplierInvoiceService.purchaseRegister`"). Procurement owns `supplier_invoices` /
 * `supplier_invoice_lines`, so the inward-supply arithmetic lives here exactly once, the way the
 * outward-supply arithmetic lives once in billing's `RegistersService.gstSummary` — reporting wraps
 * both and re-derives neither.
 *
 * ONLY `status = 'received'` counts. An `extracted`, `in_review`, `approved`, `disputed` or `cancelled`
 * supplier invoice is not yet (or no longer) a liability, and a filing must show what actually landed
 * (docs/plans/reporting.md §2).
 *
 * The line carries `tax_paise` as one number; the CGST/SGST/IGST split is the header's. A header with
 * any IGST is an inter-state purchase, so every line of it is IGST; otherwise the line's GST splits in
 * half — the same rule billing applies to credit-note lines.
 */

export interface PurchaseRegisterFilter {
  /** IST business dates on `supplier_invoices.invoice_date`, inclusive. */
  from: string
  to: string
  supplierId?: string | undefined
  limit?: number | undefined
}

export interface PurchaseRegisterHsnRow {
  hsnCode: string | null
  gstBps: number
  cessBps: number
  qtyPcs: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  totalPaise: number
  invoiceCount: number
}

export interface PurchaseRegisterSupplierRow {
  supplierId: string
  supplierName: string
  supplierGstin: string | null
  invoiceCount: number
  taxablePaise: number
  totalPaise: number
}

export interface PurchaseRegisterResult {
  rows: PurchaseRegisterHsnRow[]
  supplierRows: PurchaseRegisterSupplierRow[]
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
/** `String()` on a value the driver typed `unknown`; keeps the narrowing out of the call site. */
const text = (v: unknown): string => String(v)

export async function purchaseRegister(
  tx: Db,
  filter: PurchaseRegisterFilter,
): Promise<PurchaseRegisterResult> {
  const { tenantId } = currentTenant()
  const limit = Math.min(filter.limit ?? 500, 2_000)
  const supplierFilter = filter.supplierId ?? null
  const hsn = await tx.execute(sql`
    select sl.hsn_code, sl.gst_bps, sl.cess_bps,
           coalesce(sum(sl.qty_pcs), 0)::bigint       as qty_pcs,
           coalesce(sum(sl.taxable_paise), 0)::bigint as taxable_paise,
           coalesce(sum(case when si.igst_paise > 0 then 0
                             else round(sl.taxable_paise::numeric * sl.gst_bps / 20000) end), 0)::bigint as cgst_paise,
           coalesce(sum(case when si.igst_paise > 0 then 0
                             else round(sl.taxable_paise::numeric * sl.gst_bps / 20000) end), 0)::bigint as sgst_paise,
           coalesce(sum(case when si.igst_paise > 0
                             then round(sl.taxable_paise::numeric * sl.gst_bps / 10000) else 0 end), 0)::bigint as igst_paise,
           coalesce(sum(round(sl.taxable_paise::numeric * sl.cess_bps / 10000)), 0)::bigint as cess_paise,
           coalesce(sum(sl.line_total_paise), 0)::bigint as total_paise,
           count(distinct sl.supplier_invoice_id)::int   as invoice_count
      from supplier_invoice_lines sl
      join supplier_invoices si on si.id = sl.supplier_invoice_id and si.tenant_id = sl.tenant_id
     where sl.tenant_id = ${tenantId}
       and si.status = 'received'
       and si.invoice_date between ${filter.from} and ${filter.to}
       and (${supplierFilter}::text is null or si.supplier_id = ${supplierFilter})
     group by sl.hsn_code, sl.gst_bps, sl.cess_bps
     order by sl.hsn_code asc nulls last, sl.gst_bps asc, sl.cess_bps asc
     limit ${limit}`)
  const bySupplier = await tx.execute(sql`
    select si.supplier_id, s.name as supplier_name, s.gstin as supplier_gstin,
           count(*)::int                                as invoice_count,
           coalesce(sum(si.subtotal_paise - si.discount_paise), 0)::bigint as taxable_paise,
           coalesce(sum(si.total_paise), 0)::bigint      as total_paise
      from supplier_invoices si
      join suppliers s on s.id = si.supplier_id and s.tenant_id = si.tenant_id
     where si.tenant_id = ${tenantId}
       and si.status = 'received'
       and si.invoice_date between ${filter.from} and ${filter.to}
       and (${supplierFilter}::text is null or si.supplier_id = ${supplierFilter})
     group by si.supplier_id, s.name, s.gstin
     order by coalesce(sum(si.total_paise), 0) desc, s.name asc
     limit ${limit}`)
  return {
    rows: hsn.rows.map((row: Record<string, unknown>) => ({
      hsnCode: row.hsn_code === null ? null : text(row.hsn_code),
      gstBps: n(row.gst_bps),
      cessBps: n(row.cess_bps),
      qtyPcs: n(row.qty_pcs),
      taxablePaise: n(row.taxable_paise),
      cgstPaise: n(row.cgst_paise),
      sgstPaise: n(row.sgst_paise),
      igstPaise: n(row.igst_paise),
      cessPaise: n(row.cess_paise),
      totalPaise: n(row.total_paise),
      invoiceCount: n(row.invoice_count),
    })),
    supplierRows: bySupplier.rows.map((row: Record<string, unknown>) => ({
      supplierId: String(row.supplier_id),
      supplierName: String(row.supplier_name),
      supplierGstin: row.supplier_gstin === null ? null : text(row.supplier_gstin),
      invoiceCount: n(row.invoice_count),
      taxablePaise: n(row.taxable_paise),
      totalPaise: n(row.total_paise),
    })),
  }
}
