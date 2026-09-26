import { CatalogService } from '@dos/core/modules/catalog'
import { InventoryService, reservableLocationId } from '@dos/core/modules/inventory'
import { createImportServices, type ImportServices } from '@dos/core/integrations'
import { PricingService } from '@dos/core/modules/pricing'
import { RetailersService } from '@dos/core/modules/retailers'
import { tenantStorage } from '@dos/core/platform'
import {
  beats,
  hsnRates,
  invoices,
  manufacturers,
  memberships,
  priceListItems,
  priceLists,
  productVariants,
  retailers,
  suppliers,
  tenantProductCosts,
  tenantProducts,
  tenants,
  withSystem,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { isValidGstin } from '@dos/domain'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { LegacySupplier } from './bak-data.js'
import { ids, LEGACY_SYSTEM, stableId } from './ids.js'
import type { Plan, PlannedItem } from './plan.js'
import { parseIndianMobile, stateCodeFromLabel } from './text.js'

/**
 * The WRITER: turns a `Plan` into rows, only ever through the application's own services (or, for the two
 * GLOBAL curated tables the services do not cover, through `withTenant` as the curator role, which is what
 * row-level security lets write them).
 *
 * IDEMPOTENT BY CONSTRUCTION. Every row this file creates has an id derived from its legacy key (`ids.ts`),
 * and every step first asks whether that id is already there. A second run finds everything and writes
 * nothing — not even an `updated_at`. Rows the distributor has changed since (a price, a phone number, a
 * case size) are therefore never overwritten by a re-run: the import is a LOAD, not a sync.
 *
 * ONE UNIT PER TRANSACTION, like the generic importer's commit run: a bad row is counted and reported and
 * the other rows still land; re-running heals a crash midway.
 */

export interface StepResult {
  created: number
  unchanged: number
  skipped: number
  failed: number
}

export type StepName =
  | 'manufacturers'
  | 'hsnRates'
  | 'products'
  | 'listings'
  | 'prices'
  | 'costs'
  | 'suppliers'
  | 'beats'
  | 'retailers'
  | 'openingBills'
  | 'openingStock'

export interface WriteOptions {
  asOf: string
  ratesFrom: string
  openingStock: boolean
  suppliers: readonly LegacySupplier[]
  log: (line: string) => void
}

export interface WriteResult {
  steps: Record<StepName, StepResult>
  /** Failure references (`step:key` and the service's own message) for the operator's terminal — never written to a report. */
  failures: string[]
  /** Sum, in paise, of the opening bills that now exist (created or found). */
  openingBillPaise: number
  /** Things a step deliberately left out, as counts (never a name or a code). */
  notes: { openingStockUnitsWithoutMrp: number; hsnHeadingsHeldBack: number }
}

const blank = (): StepResult => ({ created: 0, unchanged: 0, skipped: 0, failed: 0 })

export interface TenantHandle {
  tenantId: string
  ownerId: string
  slug: string
  stateCode: string
}

/** The distributor and its owner, looked up the way sign-in does before a tenant is known: through `withSystem`. */
export async function findTenant(db: Db, slug: string): Promise<TenantHandle> {
  return withSystem(db, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.slug, slug))
    if (!t) throw new Error(`no distributor with slug "${slug}" (run the bootstrap first)`)
    const [m] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, t.id),
          eq(memberships.role, 'owner'),
          eq(memberships.status, 'active'),
        ),
      )
      .limit(1)
    if (!m) throw new Error(`distributor "${slug}" has no active owner to act as`)
    return { tenantId: t.id, ownerId: m.userId, slug: t.slug, stateCode: t.stateCode }
  })
}

