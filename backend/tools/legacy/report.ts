import type { BakData, DerivedBills } from './bak-data.js'
import type { Plan } from './plan.js'
import { ageDays } from './plan.js'
import type { BillReconciliation } from './reconcile.js'
import type { SalesGstFacts } from './sales-gst.js'
import type { Issue, IssueKind } from './types.js'
import type { WriteResult } from './writer.js'

/**
 * The importer's report: COUNTS, MAPPINGS and rules only.
 *
 * It is written so it can be pasted into a chat or committed without leaking the distributor's customers:
 * there is no name, no phone number, no GSTIN, no address, no bill number and no item code in it — an issue
 * is a kind and a count, and its `ref`s (a sheet and a row number) are printed only to the operator's
 * terminal by `formatIssueRefs`, never stored in the JSON.
 */

export interface Sources {
  products: { rows: number; parsed: number }
  outstanding: {
    /** Where the opening bills come from: the report the founder handed over, or the backup's ledger. */
    source: 'sheet' | 'backup'
    rows: number
    parsed: number
    /** The report checked against the backup's own ledger for the report's last day (when both are given). */
    reconciliation: BillReconciliation | null
    /** The rebuild's own counts when the bills come from the backup. */
    rebuilt: DerivedBills['facts'] | null
  }
  customers: { parsed: number }
  salesGst: { rows: number; facts: SalesGstFacts } | null
  backup: BakData['facts'] | null
  backupUnsupported: number
}

export interface ImportReport {
  mode: 'dry-run' | 'commit'
  asOf: string
  sources: Sources
  plan: {
    manufacturers: number
    items: {
      planned: number
      listed: number
      unlisted: number
      unpriced: number
      byUnit: Record<string, number>
      hsnAssumed: number
      hsnHeadings: number
      gstRatesBps: number[]
      withCost: number
      withOpeningStock: number
      openingStockUnits: number
    }
    beats: number
    retailers: {
      planned: number
      withPhone: number
      withoutPhone: number
      withGstin: number
      withAltPhone: number
      withOwnerName: number
      byState: Record<string, number>
    }
    bills: {
      planned: number
      customersWithDues: number
      openPaise: number
      originalPaise: number
      receivedPaise: number
      partlyReceived: number
      ageingPaise: Record<string, number>
    }
  }
  issues: Record<string, number>
  written: WriteResult['steps'] | null
  notes: WriteResult['notes'] | null
  reconciliation: { plannedOpenPaise: number; inLedgerPaise: number; equal: boolean } | null
  failures: number
}

const bucket = (days: number): string =>
  days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'

