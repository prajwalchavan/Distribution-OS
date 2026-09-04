import type {
  BalanceSnapshot,
  LedgerEntry,
  Location,
  SellableStockRow,
  StockLot,
} from '@dos/contracts'
import type { locations } from '@dos/db'
import type { BalanceRow, LedgerRow, LotRow } from './inventory.service.js'

/** DB rows -> contract shapes. Nothing here ever carries cost. */

export function toLocation(row: typeof locations.$inferSelect): Location {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    vehicleId: row.vehicleId,
    negativeAllowed: row.negativeAllowed,
    active: row.active,
  }
}

export function toLot(row: LotRow): StockLot {
  return {
    id: row.id,
    variantId: row.variantId,
    batchNo: row.batchNo,
    mrpPaise: row.mrpPaise,
    mfgDate: row.mfgDate,
    expiryDate: row.expiryDate,
  }
}

export function toEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    lotId: row.lotId,
    locationId: row.locationId,
    qtyDelta: row.qtyDelta,
    reason: row.reason,
    refType: row.refType,
    refId: row.refId,
    actorId: row.actorId,
    note: row.note,
  }
}

export function toBalance(row: BalanceRow): BalanceSnapshot {
  return {
    lotId: row.lotId,
    locationId: row.locationId,
    onHand: row.onHand,
    reserved: row.reserved,
    version: row.version,
  }
}

/** Raw row of `sellable_stock` joined to the catalog: int8 arrives as a string, dates as YYYY-MM-DD strings. */
export interface SellableRaw {
  variant_id: string
  location_id: string
  lot_id: string
  batch_no: string
  mrp_paise: string | number
  expiry_date: string | null
  available: string | number
  variant_name: string
  product_name: string
  brand_name: string | null
}

export function toSellable(r: SellableRaw): SellableStockRow {
  return {
    variantId: r.variant_id,
    locationId: r.location_id,
    lotId: r.lot_id,
    batchNo: r.batch_no,
    mrpPaise: Number(r.mrp_paise),
    expiryDate: r.expiry_date,
    available: Number(r.available),
    variantName: r.variant_name,
    productName: r.product_name,
    brandName: r.brand_name,
  }
}
