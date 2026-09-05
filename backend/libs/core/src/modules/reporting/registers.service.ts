import { Inject, Injectable, Optional } from '@nestjs/common'
import type { z } from 'zod'
import type {
  CollectionsRegisterInput,
  CollectionsRegisterOutput,
  CollectionsRow,
  DeliveryPerformanceInput,
  DeliveryPerformanceOutput,
  FillRateInput,
  FillRateOutput,
  GstPurchaseRegisterInput,
  GstPurchaseRegisterOutput,
  GstSalesRegisterInput,
  GstSalesRegisterOutput,
  RepProductivityInput,
  RepProductivityOutput,
  SchemeSpendInput,
  SchemeSpendOutput,
  SchemeSpendRow,
  StockValueInput,
  StockValueOutput,
} from '@dos/contracts'
import { withTenant, type Db } from '@dos/db'
import { currentTenant, DB, DB_REPLICA, requireDb, requireRole } from '../../platform/index.js'
import { RegistersService as BillingRegistersService } from '../billing/index.js'
import { deliveryPerformanceRows } from '../delivery/index.js'
import { InventoryService, valuationByLocation } from '../inventory/index.js'
import { fillRateLines } from '../orders/index.js'
import { SchemesService } from '../pricing/index.js'
import { purchaseRegister } from '../procurement/index.js'
import { collectionsRegister } from '../receivables/index.js'
import { beatAssignmentsFor, beatLabels } from '../retailers/index.js'
import { userLabels } from '../tenancy/index.js'
import { brandLabels, TenantCatalogService } from '../tenant-catalog/index.js'
import { pageByOffset, ratio } from './reporting.internals.js'
import { repDays } from './reporting.queries.js'
import { repTotals } from './reporting.service.js'
import {
  BACK_OFFICE_READERS,
  CREW_PERFORMANCE_READERS,
  FILL_RATE_READERS,
  REP_PERFORMANCE_READERS,
} from './reporting.roles.js'

/**
 * The registers: bounded, grouped reads with a capped window (docs/plans/reporting.md §4 rule 11), each
 * built from the OWNING module's exported read — reporting re-derives nothing (coordination §4):
 *
 *   repProductivity      `daily_rep_stats` (reporting's own) × retailers' `beatAssignmentsFor`
 *   schemeSpend          billing's `RegistersService.schemeSpend` × pricing's `schemesByIds`
 *   stockValue           inventory's `valuationByLocation` × tenant-catalog's `costsForVariants`
 *   fillRate             orders' `fillRateLines`
 *   deliveryPerformance  delivery's `deliveryPerformanceRows`
 *   collections          receivables' `collectionsRegister`
 *   gstSalesRegister     billing's own `gstSummary` — the GST arithmetic exists exactly once
 *   gstPurchaseRegister  procurement's `purchaseRegister`
 *
 * COST IS A HARD BOUNDARY, NOT A FILTER (docs/22 §9 never-list 1): `stockValue` is the only register
 * that carries a rupee of purchase cost, it is `requireRole(BACK_OFFICE)`, and `permissions.ts` refuses
 * the salesperson, the warehouse, the delivery crew and the shopkeeper on it — while the SAME warehouse
 * role may read `fillRate`, which is quantities only.
 */

type CollectionsIn = z.infer<typeof CollectionsRegisterInput>
type CollectionsOut = z.infer<typeof CollectionsRegisterOutput>

const EMPTY_COLLECTIONS: Omit<CollectionsRow, 'bucket' | 'bucketName'> = {
  cashPaise: 0,
  upiPaise: 0,
  bankTransferPaise: 0,
  chequePaise: 0,
  adjustmentPaise: 0,
  totalPaise: 0,
  receiptCount: 0,
}