export function countIssues(issues: readonly Issue[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of issues) out[i.kind] = (out[i.kind] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

export function buildReport(input: {
  mode: ImportReport['mode']
  asOf: string
  plan: Plan
  parseIssues: readonly Issue[]
  sources: Sources
  written?: WriteResult | null
}): ImportReport {
  const { plan, asOf } = input
  const issues = countIssues([...input.parseIssues, ...plan.issues])
  const byUnit: Record<string, number> = {}
  for (const i of plan.items) byUnit[i.unitKind] = (byUnit[i.unitKind] ?? 0) + 1
  const byState: Record<string, number> = {}
  for (const r of plan.retailers) byState[r.stateCode] = (byState[r.stateCode] ?? 0) + 1
  const ageing: Record<string, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
  for (const b of plan.bills) {
    const k = bucket(ageDays(b, asOf))
    ageing[k] = (ageing[k] ?? 0) + b.openPaise
  }
  const openPaise = plan.bills.reduce((s, b) => s + b.openPaise, 0)
  const written = input.written ?? null
  return {
    mode: input.mode,
    asOf,
    sources: input.sources,
    plan: {
      manufacturers: plan.manufacturers.length,
      items: {
        planned: plan.items.length,
        listed: plan.items.filter((i) => i.listed).length,
        unlisted: plan.items.filter((i) => !i.listed).length,
        unpriced: plan.items.filter((i) => i.salePaise === null).length,
        byUnit,
        hsnAssumed: plan.items.filter((i) => i.hsnAssumed).length,
        hsnHeadings: plan.hsnRates.length,
        gstRatesBps: [...new Set(plan.hsnRates.map((r) => r.gstBps))].sort((a, b) => a - b),
        withCost: plan.items.filter((i) => i.purchaseRatePaise !== null).length,
        withOpeningStock: plan.items.filter((i) => (i.openingQty ?? 0) > 0).length,
        openingStockUnits: plan.items.reduce((s, i) => s + (i.openingQty ?? 0), 0),
      },
      beats: plan.beats.length,
      retailers: {
        planned: plan.retailers.length,
        withPhone: plan.retailers.filter((r) => r.phone !== '').length,
        withoutPhone: plan.retailers.filter((r) => r.phone === '').length,
        withGstin: plan.retailers.filter((r) => r.gstin !== null).length,
        withAltPhone: plan.retailers.filter((r) => r.altPhone !== null).length,
        withOwnerName: plan.retailers.filter((r) => r.ownerName !== null).length,
        byState,
      },
      bills: {
        planned: plan.bills.length,
        customersWithDues: new Set(plan.bills.map((b) => b.cashAcc)).size,
        openPaise,
        originalPaise: plan.bills.reduce((s, b) => s + b.originalPaise, 0),
        receivedPaise: plan.bills.reduce((s, b) => s + b.receivedPaise, 0),
        partlyReceived: plan.bills.filter((b) => b.receivedPaise > 0).length,
        ageingPaise: ageing,
      },
    },
    issues,
    written: written ? written.steps : null,
    notes: written ? written.notes : null,
    reconciliation: written
      ? {
          plannedOpenPaise: openPaise,
          inLedgerPaise: written.openingBillPaise,
          equal: written.openingBillPaise === openPaise,
        }
      : null,
    failures: written ? written.failures.length : 0,
  }
}

const rupees = (paise: number): string =>
  `${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function formatReport(r: ImportReport): string {
  const lines: string[] = []
  const add = (s = ''): void => void lines.push(s)
  add(`Legacy import — ${r.mode} — as of ${r.asOf}`)
  add()
  add('SOURCES')
  add(
    `  product list       ${String(r.sources.products.parsed)} of ${String(r.sources.products.rows)} rows`,
  )
  add(
    r.sources.outstanding.source === 'sheet'
      ? `  outstanding        ${String(r.sources.outstanding.parsed)} of ${String(r.sources.outstanding.rows)} rows (the report the founder handed over)`
      : `  outstanding        ${String(r.sources.outstanding.parsed)} open bills rebuilt from the backup's ledger`,
  )
  const rec = r.sources.outstanding.reconciliation
  if (rec)
    add(
      `    vs the backup, same day: ${String(rec.inBoth)} of the report's ${String(rec.reportBills)} bills found, ${String(rec.sameBalance)} with the same balance; the backup also has ${String(rec.onlyInRebuilt)} open bills the report lacks (₹${rupees(rec.rebuiltOnlyPaise)}, ${String(rec.rebuiltOnlyBeforeReportStart)} dated before the report's first bill), and lacks ${String(rec.onlyInReport)} the report has (₹${rupees(rec.reportOnlyPaise)})`,
    )
  add(`  customer master    ${String(r.sources.customers.parsed)} customers`)
  if (r.sources.salesGst)
    add(
      `  sales GST register ${String(r.sources.salesGst.rows)} rows, ${String(r.sources.salesGst.facts.distinctBills)} bills, ${String(r.sources.salesGst.facts.customers)} customers`,
    )
  if (r.sources.backup)
    add(
      `  SQL Server backup  ${String(r.sources.backup.dataPages)} data pages, ${String(r.sources.backup.tables)} tables (${String(r.sources.backupUnsupported)} unreadable)`,
    )
  add()
  add('PLAN')
  add(`  manufacturers      ${String(r.plan.manufacturers)}`)
  add(
    `  products           ${String(r.plan.items.planned)} (${String(r.plan.items.listed)} listed, ${String(r.plan.items.unlisted)} unlisted, ${String(r.plan.items.unpriced)} unpriced), ${String(r.plan.items.hsnHeadings)} HSN headings at ${r.plan.items.gstRatesBps.map((b) => `${String(b / 100)}%`).join(' / ')}`,
  )
  add(`  beats              ${String(r.plan.beats)}`)
  add(
    `  shops              ${String(r.plan.retailers.planned)} (${String(r.plan.retailers.withPhone)} with a phone, ${String(r.plan.retailers.withoutPhone)} without, ${String(r.plan.retailers.withGstin)} with a GSTIN)`,
  )
  add(
    `  opening bills      ${String(r.plan.bills.planned)} bills of ${String(r.plan.bills.customersWithDues)} shops, ₹${rupees(r.plan.bills.openPaise)} owed (₹${rupees(r.plan.bills.originalPaise)} billed, ₹${rupees(r.plan.bills.receivedPaise)} received on ${String(r.plan.bills.partlyReceived)} of them)`,
  )
  add(
    `  ageing (days)      ${Object.entries(r.plan.bills.ageingPaise)
      .map(([k, v]) => `${k}: ₹${rupees(v)}`)
      .join('   ')}`,
  )
  if (r.plan.items.withOpeningStock > 0)
    add(
      `  opening stock      ${String(r.plan.items.withOpeningStock)} items, ${String(r.plan.items.openingStockUnits)} units (posted only with --opening-stock)`,
    )
  add()
  add('ISSUES (kind: count)')
  for (const [k, v] of Object.entries(r.issues)) add(`  ${k.padEnd(34)} ${String(v)}`)
  if (r.written) {
    add()
    add('WRITTEN (created / unchanged / skipped / failed)')
    for (const [k, v] of Object.entries(r.written))
      add(
        `  ${k.padEnd(14)} ${String(v.created).padStart(5)} ${String(v.unchanged).padStart(5)} ${String(v.skipped).padStart(5)} ${String(v.failed).padStart(5)}`,
      )
    if (r.notes && r.notes.hsnHeadingsHeldBack > 0)
      add(
        `  HSN headings held back (the catalogue has a newer rate): ${String(r.notes.hsnHeadingsHeldBack)}`,
      )
    if (r.notes && r.notes.openingStockUnitsWithoutMrp > 0)
      add(
        `  opening stock left out for want of an MRP: ${String(r.notes.openingStockUnitsWithoutMrp)} units`,
      )
    if (r.reconciliation)
      add(
        `  receivables in the ledger: ₹${rupees(r.reconciliation.inLedgerPaise)} vs planned ₹${rupees(r.reconciliation.plannedOpenPaise)} — ${r.reconciliation.equal ? 'EQUAL' : 'DIFFERENT'}`,
      )
  }
  return lines.join('\n')
}

/** `kind → refs`, for the terminal only (a ref is a sheet and a row number, never a value). */
export function formatIssueRefs(issues: readonly Issue[], limit = 6): string {
  const by = new Map<IssueKind, string[]>()
  for (const i of issues) by.set(i.kind, [...(by.get(i.kind) ?? []), i.ref])
  return [...by.entries()]
    .map(
      ([k, refs]) =>
        `  ${k}: ${refs.slice(0, limit).join(', ')}${refs.length > limit ? ', …' : ''}`,
    )
    .join('\n')
}
