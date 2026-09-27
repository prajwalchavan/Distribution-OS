/**
 * A CANCELLED BILL LEAVES NO STOCK BEHIND (QA DOS-257).
 *
 * Cancelling a bill undoes what the bill did to stock, and nothing else. Per lot, the rows the bill wrote
 * under its own ref (`ref_type = 'invoice'`: a van sale's `sale` out of the vehicle, an old-model seed bill)
 * plus the rows its cancel wrote (`ref_type = 'invoice_cancel'`) sum to ZERO:
 *
 *   a pack bill        the pack moved rack → dock under `ref_type = 'pack'`; the cancel moves dock → rack
 *                      (`billOffDock`, a `transfer_out` / `transfer_in` pair): 0 + 0;
 *   a van sale         `sale` −q out of the vehicle, the cancel +q back: −q + q;
 *   the seed's bills   `sale` −72 at the godown, `adjustment` +72 back (INV/9002, SAI/9002, KA/9002): 0.
 *
 * What broke it was the pre-DOS-251 cancel: when the dock no longer held a pack bill's pieces (another sheet
 * had loaded them) it wrote the plain `adjustment` +12 into the godown — INV/9034's toor, 12 pieces that
 * existed nowhere, sellable and valued at cost for a week. DOS-251 stopped the code writing it; migration
 * 0071 makes the database refuse it at commit (`dos_invoice_cancel_leaves_nothing`); this module is the
 * RELEASE CHECK for the rows written before either existed: `pnpm check:stock-cancels` lists them, and the
 * seed specs assert the demo data carries none.
 *
 * A footprint is `open` until somebody took the pieces off again: a later manual row (`adjustment`,
 * `damage`, `expiry_writeoff`, `cycle_count` — the stock screen's write-off or a count) on the SAME lot at
 * the SAME location, negative, adding up to at least the footprint. That match is by place and time, not by
 * a link — the stock screen does not know which cancel it corrects — so the report names the rows it counted
 * and a human reads them; the note on the write-off ("INV/9034 phantom") is what makes that easy.
 */
import { sql } from 'drizzle-orm'
import { withSystem, type Db } from './client.js'

/** One (cancelled bill, lot) whose rows do not net to zero. */
export interface CancelFootprint {
  tenantId: string
  tenantSlug: string
  invoiceId: string
  invoiceNo: string | null
  lotId: string
  batchNo: string
  variantName: string
  /** Where the cancel put the pieces (its first positive row); null when it put nothing anywhere. */
  locationId: string | null
  locationName: string | null
  /** Σ of the bill's `invoice` rows and its `invoice_cancel` rows for this lot: > 0 invented, < 0 lost. */
  footprintPcs: number
  /** Pieces taken off that lot at that location by hand after the cancel (see the header). */
  writtenOffPcs: number
  /** The ledger rows of the cancel that made the footprint. */
  cancelRowIds: string[]
  /** The manual rows counted in `writtenOffPcs`. */
  writeOffRowIds: string[]
  status: 'open' | 'written_off'
}

interface Row {
  tenant_id: string
  tenant_slug: string
  invoice_id: string
  invoice_no: string | null
  lot_id: string
  batch_no: string
  variant_name: string
  location_id: string | null
  location_name: string | null
  footprint: number
  written_off: number
  cancel_rows: string[]
  write_off_rows: string[] | null
}

/**
 * Every (cancelled bill, lot) whose stock does not net to zero, across all tenants or one. Read as the
 * system role (`withSystem`): a release check must see every tenant's ledger whatever role the URL holds.
 */
