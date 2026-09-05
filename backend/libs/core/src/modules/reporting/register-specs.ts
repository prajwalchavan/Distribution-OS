import type { z } from 'zod'
import {
  CollectionsRegisterInput,
  DailyTenantStatsInput,
  DeliveryPerformanceInput,
  FillRateInput,
  GstPurchaseRegisterInput,
  GstSalesRegisterInput,
  RepProductivityInput,
  SchemeSpendInput,
  StockValueInput,
  type ReportRegister,
} from '@dos/contracts'
import { OutstandingListInput } from '@dos/contracts'
import { withTenant } from '@dos/db'
import { currentTenant, requireDb } from '../../platform/index.js'
import { listOutstanding } from '../receivables/index.js'
import type { ReportingStack } from './worker-services.js'

/**
 * ONE table of what each exportable register IS: its own GET input schema, whether it pages, and how
 * to read it. Two callers share it and must never drift apart (docs/plans/reporting.md §5 spec 16):
 *
 *   `reporting.exports.request`  validates the client's `filters` against the target register's OWN
 *                                schema — window cap included — and answers 400 BEFORE a job exists,
 *                                so an oversized window is never queued and never rendered
 *   the `report_*` renderers     read the whole register with those same filters, page by page
 *
 * `outstanding` is the one register with no JSON GET on this contract (its screen is
 * `receivables.outstanding.list`, coordination §4): only the CSV path lives here.
 */

export interface RegisterReadResult {
  rows: Record<string, unknown>[]
  nextCursor: string | null
}

export interface RegisterSpec {
  /** The register's own GET input; `.parse()` is where `window_too_wide` is raised. */
  input: z.ZodType
  /** Paged registers accept `limit` / `cursor`; the two GST documents answer in one read. */
  paged: boolean
  /** `input` is what that schema parsed; each reader narrows it to its own type on the first line. */
  read(stack: ReportingStack, input: unknown): Promise<RegisterReadResult>
}

const rows = (items: readonly unknown[], nextCursor: string | null = null): RegisterReadResult => ({
  rows: items as Record<string, unknown>[],
  nextCursor,
})

export const REGISTER_SPECS: Record<ReportRegister, RegisterSpec> = {
  dailySales: {
    input: DailyTenantStatsInput,
    paged: true,
    read: async (stack, raw) => {
      const input = raw as z.infer<typeof DailyTenantStatsInput>
      const out = await stack.reporting.dailyStatsTenant(input)
      return rows(
        out.items.map((item) => ({
          day: item.day,
          ordersCount: item.ordersCount,
          invoicedPaise: item.invoicedPaise,
          collectedPaise: item.collectedPaise,
          outstandingPaise: item.outstandingPaise,
          overduePaise: item.overduePaise,
          deliveredStops: item.deliveredStops,
          partialStops: item.partialStops,
          failedStops: item.failedStops,
          onTimeStops: item.onTimeStops,
          podStops: item.podStops,
          orderedPcs: item.orderedPcs,
          pickedPcs: item.pickedPcs,
          activeRetailers: item.activeRetailers,
        })),
        out.nextCursor,
      )
    },
  },
  repProductivity: {
    input: RepProductivityInput,
    paged: true,
    read: async (stack, raw) => {
      const input = raw as z.infer<typeof RepProductivityInput>
      const out = await stack.registers.repProductivity(input)
      return rows(out.items, out.nextCursor)
    },
  },
  schemeSpend: {
    input: SchemeSpendInput,
    paged: true,
    read: async (stack, raw) => {
      const input = raw as z.infer<typeof SchemeSpendInput>
      const out = await stack.registers.schemeSpend(input)
      return rows(out.items, out.nextCursor)
    },
  },
  stockValue: {
    input: StockValueInput,
    paged: true,
    read: async (stack, raw) => {
      const input = raw as z.infer<typeof StockValueInput>
      const out = await stack.registers.stockValue(input)
      return rows(out.items, out.nextCursor)
    },
  },
  fillRate: {
    input: FillRateInput,
    paged: true,
    read: async (stack, raw) => {
      const input = raw as z.infer<typeof FillRateInput>
      const out = await stack.registers.fillRate(input)
      return rows(out.items, out.nextCursor)
    },
  },
  deliveryPerformance: {
    input: DeliveryPerformanceInput,
    paged: true,
    read: async (stack, raw) => {
      const input = raw as z.infer<typeof DeliveryPerformanceInput>
      const out = await stack.registers.deliveryPerformance(input)
      return rows(out.items, out.nextCursor)
    },
  },
  collections: {
    input: CollectionsRegisterInput,
    paged: true,
    read: async (stack, raw) => {
      const input = raw as z.infer<typeof CollectionsRegisterInput>
      const out = await stack.registers.collections(input)
      return rows(out.items, out.nextCursor)
    },
  },
  gstSalesRegister: {
    input: GstSalesRegisterInput,
    paged: false,
    read: async (stack, raw) => {
      const input = raw as z.infer<typeof GstSalesRegisterInput>
      const out = await stack.registers.gstSalesRegister(input)
      // One file, two sections: outward supplies, then the credit notes the filer subtracts.
      return rows([
        ...out.rows.map((r) => ({ section: 'sales', ...r })),
        ...out.creditNoteRows.map((r) => ({ section: 'creditNote', ...r })),
      ])
    },
  },
  gstPurchaseRegister: {
    input: GstPurchaseRegisterInput,
    paged: false,
    read: async (stack, raw) => {
      const input = raw as z.infer<typeof GstPurchaseRegisterInput>
      const out = await stack.registers.gstPurchaseRegister(input)
      return rows([
        ...out.rows.map((r) => ({ section: 'purchase', ...r })),
        ...out.supplierRows.map((r) => ({ section: 'supplier', ...r })),
      ])
    },
  },
  outstanding: {
    input: OutstandingListInput,
    paged: true,
    read: async (stack, raw) => {
      const input = raw as z.infer<typeof OutstandingListInput>
      // Receivables owns the ageing arithmetic; the CSV is its register, not a second one (§4).
      const db = requireDb(stack.db)
      const out = await withTenant(db, currentTenant(), (tx) => listOutstanding(tx, input))
      return rows(out.items, out.nextCursor)
    },
  },
}
