/**
 * The distributor's SELL rate per SKU, shared by the price lists (pricing.ts) and the cost book
 * (tenant-catalog.ts) so the two can never disagree on what a piece sells for.
 *
 * The retailer's margin — MRP against the price the shop pays, GST included — is the category's,
 * not one number for the whole shelf (2026-09-08 review: a flat 86 % of ex-tax MRP showed through as
 * exactly 15.0 % in eight of nine categories). Staples run thin, biscuits and dairy in the middle,
 * soft drinks and toiletries fat; and within a category each SKU sits a point or so either side,
 * the way a real price list does.
 */
import { hashMod } from './util.js'

/** The distributor's sell rate as a share of the ex-tax MRP, by category. */
const SELL_SHARE_BY_CATEGORY: Readonly<Record<string, number>> = {
  Beverages: 0.8, // retailer keeps ~20 % on a cold drink
  Biscuits: 0.89, // ~11 %
  'Snacks - Chips': 0.86, // ~14 %
  'Snacks - Namkeen': 0.87, // ~13 %
  'Snacks - Makhana': 0.85, // ~15 %
  'Packaged Food': 0.935, // atta, rice, dal, oil: 5-8 %
  Dairy: 0.91, // ~9 %
  'Personal Care': 0.82, // ~18 %
  Household: 0.84, // ~16 %
}

/** Ex-tax MRP of a piece. */
export function exTaxMrp(mrpPaise: number, gstBps: number, cessBps: number): number {
  return mrpPaise / (1 + (gstBps + cessBps) / 10_000)
}

/**
 * The default (ex-tax) sell rate of a SKU: its category's share of the ex-tax MRP, nudged by up to a
 * point either way per SKU (deterministic in the key), rounded to the paisa.
 */
export function sellRatePaise(v: {
  key: string
  category: string
  mrpPaise: number
  gstBps: number
  cessBps: number
}): number {
  const share = SELL_SHARE_BY_CATEGORY[v.category] ?? 0.86
  const nudge = (hashMod(`sell:${v.key}`, 21) - 10) / 1000 // −0.010 … +0.010
  return Math.round(exTaxMrp(v.mrpPaise, v.gstBps, v.cessBps) * (share + nudge))
}