export async function invoiceCancelFootprints(
  db: Db,
  tenantId?: string,
): Promise<CancelFootprint[]> {
  const scope = tenantId === undefined ? sql`true` : sql`c.tenant_id = ${tenantId}`
  const rows = await withSystem(db, async (tx) => {
    const res = await tx.execute(sql`
      WITH cancels AS (
        SELECT c.tenant_id, c.ref_id AS invoice_id, c.lot_id,
               min(c.created_at) AS cancelled_at,
               array_agg(c.id ORDER BY c.created_at, c.id) AS cancel_rows,
               (array_agg(c.location_id ORDER BY c.created_at, c.id) FILTER (WHERE c.qty_delta > 0))[1] AS location_id
          FROM stock_ledger c
         WHERE c.ref_type = 'invoice_cancel' AND c.ref_id IS NOT NULL AND ${scope}
         GROUP BY c.tenant_id, c.ref_id, c.lot_id),
      footprints AS (
        SELECT k.*,
               (SELECT coalesce(sum(s.qty_delta), 0)::int FROM stock_ledger s
                 WHERE s.tenant_id = k.tenant_id AND s.lot_id = k.lot_id AND s.ref_id = k.invoice_id
                   AND s.ref_type IN ('invoice', 'invoice_cancel')) AS footprint
          FROM cancels k)
      SELECT f.tenant_id, t.slug AS tenant_slug, f.invoice_id, i.invoice_no, f.lot_id,
             sl.batch_no, v.name AS variant_name, f.location_id, loc.name AS location_name,
             f.footprint, f.cancel_rows,
             coalesce(w.pcs, 0)::int AS written_off, w.ids AS write_off_rows
        FROM footprints f
        JOIN tenants t ON t.id = f.tenant_id
        JOIN stock_lots sl ON sl.id = f.lot_id
        JOIN product_variants v ON v.id = sl.variant_id
        LEFT JOIN invoices i ON i.id = f.invoice_id AND i.tenant_id = f.tenant_id
        LEFT JOIN locations loc ON loc.id = f.location_id
        LEFT JOIN LATERAL (
          SELECT -sum(m.qty_delta)::int AS pcs, array_agg(m.id ORDER BY m.created_at, m.id) AS ids
            FROM stock_ledger m
           WHERE m.tenant_id = f.tenant_id AND m.lot_id = f.lot_id AND m.location_id = f.location_id
             AND m.qty_delta < 0 AND m.created_at > f.cancelled_at
             AND m.reason IN ('adjustment', 'damage', 'expiry_writeoff', 'cycle_count')
             AND m.ref_type IS DISTINCT FROM 'invoice_cancel') w ON f.footprint > 0
       WHERE f.footprint <> 0
       ORDER BY t.slug, i.invoice_no, sl.batch_no, f.lot_id`)
    return res.rows as unknown as Row[]
  })
  return rows.map((r) => {
    const footprintPcs = Number(r.footprint)
    const writtenOffPcs = Number(r.written_off)
    return {
      tenantId: r.tenant_id,
      tenantSlug: r.tenant_slug,
      invoiceId: r.invoice_id,
      invoiceNo: r.invoice_no,
      lotId: r.lot_id,
      batchNo: r.batch_no,
      variantName: r.variant_name,
      locationId: r.location_id,
      locationName: r.location_name,
      footprintPcs,
      writtenOffPcs,
      cancelRowIds: r.cancel_rows,
      writeOffRowIds: r.write_off_rows ?? [],
      status: footprintPcs > 0 && writtenOffPcs >= footprintPcs ? 'written_off' : 'open',
    }
  })
}

/** The open footprints as sentences, for a spec to assert empty (the `dispatchStockFaults` style). */
export async function cancelFootprintFaults(db: Db, tenantId?: string): Promise<string[]> {
  const open = (await invoiceCancelFootprints(db, tenantId)).filter((f) => f.status === 'open')
  return open.map((f) =>
    f.footprintPcs > 0
      ? `${f.tenantSlug}: cancelling ${f.invoiceNo ?? f.invoiceId} left ${String(f.footprintPcs)} pc of ${f.variantName} (batch ${f.batchNo}) at ${f.locationName ?? 'no location'} that the bill never took out; ${String(f.writtenOffPcs)} written off since (rows ${f.cancelRowIds.join(', ')})`
      : `${f.tenantSlug}: cancelling ${f.invoiceNo ?? f.invoiceId} put back ${String(-f.footprintPcs)} pc of ${f.variantName} (batch ${f.batchNo}) fewer than the bill took out (rows ${f.cancelRowIds.join(', ')})`,
  )
}