export async function writePlan(
  db: Db,
  tenant: TenantHandle,
  plan: Plan,
  options: WriteOptions,
): Promise<WriteResult> {
  const steps = Object.fromEntries(
    (
      [
        'manufacturers',
        'hsnRates',
        'products',
        'listings',
        'prices',
        'costs',
        'suppliers',
        'beats',
        'retailers',
        'openingBills',
        'openingStock',
      ] as StepName[]
    ).map((s) => [s, blank()]),
  ) as Record<StepName, StepResult>
  const failures: string[] = []
  const owner: TenantContext = {
    tenantId: tenant.tenantId,
    actorId: tenant.ownerId,
    actorRole: 'owner',
  }
  const curator: TenantContext = { ...owner, actorRole: 'curator' }
  const services: ImportServices = createImportServices(db)
  const catalog = new CatalogService(db)
  const pricing = new PricingService(db)
  const beatsApi = new RetailersService(db)
  const inventory = new InventoryService()
  const asOwner = <T>(fn: () => Promise<T>): Promise<T> => tenantStorage.run(owner, fn)
  const fail = (step: StepName, key: string, e: unknown): void => {
    steps[step].failed++
    failures.push(`${step}:${key}: ${e instanceof Error ? e.message : String(e)}`)
  }

  // --------------------------------------------------------------------------------------- manufacturers
  const manufacturerId = new Map<string, string>()
  for (const m of plan.manufacturers) {
    try {
      const id = await withTenant(db, curator, async (tx) => {
        const rows = await tx
          .select({ id: manufacturers.id, name: manufacturers.name })
          .from(manufacturers)
        const hit = rows.find((r) => r.name.toUpperCase() === m.name.toUpperCase())
        if (hit) {
          steps.manufacturers.unchanged++
          return hit.id
        }
        const newId = ids.manufacturer(m.name)
        await tx.insert(manufacturers).values({ id: newId, name: m.name, legalName: m.name })
        steps.manufacturers.created++
        return newId
      })
      manufacturerId.set(m.name, id)
    } catch (e) {
      fail('manufacturers', m.code || '?', e)
    }
  }

  // -------------------------------------------------------------------------------------------- HSN rates
  const blocked = new Set<string>()
  for (const r of plan.hsnRates) {
    try {
      await withTenant(db, curator, async (tx) => {
        const rows = await tx
          .select()
          .from(hsnRates)
          .where(eq(hsnRates.hsnCode, r.hsn))
          .orderBy(desc(hsnRates.effectiveFrom))
        const live = rows.find(
          (x) =>
            x.effectiveFrom <= options.asOf &&
            (x.effectiveTo === null || x.effectiveTo >= options.asOf),
        )
        if (live && live.gstBps === r.gstBps && live.cessBps === 0) {
          steps.hsnRates.unchanged++
          return
        }
        // The legacy rate takes effect on `ratesFrom`. It is added only when it can be the NEWEST row of the heading:
        // a rate the curator dated on or after `ratesFrom` (or in the future) is never overridden by a load.
        const from = options.ratesFrom
        if (
          rows.some((x) => x.effectiveFrom > options.asOf) ||
          from > options.asOf ||
          (live && live.effectiveFrom >= from)
        ) {
          blocked.add(r.hsn)
          steps.hsnRates.skipped++
          return
        }
        await tx
          .insert(hsnRates)
          .values({
            id: ids.hsnRate(r.hsn, from),
            hsnCode: r.hsn,
            description: 'Loaded from the legacy item list',
            gstBps: r.gstBps,
            cessBps: 0,
            effectiveFrom: from,
          })
          .onConflictDoNothing()
        steps.hsnRates.created++
      })
    } catch (e) {
      blocked.add(r.hsn)
      fail('hsnRates', r.hsn, e)
    }
  }

  // ------------------------------------------------------------------------------------ products, listings
  const usable: PlannedItem[] = plan.items.filter((i) => !blocked.has(i.hsn))
  steps.products.skipped += plan.items.length - usable.length
  const variantOf = new Map<string, string>()
  let sort = 0
  for (const item of usable) {
    sort++
    const variantId = ids.variant(tenant.tenantId, item.code)
    const mid = manufacturerId.get(item.mfgName)
    try {
      const have = await withTenant(db, owner, async (tx) => {
        const [v] = await tx
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(eq(productVariants.id, variantId))
        return v !== undefined
      })
      if (have) steps.products.unchanged++
      else {
        if (!mid) throw new Error('its manufacturer was not created')
        await asOwner(() =>
          catalog.propose({
            idempotencyKey: `legacy:propose:${variantId}`,
            productId: ids.product(tenant.tenantId, item.code),
            variantId,
            manufacturerId: mid,
            productName: item.title,
            variantName: item.title,
            // The list gives no pack contents, and a legacy price is per legacy unit: one unit is one piece.
            netQty: 1,
            netUnit: 'pcs',
            defaultCaseSize: 1,
            hsnCode: item.hsn,
            ...(item.mrpPaise ? { mrpPaise: item.mrpPaise } : {}),
          }),
        )
        steps.products.created++
      }
      variantOf.set(item.code, variantId)
    } catch (e) {
      fail('products', item.code, e)
      continue
    }
    try {
      const listed = await withTenant(db, owner, async (tx) => {
        const [l] = await tx
          .select({ id: tenantProducts.id })
          .from(tenantProducts)
          .where(
            and(
              eq(tenantProducts.tenantId, tenant.tenantId),
              eq(tenantProducts.variantId, variantId),
            ),
          )
        return l !== undefined
      })
      if (listed) steps.listings.unchanged++
      else {
        await asOwner(() =>
          services.tenantCatalog.upsertListing({
            idempotencyKey: `legacy:listing:${variantId}`,
            id: ids.listing(tenant.tenantId, item.code),
            variantId,
            listed: item.listed,
            minOrderQty: 1,
            orderIncrement: 1,
            sortOrder: sort,
          }),
        )
        steps.listings.created++
      }
    } catch (e) {
      fail('listings', item.code, e)
    }
  }

  // ------------------------------------------------------------------------------------------ price list
  try {
    const priceListId = ids.priceList(tenant.tenantId)
    const state = await withTenant(db, owner, async (tx) => {
      const [list] = await tx
        .select({ id: priceLists.id })
        .from(priceLists)
        .where(and(eq(priceLists.tenantId, tenant.tenantId), eq(priceLists.id, priceListId)))
      const [def] = await tx
        .select({ id: priceLists.id })
        .from(priceLists)
        .where(and(eq(priceLists.tenantId, tenant.tenantId), eq(priceLists.isDefault, true)))
      const have = await tx
        .select({ variantId: priceListItems.variantId })
        .from(priceListItems)
        .where(eq(priceListItems.priceListId, priceListId))
      return {
        list: list !== undefined,
        hasDefault: def !== undefined,
        have: new Set(have.map((h) => h.variantId)),
      }
    })
    if (!state.list)
      await asOwner(() =>
        pricing.upsertPriceList({
          idempotencyKey: `legacy:price-list:${priceListId}`,
          id: priceListId,
          name: 'Legacy price list',
          isDefault: !state.hasDefault,
          active: true,
        }),
      )
    const missing = usable.filter((i) => {
      const v = variantOf.get(i.code)
      return v !== undefined && i.salePaise !== null && !state.have.has(v)
    })
    steps.prices.unchanged += usable.filter((i) => {
      const v = variantOf.get(i.code)
      return v !== undefined && state.have.has(v)
    }).length
    steps.prices.skipped += usable.filter((i) => i.salePaise === null).length
    for (let at = 0; at < missing.length; at += 500) {
      const chunk = missing.slice(at, at + 500)
      await asOwner(() =>
        pricing.setPriceListItems({
          idempotencyKey: `legacy:price-items:${stableId(chunk.map((c) => c.code).join('|'))}`,
          priceListId,
          items: chunk.map((c) => ({
            id: ids.priceItem(tenant.tenantId, c.code),
            variantId: variantOf.get(c.code) ?? '',
            ratePaise: c.salePaise ?? 0,
            inclusiveOfGst: false,
          })),
        }),
      )
      steps.prices.created += chunk.length
    }
  } catch (e) {
    fail('prices', 'price-list', e)
  }

  // ------------------------------------------------------------------------------------------- suppliers
  const supplierId = new Map<string, string>()
  for (const s of options.suppliers) {
    const id = ids.supplier(tenant.tenantId, s.code)
    try {
      const have = await withTenant(db, owner, async (tx) => {
        const [r] = await tx
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(eq(suppliers.id, id))
        return r !== undefined
      })
      supplierId.set(s.code, id)
      if (have) {
        steps.suppliers.unchanged++
        continue
      }
      const phone = parseIndianMobile(s.phoneRaw)
      const state = stateCodeFromLabel(s.stateCode)
      await asOwner(() =>
        services.tenantCatalog.upsertSupplier({
          idempotencyKey: `legacy:supplier:${id}`,
          id,
          name: s.name.slice(0, 120),
          eInvoicing: false,
          active: true,
          ...(isValidGstin(s.gstinRaw) ? { gstin: s.gstinRaw } : {}),
          ...(state ? { stateCode: state } : {}),
          ...(phone ? { phone } : {}),
        }),
      )
      steps.suppliers.created++
    } catch (e) {
      fail('suppliers', s.code, e)
    }
  }

  // ----------------------------------------------------------------------------------------------- costs
  for (const item of usable) {
    const variantId = variantOf.get(item.code)
    if (!variantId || item.purchaseRatePaise === null || item.landedCostPaise === null) {
      steps.costs.skipped++
      continue
    }
    try {
      const have = await withTenant(db, owner, async (tx) => {
        const rows = await tx
          .select({ id: tenantProductCosts.id })
          .from(tenantProductCosts)
          .where(
            and(
              eq(tenantProductCosts.tenantId, tenant.tenantId),
              eq(tenantProductCosts.variantId, variantId),
            ),
          )
          .limit(1)
        return rows.length > 0
      })
      if (have) {
        steps.costs.unchanged++
        continue
      }
      const sid = item.supplierCode ? supplierId.get(item.supplierCode) : undefined
      await asOwner(() =>
        services.tenantCatalog.upsertCost({
          idempotencyKey: `legacy:cost:${variantId}`,
          id: ids.cost(tenant.tenantId, item.code),
          variantId,
          purchaseRatePaise: item.purchaseRatePaise ?? 0,
          landedCostPaise: item.landedCostPaise ?? 0,
          ...(sid ? { supplierId: sid } : {}),
        }),
      )
      steps.costs.created++
    } catch (e) {
      fail('costs', item.code, e)
    }
  }

  // ------------------------------------------------------------------------------------------------ beats
  for (const name of plan.beats) {
    const id = ids.beat(tenant.tenantId, name)
    try {
      const have = await withTenant(db, owner, async (tx) => {
        const [b] = await tx.select({ id: beats.id }).from(beats).where(eq(beats.id, id))
        return b !== undefined
      })
      if (have) {
        steps.beats.unchanged++
        continue
      }
      await asOwner(() =>
        beatsApi.upsertBeat({
          idempotencyKey: `legacy:beat:${id}`,
          id,
          name: name.slice(0, 120),
          area: name.slice(0, 120),
          visitDays: [],
          active: true,
        }),
      )
      steps.beats.created++
    } catch (e) {
      fail('beats', name, e)
    }
  }

  // ------------------------------------------------------------------------------------------- retailers
  const retailerOf = new Map<string, string>()
  for (const r of plan.retailers) {
    const id = ids.retailer(tenant.tenantId, r.code)
    try {
      const created = await asOwner(() =>
        withTenant(db, owner, async (tx) => {
          const [have] = await tx
            .select({ id: retailers.id })
            .from(retailers)
            .where(and(eq(retailers.tenantId, tenant.tenantId), eq(retailers.id, id)))
          if (have) return false
          const beatId = r.beatName ? await services.retailers.findBeatByName(tx, r.beatName) : null
          const result = await services.retailers.upsertFromImport(tx, {
            retailerId: null,
            newId: id,
            values: {
              name: r.name,
              ownerName: r.ownerName,
              phone: r.phone,
              gstin: r.gstin,
              pan: r.pan,
              address: r.address,
              stateCode: r.stateCode,
              beatId,
              tallyLedgerName: null,
            },
          })
          await services.retailers.linkExternalCode(tx, {
            id: ids.externalCode(tenant.tenantId, r.code),
            system: LEGACY_SYSTEM,
            code: r.code,
            retailerId: result.id,
          })
          return true
        }),
      )
      if (created) steps.retailers.created++
      else steps.retailers.unchanged++
      retailerOf.set(r.code, id)
    } catch (e) {
      fail('retailers', r.code, e)
    }
  }

  // -------------------------------------------------------------------------------------- opening bills
  const label = ids.loadLabel(tenant.tenantId)
  let billTotal = 0
  for (const b of plan.bills) {
    const retailerId = retailerOf.get(b.cashAcc)
    if (!retailerId) {
      steps.openingBills.skipped++
      continue
    }
    const id = ids.openingInvoice(tenant.tenantId, b.bookCode, b.salYear, b.billNo)
    try {
      const created = await asOwner(() =>
        withTenant(db, owner, async (tx) => {
          const [have] = await tx
            .select({ id: invoices.id, total: invoices.totalPaise })
            .from(invoices)
            .where(and(eq(invoices.tenantId, tenant.tenantId), eq(invoices.id, id)))
          if (have) {
            billTotal += have.total
            return false
          }
          // The bill number is unique across the distributor's external bills: if the plain legacy number is
          // already another bill's, this one keeps book and year in its number.
          const taken = await services.billing.externalInvoiceNumbersOnFile(tx, [b.invoiceNo])
          const number = taken.has(b.invoiceNo)
            ? `${b.bookCode}-${b.salYear}-${b.billNo}`
            : b.invoiceNo
          const row = await services.billing.recordOpeningInvoice(tx, {
            id,
            retailerId,
            externalInvoiceNo: number,
            invoiceDate: b.invoiceDate,
            amountPaise: b.openPaise,
            importJobId: label,
            dueDate: b.dueDate,
          })
          billTotal += row.totalPaise
          return true
        }),
      )
      if (created) steps.openingBills.created++
      else steps.openingBills.unchanged++
    } catch (e) {
      fail('openingBills', b.key, e)
    }
  }

  // ---------------------------------------------------------------------------------------- opening stock
  const notes = { openingStockUnitsWithoutMrp: 0, hsnHeadingsHeldBack: blocked.size }
  if (options.openingStock) {
    for (const item of usable) {
      const variantId = variantOf.get(item.code)
      if (!variantId || item.openingQty === null || item.openingQty <= 0) {
        steps.openingStock.skipped++
        continue
      }
      if (item.mrpPaise === null) {
        // a lot's identity is (variant, batch, MRP) and its MRP is the printed one (ADR 0003): no MRP, no lot
        steps.openingStock.skipped++
        notes.openingStockUnitsWithoutMrp += item.openingQty
        continue
      }
      try {
        const posted = await asOwner(() =>
          withTenant(db, owner, async (tx) => {
            const locationId = await reservableLocationId(tx)
            const { lot } = await inventory.findOrCreateLot(tx, {
              id: ids.lot(tenant.tenantId, item.code),
              variantId,
              batchNo: 'OPENING',
              mrpPaise: item.mrpPaise ?? 0,
            })
            const result = await inventory.post(tx, [
              {
                lotId: lot.id,
                locationId,
                qtyDelta: item.openingQty ?? 0,
                reason: 'opening',
                refType: 'legacy_import',
                refId: variantId,
                idempotencyKey: `legacy:opening-stock:${tenant.tenantId}:${item.code}`,
                note: 'Closing balance carried over from the old software',
              },
            ])
            return result.entries.length > 0
          }),
        )
        if (posted) steps.openingStock.created++
        else steps.openingStock.unchanged++
      } catch (e) {
        fail('openingStock', item.code, e)
      }
    }
  } else steps.openingStock.skipped = usable.filter((i) => i.openingQty !== null).length

  // The sum of the opening bills that exist now, for the reconciliation line.
  const existing = await withTenant(db, owner, async (tx) =>
    tx
      .select({ total: invoices.totalPaise })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenant.tenantId),
          eq(invoices.source, 'import'),
          inArray(
            invoices.id,
            plan.bills.map((b) =>
              ids.openingInvoice(tenant.tenantId, b.bookCode, b.salYear, b.billNo),
            ),
          ),
        ),
      ),
  )
  void billTotal
  const openingBillPaise = existing.reduce((s, r) => s + r.total, 0)
  options.log(`  wrote ${String(Object.values(steps).reduce((n, s) => n + s.created, 0))} rows`)
  return { steps, failures, openingBillPaise, notes }
}
