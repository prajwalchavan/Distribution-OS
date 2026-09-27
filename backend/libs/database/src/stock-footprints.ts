/**
 * A CANCELLED BILL LEAVES NO STOCK BEHIND (QA DOS-257).
 *
 * Cancelling a bill undoes what the bill did to stock, and nothing else. Per lot, what the bill (and, for a
 * pack bill, its order's pack) took out plus what its cancel put back nets to ZERO:
 *
 *   a pack bill        the pack moved rack → dock under the ORDER's `ref_type = 'pack'` (0); the cancel moves
 *                      dock → rack (`billOffDock`, a `transfer_out` / `transfer_in` pair): 0 + 0. Under the
 *                      model before DOS-195 the pack was a `sale` −q and the cancel an `adjustment` +q: 0;
 *   a van sale         `sale` −q out of the vehicle under the bill's own `ref_type = 'invoice'`, the cancel +q;
 *   the seed's bills   `sale` −72 at the godown, `adjustment` +72 back (INV/9002, SAI/9002, KA/9002): 0.
 *
 * What broke it was the pre-DOS-251 cancel: when the dock no longer held a pack bill's pieces (another sheet
 * had loaded them) it wrote the plain `adjustment` +12 into the godown — INV/9034's toor, 12 pieces that
 * existed nowhere. The definition lives in ONE place, the SQL function `dos_invoice_cancel_footprints()`
 * (migration 0071), which the migration's write-off (`dos_write_off_invoice_cancel_phantoms()`) and this
 * release check both read, so they can never disagree about what is invented. 0071 writes such pieces off
 * (`ref_type = 'invoice_cancel_writeoff'`, which counts in the footprint, so a written-off bill nets to zero
 * and is no longer listed) and refuses a new one at commit.
 *
 * What this can still list: a footprint whose pieces had already moved on from where the cancel put them
 * (the write-off only takes what is still standing there), or a cancel that put back FEWER than the bill
 * took (< 0). `written_off` means a hand write-off or count on that lot at that place since the cancel has
 * taken at least the footprint off; `open` means somebody has to look.
 */
import { sql } from 'drizzle-orm'
import { withSystem, type Db } from './client.js'

/** One (cancelled bill — or a pack bill's order —, lot) whose rows do not net to zero. */
export interface CancelFootprint {
  tenantId: string
  tenantSlug: string
  /** The bill whose cancel put the invented pieces somewhere; the first bill of the group otherwise. */
  invoiceId: string
  invoiceNo: string | null
  /** Every cancelled bill accounted in this footprint (a pack bill's order may have had more than one). */
  invoiceIds: string[]
  lotId: string
  batchNo: string
  variantName: string
  /** Where the cancel's `adjustment` put the pieces; null when it put none anywhere. */
  locationId: string | null
  locationName: string | null
  /** > 0 invented, < 0 lost. */
  footprintPcs: number
  /** Pieces taken off that lot at that place by hand (write-off, damage, expiry, count) since the cancel. */
  writtenOffPcs: number
  /** The ledger rows of the cancel(s) that made the footprint. */
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
  invoice_ids: string[]
  lot_id: string
  batch_no: string
  variant_name: string
  location_id: string | null
  location_name: string | null
  footprint: number | string
  taken_off: number | string
  cancel_rows: string[] | null
  taken_off_rows: string[] | null
}

/**
 * Every cancelled bill whose stock does not net to zero, across all tenants or one. Read as the system role
 * (`withSystem`): a release check must see every tenant's ledger whatever role the URL holds.
 */
export async function invoiceCancelFootprints(
  db: Db,
  tenantId?: string,
): Promise<CancelFootprint[]> {
  const rows = await withSystem(db, async (tx) => {
    const res = await tx.execute(sql`
      SELECT f.tenant_id, t.slug AS tenant_slug,
             coalesce(f.adjust_invoice_id, f.invoice_ids[1]) AS invoice_id, i.invoice_no, f.invoice_ids,
             f.lot_id, sl.batch_no, v.name AS variant_name,
             f.adjust_location_id AS location_id, loc.name AS location_name,
             f.footprint_pcs AS footprint, f.taken_off_pcs AS taken_off,
             f.cancel_row_ids AS cancel_rows, f.taken_off_row_ids AS taken_off_rows
        FROM dos_invoice_cancel_footprints(${tenantId ?? null}::text) f
        JOIN tenants t ON t.id = f.tenant_id
        JOIN stock_lots sl ON sl.id = f.lot_id
        JOIN product_variants v ON v.id = sl.variant_id
        LEFT JOIN invoices i
          ON i.tenant_id = f.tenant_id AND i.id = coalesce(f.adjust_invoice_id, f.invoice_ids[1])
        LEFT JOIN locations loc ON loc.id = f.adjust_location_id
       ORDER BY t.slug, i.invoice_no, sl.batch_no, f.lot_id`)
    return res.rows as unknown as Row[]
  })
  return rows.map((r) => {
    const footprintPcs = Number(r.footprint)
    const writtenOffPcs = footprintPcs > 0 ? Number(r.taken_off) : 0
    return {
      tenantId: r.tenant_id,
      tenantSlug: r.tenant_slug,
      invoiceId: r.invoice_id,
      invoiceNo: r.invoice_no,
      invoiceIds: r.invoice_ids,
      lotId: r.lot_id,
      batchNo: r.batch_no,
      variantName: r.variant_name,
      locationId: r.location_id,
      locationName: r.location_name,
      footprintPcs,
      writtenOffPcs,
      cancelRowIds: r.cancel_rows ?? [],
      writeOffRowIds: footprintPcs > 0 ? (r.taken_off_rows ?? []) : [],
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

/** One row the write-off wrote (or looked at and could not: `writtenPcs` 0). */
export interface CancelPhantomWriteOff {
  tenantId: string
  invoiceId: string
  invoiceNo: string
  lotId: string
  locationId: string
  footprintPcs: number
  takenOffPcs: number
  onHandPcs: number
  writtenPcs: number
  ledgerRowId: string | null
}

/**
 * Runs the write-off migration 0071 ran (`dos_write_off_invoice_cancel_phantoms`), for a database where a
 * phantom appeared after it — which the trigger makes impossible for the app, so in practice a restored
 * dump or a hand-written row. Idempotent: a written-off bill nets to zero and is not looked at again. Runs as
 * the connection's own role, which must bypass row level security (the migration / seed owner): it moves
 * every tenant's books.
 */
export async function writeOffInvoiceCancelPhantoms(
  db: Db,
  tenantId?: string,
): Promise<CancelPhantomWriteOff[]> {
  const res = await db.execute(sql`
    SELECT * FROM dos_write_off_invoice_cancel_phantoms(${tenantId ?? null}::text)`)
  const rows = res.rows as unknown as {
    tenant_id: string
    invoice_id: string
    invoice_no: string
    lot_id: string
    location_id: string
    footprint_pcs: number | string
    taken_off_pcs: number | string
    on_hand_pcs: number | string
    written_pcs: number | string
    ledger_row_id: string | null
  }[]
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    invoiceId: r.invoice_id,
    invoiceNo: r.invoice_no,
    lotId: r.lot_id,
    locationId: r.location_id,
    footprintPcs: Number(r.footprint_pcs),
    takenOffPcs: Number(r.taken_off_pcs),
    onHandPcs: Number(r.on_hand_pcs),
    writtenPcs: Number(r.written_pcs),
    ledgerRowId: r.ledger_row_id,
  }))
}