@Injectable()
export class ReportingRegistersService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    @Optional() @Inject(DB_REPLICA) private readonly replica: Db | null,
    private readonly billingRegisters: BillingRegistersService,
    private readonly tenantCatalog: TenantCatalogService,
    private readonly inventory: InventoryService,
    private readonly schemes: SchemesService,
  ) {}

  /** Rep productivity per beat over a window ≤ 31 days (docs/23 M21, S9). */
  async repProductivity(
    input: z.infer<typeof RepProductivityInput>,
  ): Promise<z.infer<typeof RepProductivityOutput>> {
    requireRole(REP_PERFORMANCE_READERS)
    const ctx = currentTenant()
    const userId = ctx.actorRole === 'salesperson' ? ctx.actorId : input.userId
    return this.read(async (tx) => {
      const rows = await repDays(tx, {
        from: input.from,
        to: input.to,
        ...(userId ? { userIds: [userId] } : {}),
      })
      const spans = await beatAssignmentsFor(tx, {
        from: input.from,
        to: input.to,
        ...(input.beatId ? { beatId: input.beatId } : {}),
        ...(userId ? { userId } : {}),
      })
      // A rep reassigned mid-window shows under BOTH beats, on their own days, never double-counted:
      // the day row is filed under the assignment that covered that day (docs/plans/reporting.md §5.4).
      const beatOf = (row: (typeof rows)[number]): string | null =>
        spans.find(
          (s) =>
            s.userId === row.userId &&
            s.validFrom <= row.day &&
            (!s.validTo || s.validTo >= row.day),
        )?.beatId ?? null
      const kept = input.beatId ? rows.filter((r) => beatOf(r) === input.beatId) : rows
      const buckets = new Map<
        string,
        { userId: string; beatId: string | null; rows: typeof kept }
      >()
      for (const row of kept) {
        const beatId = beatOf(row)
        const key = `${row.userId}|${beatId ?? ''}`
        const entry = buckets.get(key) ?? { userId: row.userId, beatId, rows: [] }
        entry.rows.push(row)
        buckets.set(key, entry)
      }
      const ordered = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      const cursor = input.cursor
      const after = cursor ? ordered.filter(([key]) => key > cursor) : ordered
      const page = after.slice(0, input.limit + 1)
      const [names, beats] = await Promise.all([
        userLabels(
          tx,
          page.map(([, v]) => v.userId),
        ),
        beatLabels(
          tx,
          page.map(([, v]) => v.beatId ?? '').filter((id) => id.length > 0),
        ),
      ])
      const items = page.slice(0, input.limit).map(([, entry]) => {
        const t = repTotals(entry.rows)
        return {
          userId: entry.userId,
          userName: names.get(entry.userId) ?? '',
          beatId: entry.beatId,
          beatName: entry.beatId ? (beats.get(entry.beatId) ?? null) : null,
          visits: t.visits,
          productiveVisits: t.productiveVisits,
          strikeRate: t.strikeRate,
          ordersCount: t.ordersCount,
          orderValuePaise: t.orderValuePaise,
          linesSold: t.linesSold,
          collectedPaise: t.collectedPaise,
        }
      })
      const lastKey = page[items.length - 1]?.[0]
      return {
        items,
        nextCursor: page.length > input.limit && lastKey ? lastKey : null,
        totals: repTotals(kept),
      }
    })
  }

  /**
   * What each scheme cost in the window (docs/23 O17). Billing counts the rupees out of
   * `invoice_lines.applied_rules`; pricing says who funds each rule. The funding split is NEVER
   * collapsed: distributor-funded is a margin hit today, company-funded is a claim to raise.
   */
  async schemeSpend(
    input: z.infer<typeof SchemeSpendInput>,
  ): Promise<z.infer<typeof SchemeSpendOutput>> {
    requireRole(BACK_OFFICE_READERS)
    return this.read(async (tx) => {
      const spend = await this.billingRegisters.schemeSpend(tx, {
        from: input.from,
        to: input.to,
        ...(input.brandId ? { brandId: input.brandId } : {}),
      })
      const schemes = await this.schemes.schemesByIds(
        tx,
        spend.map((r) => r.ruleId),
      )
      const brands = await brandLabels(
        tx,
        [...schemes.values()].map((s) => s.brandId ?? '').filter((id) => id.length > 0),
      )
      const rows: SchemeSpendRow[] = spend
        .map((row) => {
          const scheme = schemes.get(row.ruleId)
          return {
            schemeId: row.ruleId,
            schemeName: scheme?.name ?? row.ruleId,
            brandId: scheme?.brandId ?? null,
            brandName: scheme?.brandId ? (brands.get(scheme.brandId) ?? null) : null,
            fundingSource: scheme?.fundingSource ?? 'company',
            rewardKind: (scheme?.rewardKind ?? 'free_qty') as SchemeSpendRow['rewardKind'],
            qtyPcs: row.freeQtyPcs,
            amountPaise: row.amountPaise,
            invoiceCount: row.documentCount,
          }
        })
        .filter((row) => (input.schemeId ? row.schemeId === input.schemeId : true))
        .filter((row) => (input.fundingSource ? row.fundingSource === input.fundingSource : true))
      const totals = rows.reduce(
        (acc, r) => ({
          amountPaise: acc.amountPaise + r.amountPaise,
          qtyPcs: acc.qtyPcs + r.qtyPcs,
          companyFundedPaise:
            acc.companyFundedPaise + (r.fundingSource === 'company' ? r.amountPaise : 0),
          distributorFundedPaise:
            acc.distributorFundedPaise + (r.fundingSource === 'distributor' ? r.amountPaise : 0),
        }),
        { amountPaise: 0, qtyPcs: 0, companyFundedPaise: 0, distributorFundedPaise: 0 },
      )
      // Biggest spend first (billing orders the aggregate by amount), so the cursor is the offset.
      const { items, nextCursor } = pageByOffset(rows, input.cursor, input.limit)
      return { items, nextCursor, totals }
    })
  }

  /**
   * Stock at cost per variant and location (docs/23 O15, O17). BACK OFFICE ONLY and never mounted on a
   * field service: `avgCostPaise` is landed cost when set, else the purchase rate — the same definition
   * of "cost" ADR 0002 protects everywhere else.
   */
  async stockValue(
    input: z.infer<typeof StockValueInput>,
  ): Promise<z.infer<typeof StockValueOutput>> {
    requireRole(BACK_OFFICE_READERS)
    return this.read(async (tx) => {
      const nearExpiryBefore = addDaysIso(new Date(), input.nearExpiryDays)
      const rows = await valuationByLocation(tx, {
        ...(input.locationId ? { locationId: input.locationId } : {}),
        ...(input.brandId ? { brandId: input.brandId } : {}),
        nearExpiryBefore,
      })
      const variantIds = [...new Set(rows.map((r) => r.variantId))]
      const [costs, variantNames, locationNames] = await Promise.all([
        this.tenantCatalog.costsForVariants(tx, variantIds),
        this.tenantCatalog.variantLabels(tx, variantIds),
        this.inventory.locationNames(tx, [...new Set(rows.map((r) => r.locationId))]),
      ])
      const brandOf = await this.brandOfVariants(tx, variantIds)
      const brands = await brandLabels(
        tx,
        [...brandOf.values()].filter((id): id is string => id !== null),
      )
      const priced = rows.map((row) => {
        const cost = costs.get(row.variantId)
        const avgCostPaise = cost ? cost.landedCostPaise || cost.purchaseRatePaise : 0
        const brandId = brandOf.get(row.variantId) ?? null
        return {
          variantId: row.variantId,
          variantName: variantNames.get(row.variantId) ?? row.variantId,
          brandId,
          brandName: brandId ? (brands.get(brandId) ?? null) : null,
          locationId: row.locationId,
          locationName: locationNames.get(row.locationId) ?? row.locationId,
          onHandPcs: row.onHandPcs,
          avgCostPaise,
          valuePaise: row.onHandPcs * avgCostPaise,
          nearestExpiryDate: row.nearestExpiryDate,
          nearExpiryValuePaise: row.nearExpiryPcs * avgCostPaise,
        }
      })
      const totals = priced.reduce(
        (acc, r) => ({
          onHandPcs: acc.onHandPcs + r.onHandPcs,
          valuePaise: acc.valuePaise + r.valuePaise,
          nearExpiryValuePaise: acc.nearExpiryValuePaise + r.nearExpiryValuePaise,
        }),
        { onHandPcs: 0, valuePaise: 0, nearExpiryValuePaise: 0 },
      )
      const keyOf = (r: (typeof priced)[number]): string => `${r.variantId}|${r.locationId}`
      const cursor = input.cursor
      const after = cursor ? priced.filter((r) => keyOf(r) > cursor) : priced
      const page = after.slice(0, input.limit + 1)
      const items = page.slice(0, input.limit)
      const last = items[items.length - 1]
      return {
        items,
        nextCursor: page.length > input.limit && last ? keyOf(last) : null,
        totals,
      }
    })
  }

  /** Pieces ordered against pieces picked per variant (docs/23 O2, W1). `0/0 → 1`. */
  async fillRate(input: z.infer<typeof FillRateInput>): Promise<z.infer<typeof FillRateOutput>> {
    requireRole(FILL_RATE_READERS)
    const ctx = currentTenant()
    const salespersonId =
      ctx.actorRole === 'salesperson' ? ctx.actorId : (input.salespersonId ?? undefined)
    return this.read(async (tx) => {
      const rows = await fillRateLines(tx, {
        from: input.from,
        to: input.to,
        ...(input.locationId ? { locationId: input.locationId } : {}),
        ...(salespersonId ? { salespersonId } : {}),
      })
      const names = await this.tenantCatalog.variantLabels(
        tx,
        rows.map((r) => r.variantId),
      )
      const priced = rows.map((row) => ({
        variantId: row.variantId,
        variantName: names.get(row.variantId) ?? row.variantId,
        orderedPcs: row.orderedPcs,
        pickedPcs: row.pickedPcs,
        shortPcs: Math.max(0, row.orderedPcs - row.pickedPcs),
        fillRate: ratio(row.pickedPcs, row.orderedPcs, 1),
      }))
      const sums = priced.reduce(
        (acc, r) => ({
          orderedPcs: acc.orderedPcs + r.orderedPcs,
          pickedPcs: acc.pickedPcs + r.pickedPcs,
          shortPcs: acc.shortPcs + r.shortPcs,
        }),
        { orderedPcs: 0, pickedPcs: 0, shortPcs: 0 },
      )
      // Worst-served variant first (orders sorts the aggregate by shortfall), so the cursor is the offset.
      const { items, nextCursor } = pageByOffset(priced, input.cursor, input.limit)
      return {
        items,
        nextCursor,
        totals: { ...sums, fillRate: ratio(sums.pickedPcs, sums.orderedPcs, 1) },
      }
    })
  }

  /** Per-trip delivery performance (docs/23 O18, D11). The crew is FORCED to its own trips. */
  async deliveryPerformance(
    input: z.infer<typeof DeliveryPerformanceInput>,
  ): Promise<z.infer<typeof DeliveryPerformanceOutput>> {
    requireRole(CREW_PERFORMANCE_READERS)
    const ctx = currentTenant()
    const driverId = ctx.actorRole === 'delivery' ? ctx.actorId : (input.driverId ?? undefined)
    return this.read(async (tx) => {
      const rows = await deliveryPerformanceRows(tx, {
        from: input.from,
        to: input.to,
        ...(driverId ? { driverId } : {}),
        ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
      })
      const names = await userLabels(
        tx,
        rows.map((r) => r.driverId ?? '').filter((id) => id.length > 0),
      )
      const mapped = rows.map((row) => {
        const attempted = row.stopsDelivered + row.stopsPartial
        return {
          tripId: row.tripId,
          tripNo: row.tripNo,
          tripDate: row.tripDate,
          vehicleId: row.vehicleId,
          vehicleRegNo: row.vehicleRegNo,
          driverId: row.driverId,
          driverName: row.driverId ? (names.get(row.driverId) ?? null) : null,
          stopsPlanned: row.stopsPlanned,
          stopsDelivered: row.stopsDelivered,
          stopsPartial: row.stopsPartial,
          stopsFailed: row.stopsFailed,
          onTimeRate: ratio(row.stopsOnTime, attempted),
          podCoverageRate: ratio(row.stopsWithPod, attempted),
          cashVariancePaise: row.cashVariancePaise,
        }
      })
      const sums = rows.reduce(
        (acc, r) => ({
          stopsPlanned: acc.stopsPlanned + r.stopsPlanned,
          stopsDelivered: acc.stopsDelivered + r.stopsDelivered,
          stopsPartial: acc.stopsPartial + r.stopsPartial,
          stopsFailed: acc.stopsFailed + r.stopsFailed,
          onTime: acc.onTime + r.stopsOnTime,
          pod: acc.pod + r.stopsWithPod,
          // Only a settled trip has a variance; an open one contributes nothing, not a zero.
          cashVariancePaise: acc.cashVariancePaise + (r.cashVariancePaise ?? 0),
        }),
        {
          stopsPlanned: 0,
          stopsDelivered: 0,
          stopsPartial: 0,
          stopsFailed: 0,
          onTime: 0,
          pod: 0,
          cashVariancePaise: 0,
        },
      )
      const attempted = sums.stopsDelivered + sums.stopsPartial
      // Trips come back by DATE, not by id (a trip planned ahead carries a later date than its id
      // order), so the cursor is the offset into that order rather than the last trip id.
      const { items, nextCursor } = pageByOffset(mapped, input.cursor, input.limit)
      return {
        items,
        nextCursor,
        totals: {
          stopsPlanned: sums.stopsPlanned,
          stopsDelivered: sums.stopsDelivered,
          stopsPartial: sums.stopsPartial,
          stopsFailed: sums.stopsFailed,
          onTimeRate: ratio(sums.onTime, attempted),
          podCoverageRate: ratio(sums.pod, attempted),
          cashVariancePaise: sums.cashVariancePaise,
        },
      }
    })
  }

  /** The banking slip (docs/23 M10, M12): money collected by day or by collector, split by mode. */
  async collections(input: CollectionsIn): Promise<CollectionsOut> {
    requireRole(BACK_OFFICE_READERS)
    return this.read(async (tx) => {
      const rows = await collectionsRegister(tx, {
        from: input.from,
        to: input.to,
        groupBy: input.groupBy,
        ...(input.mode ? { mode: input.mode } : {}),
      })
      const names =
        input.groupBy === 'collector'
          ? await userLabels(
              tx,
              rows.map((r) => r.bucket),
            )
          : new Map<string, string>()
      const mapped: CollectionsRow[] = rows.map((row) => ({
        bucket: row.bucket,
        bucketName: input.groupBy === 'collector' ? (names.get(row.bucket) ?? null) : null,
        cashPaise: row.cashPaise,
        upiPaise: row.upiPaise,
        bankTransferPaise: row.bankTransferPaise,
        chequePaise: row.chequePaise,
        adjustmentPaise: row.adjustmentPaise,
        totalPaise: row.totalPaise,
        receiptCount: row.receiptCount,
      }))
      const totals = mapped.reduce(
        (acc, r) => ({
          cashPaise: acc.cashPaise + r.cashPaise,
          upiPaise: acc.upiPaise + r.upiPaise,
          bankTransferPaise: acc.bankTransferPaise + r.bankTransferPaise,
          chequePaise: acc.chequePaise + r.chequePaise,
          adjustmentPaise: acc.adjustmentPaise + r.adjustmentPaise,
          totalPaise: acc.totalPaise + r.totalPaise,
          receiptCount: acc.receiptCount + r.receiptCount,
        }),
        { ...EMPTY_COLLECTIONS },
      )
      const cursor = input.cursor
      const after = cursor ? mapped.filter((r) => r.bucket > cursor) : mapped
      const page = after.slice(0, input.limit + 1)
      const items = page.slice(0, input.limit)
      const last = items[items.length - 1]
      return {
        items,
        nextCursor: page.length > input.limit && last ? last.bucket : null,
        totals,
      }
    })
  }

  /**
   * The GSTR-1-shaped sales register: BILLING's own `gstSummary`, wrapped. Byte for byte the document
   * `billing.registers.gstSummary` answers for the same filters — the tax arithmetic exists once
   * (coordination §4), and reporting only adds its 92-day cap and the CSV path.
   */
  async gstSalesRegister(
    input: z.infer<typeof GstSalesRegisterInput>,
  ): Promise<z.infer<typeof GstSalesRegisterOutput>> {
    requireRole(BACK_OFFICE_READERS)
    return this.billingRegisters.gstSummary(input)
  }

  /** The GSTR-2-shaped purchase register (docs/23 O13): only supplier invoices that actually landed. */
  async gstPurchaseRegister(
    input: z.infer<typeof GstPurchaseRegisterInput>,
  ): Promise<z.infer<typeof GstPurchaseRegisterOutput>> {
    requireRole(BACK_OFFICE_READERS)
    return this.read(async (tx) => {
      const { rows, supplierRows } = await purchaseRegister(tx, {
        from: input.from,
        to: input.to,
        ...(input.supplierId ? { supplierId: input.supplierId } : {}),
      })
      const totals = rows.reduce(
        (acc, r) => ({
          qtyPcs: acc.qtyPcs + r.qtyPcs,
          taxablePaise: acc.taxablePaise + r.taxablePaise,
          cgstPaise: acc.cgstPaise + r.cgstPaise,
          sgstPaise: acc.sgstPaise + r.sgstPaise,
          igstPaise: acc.igstPaise + r.igstPaise,
          cessPaise: acc.cessPaise + r.cessPaise,
          totalPaise: acc.totalPaise + r.totalPaise,
          invoiceCount: acc.invoiceCount + r.invoiceCount,
        }),
        {
          qtyPcs: 0,
          taxablePaise: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          cessPaise: 0,
          totalPaise: 0,
          invoiceCount: 0,
        },
      )
      return { from: input.from, to: input.to, rows, totals, supplierRows }
    })
  }

  // =============================================================================================================
  // internals
  // =============================================================================================================

  private read<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const db = requireDb(this.replica ?? this.db)
    return withTenant(db, currentTenant(), fn)
  }

  /**
   * variant → brand, through tenant-catalog's own listing read (the global catalog is curator-owned and
   * reporting may not join it). One page, bounded like every list.
   */
  private async brandOfVariants(
    tx: Db,
    variantIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>()
    if (variantIds.length === 0) return out
    const rows = await this.tenantCatalog.variantBrands(tx, variantIds)
    for (const [variantId, brandId] of rows) out.set(variantId, brandId)
    return out
  }
}

/** `today + days` as an IST-ish calendar date; the near-expiry cut-off of the stock register. */
function addDaysIso(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}
