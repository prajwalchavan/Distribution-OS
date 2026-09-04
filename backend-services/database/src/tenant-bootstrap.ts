import { uuidv7 } from '@dos/domain'
import type { Db } from './client.js'
import { accounts, featureFlags, locations, numberingSeries } from './schema/index.js'

/**
 * Everything a brand-new tenant needs before its first transaction (ADR 0004 chart of accounts, ADR 0003
 * locations, ADR 0001 numbering series). Idempotent: safe to re-run for an existing tenant.
 * Called by the seed and by the tenancy service when a distributor signs up.
 */

/** Indian financial year label for a date, e.g. 2026-09-04 -> "2026-27". */
export function financialYear(date: Date = new Date()): string {
  const y = date.getFullYear()
  const start = date.getMonth() >= 3 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

export const CHART_OF_ACCOUNTS = [
  { code: 'AR', name: 'Sundry Debtors (retailers)', kind: 'asset' },
  { code: 'AP', name: 'Sundry Creditors (suppliers)', kind: 'liability' },
  { code: 'CASH', name: 'Cash in hand', kind: 'asset' },
  { code: 'CASH_VAN', name: 'Cash with delivery crews', kind: 'asset' },
  { code: 'UPI', name: 'UPI clearing', kind: 'asset' },
  { code: 'BANK', name: 'Bank', kind: 'asset' },
  { code: 'CHEQUES', name: 'Cheques in hand', kind: 'asset' },
  { code: 'SALES', name: 'Sales', kind: 'income' },
  { code: 'SALES_RETURNS', name: 'Sales returns', kind: 'income' },
  { code: 'DISCOUNTS', name: 'Discounts allowed', kind: 'expense' },
  { code: 'CASH_DISCOUNT', name: 'Cash discount allowed', kind: 'expense' },
  { code: 'SCHEME_EXPENSE', name: 'Scheme expense (distributor funded)', kind: 'expense' },
  { code: 'SCHEME_RECEIVABLE', name: 'Scheme receivable from manufacturers', kind: 'asset' },
  { code: 'CLAIMS_RECEIVABLE', name: 'Claims receivable (damage/expiry)', kind: 'asset' },
  { code: 'OUTPUT_CGST', name: 'Output CGST', kind: 'liability' },
  { code: 'OUTPUT_SGST', name: 'Output SGST', kind: 'liability' },
  { code: 'OUTPUT_IGST', name: 'Output IGST', kind: 'liability' },
  { code: 'OUTPUT_CESS', name: 'Output cess', kind: 'liability' },
  { code: 'INPUT_CGST', name: 'Input CGST', kind: 'asset' },
  { code: 'INPUT_SGST', name: 'Input SGST', kind: 'asset' },
  { code: 'INPUT_IGST', name: 'Input IGST', kind: 'asset' },
  { code: 'PURCHASES', name: 'Purchases', kind: 'expense' },
  { code: 'STOCK', name: 'Stock in hand', kind: 'asset' },
  { code: 'DAMAGES', name: 'Damages and expiry write-off', kind: 'expense' },
  { code: 'ROUND_OFF', name: 'Round off', kind: 'income' },
  { code: 'BAD_DEBTS', name: 'Bad debts written off', kind: 'expense' },
  { code: 'TRIP_EXPENSES', name: 'Delivery trip expenses', kind: 'expense' },
  { code: 'OPENING', name: 'Opening balance equity', kind: 'equity' },
] as const

export const NUMBERING_SERIES = [
  { seriesCode: 'INV', prefix: 'INV/' },
  { seriesCode: 'CN', prefix: 'CN/' },
  { seriesCode: 'SO', prefix: 'SO-' },
  { seriesCode: 'GRN', prefix: 'GRN-' },
  { seriesCode: 'PO', prefix: 'PO-' },
  { seriesCode: 'RCPT', prefix: 'RCPT-' },
  { seriesCode: 'TRIP', prefix: 'TRIP-' },
  { seriesCode: 'PICK', prefix: 'PICK-' },
  { seriesCode: 'CLAIM', prefix: 'CLM-' },
] as const

export const DEFAULT_FLAGS = [
  { flag: 'van_sales', enabled: false },
  { flag: 'brand_dms_import', enabled: true },
  { flag: 'claims_ui', enabled: false },
  { flag: 'retailer_app', enabled: true },
  { flag: 'e_invoicing', enabled: false },
] as const

export async function bootstrapTenant(
  db: Db,
  tenantId: string,
  now: Date = new Date(),
): Promise<void> {
  const fy = financialYear(now)
  await db
    .insert(accounts)
    .values(
      CHART_OF_ACCOUNTS.map((a) => ({
        id: uuidv7(),
        tenantId,
        code: a.code,
        name: a.name,
        kind: a.kind,
      })),
    )
    .onConflictDoNothing()
  await db
    .insert(locations)
    .values([
      { id: uuidv7(), tenantId, kind: 'warehouse', name: 'Godown' },
      {
        id: uuidv7(),
        tenantId,
        kind: 'damaged',
        name: 'Damaged / expiry bin',
        negativeAllowed: true,
      },
      { id: uuidv7(), tenantId, kind: 'in_transit', name: 'In transit' },
    ])
    .onConflictDoNothing()
  await db
    .insert(numberingSeries)
    .values(
      NUMBERING_SERIES.map((s) => ({ tenantId, seriesCode: s.seriesCode, fy, prefix: s.prefix })),
    )
    .onConflictDoNothing()
  await db
    .insert(featureFlags)
    .values(DEFAULT_FLAGS.map((f) => ({ tenantId, flag: f.flag, enabled: f.enabled })))
    .onConflictDoNothing()
}
