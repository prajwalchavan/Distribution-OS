/** Inventory + inbound procurement (ADR 0003): lots, opening/GRN ledger rows, balances, one posted GRN per supplier. */
import { insertMany } from './db-helpers.js'
import { paise, percentOf, splitGst } from '@dos/domain'
import { asc, eq } from 'drizzle-orm'
import {
  grnLines,
  grns,
  inboundDiscrepancies,
  locations,
  stockBalances,
  stockLedger,
  stockLots,
  supplierInvoiceLines,
  supplierInvoices,
} from '../schema/index.js'
import type { Db } from '../client.js'
import type { VariantRow } from './catalog.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { TenantCatalogResult } from './tenant-catalog.js'
import { atIstTime, daysAgo, isoDate, nth } from './util.js'

const FAST_MOVERS = new Set([
  'campa-cola-750ml',
  'campa-orange-750ml',
  'campa-lemon-750ml',
  'too-yumm-karare-60g',
  'balaji-simply-salted-45g',
  'balaji-masala-masti-45g',
])

interface LotRef {
  id: string
  variantId: string
  variantKey: string
  batchNo: string
  caseSize: number
}

export interface StockResult {
  godownId: string
  damagedId: string
  /** Every lot for a variant, oldest batch first. */
  lotsByVariantId: Map<string, LotRef[]>
}

interface SupplierLine {
  supplierKey: keyof TenantCatalogResult['supplierIds']
  supplierStateCode: string
  invoiceKey: string
  invoiceDate: Date
  paymentTermsDays: number
  variantKeys: string[]
}

const SUPPLIER_INVOICES: SupplierLine[] = [
  {
    supplierKey: 'reliance',
    supplierStateCode: '27',
    invoiceKey: 'reliance-1',
    invoiceDate: daysAgo(9),
    paymentTermsDays: 30,
    variantKeys: ['campa-cola-750ml', 'campa-orange-750ml', 'independence-water-1l'],
  },
  {
    supplierKey: 'guruKripa',
    supplierStateCode: '27',
    invoiceKey: 'guru-kripa-1',
    invoiceDate: daysAgo(7),
    paymentTermsDays: 21,
    variantKeys: [
      'balaji-simply-salted-45g',
      'balaji-masala-masti-45g',
      'balaji-chataka-pataka-45g',
      'balaji-ratlami-sev-200g',
    ],
  },
  {
    supplierKey: 'momMakhana',
    supplierStateCode: '08',
    invoiceKey: 'mom-makhana-1',
    invoiceDate: daysAgo(11),
    paymentTermsDays: 30,
    variantKeys: ['mom-makhana-himalayan-salt-12g', 'mom-makhana-peri-peri-60g'],
  },
  {
    supplierKey: 'guiltfree',
    supplierStateCode: '06',
    invoiceKey: 'guiltfree-1',
    invoiceDate: daysAgo(6),
    paymentTermsDays: 30,
    variantKeys: [
      'too-yumm-karare-60g',
      'too-yumm-multigrain-chips-60g',
      'too-yumm-veggie-stix-70g',
      'too-yumm-makhana-20g',
    ],
  },
  {
    supplierKey: 'alansFoods',
    supplierStateCode: '27',
    invoiceKey: 'alans-foods-1',
    invoiceDate: daysAgo(10),
    paymentTermsDays: 15,
    variantKeys: [
      'masti-oye-classic-salted-30g',
      'masti-oye-tomato-twist-30g',
      'masti-oye-peri-peri-twist-30g',
    ],
  },
]

/** 3 lots (spread across suppliers) get a small quantity moved to the damaged/expiry bin. */
const DAMAGED_VARIANT_KEYS = [
  'campa-lemon-500ml',
  'too-yumm-veggie-stix-70g',
  'balaji-chataka-pataka-45g',
]

export async function seedStock(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  tenantCatalog: TenantCatalogResult,
  people: PeopleResult,
): Promise<StockResult> {
  // Oldest first: the tenant's bootstrap rows ('Godown', 'Damaged / expiry bin') come before anything
  // a docs example or a smoke probe adds later ('Demo Godown (docs)', 'Smoke Probe (owner)' — also
  // `warehouse` kind). An unordered `find()` once picked the docs godown on the founder's re-seeded
  // database, so every later seed that trusts `godownId` debited a location the lots were never in.
  const existingLocations = await db
    .select()
    .from(locations)
    .where(eq(locations.tenantId, tenantId))
    .orderBy(asc(locations.createdAt), asc(locations.id))
  const godown =
    existingLocations.find((l) => l.kind === 'warehouse' && l.name === 'Godown') ??
    existingLocations.find((l) => l.kind === 'warehouse')
  const damaged = existingLocations.find((l) => l.kind === 'damaged')
  if (!godown || !damaged) {
    throw new Error(
      'bootstrapTenant must run before seedDemo: Godown/Damaged locations are missing',
    )
  }

  // --- stock_lots: fast movers get two batches, everything else gets one. ---
  const lotsByVariantId = new Map<string, LotRef[]>()
  const lotRows: {
    id: string
    tenantId: string
    variantId: string
    batchNo: string
    mrpPaise: number
    mfgDate: string
    expiryDate: string
    caseSize: number
  }[] = []

  for (const v of variants) {
    const batches = FAST_MOVERS.has(v.key)
      ? [
          {
            key: `${v.key}:b1`,
            mfgDaysAgo: 90,
            batchNo: `B${isoDate(daysAgo(90)).replace(/-/g, '')}`,
          },
          {
            key: `${v.key}:b2`,
            mfgDaysAgo: 20,
            batchNo: `B${isoDate(daysAgo(20)).replace(/-/g, '')}`,
          },
        ]
      : [
          {
            key: `${v.key}:b1`,
            mfgDaysAgo: 45,
            batchNo: `B${isoDate(daysAgo(45)).replace(/-/g, '')}`,
          },
        ]

    const refs: LotRef[] = []
    for (const b of batches) {
      const id = demoId('stock-lot', b.key)
      const mfg = daysAgo(b.mfgDaysAgo)
      const expiry = new Date(mfg.getTime() + v.shelfLifeDays * 86_400_000)
      lotRows.push({
        id,
        tenantId,
        variantId: v.id,
        batchNo: b.batchNo,
        mrpPaise: v.mrpPaise,
        mfgDate: isoDate(mfg),
        expiryDate: isoDate(expiry),
        caseSize: v.defaultCaseSize,
      })
      refs.push({
        id,
        variantId: v.id,
        variantKey: v.key,
        batchNo: b.batchNo,
        caseSize: v.defaultCaseSize,
      })
    }
    lotsByVariantId.set(v.id, refs)
  }
  await insertMany(db, stockLots, lotRows)

  // Running balance accumulator: `${lotId}:${locationId}` -> pieces on hand.
  const balance = new Map<string, number>()
  const bump = (lotId: string, locationId: string, delta: number) => {
    const key = `${lotId}:${locationId}`
    balance.set(key, (balance.get(key) ?? 0) + delta)
  }

  // --- opening stock_ledger: every lot starts with a few cases at the Godown. ---
  const openingAt = atIstTime(daysAgo(14), 8, 30)
  const ledgerRows: (typeof stockLedger.$inferInsert)[] = []
  const variantByKey = new Map(variants.map((v) => [v.key, v]))

  for (const refs of lotsByVariantId.values()) {
    for (const [i, lot] of refs.entries()) {
      // The older batch of a fast mover is nearly sold through; the newer one starts fuller.
      const cases = refs.length === 2 ? (i === 0 ? 3 : 6) : 5
      const qty = cases * lot.caseSize
      ledgerRows.push({
        id: demoId('stock-ledger-opening', lot.id),
        tenantId,
        occurredAt: openingAt,
        lotId: lot.id,
        locationId: godown.id,
        qtyDelta: qty,
        reason: 'opening',
        refType: 'opening',
        refId: lot.id,
        actorId: people.owner.id,
        idempotencyKey: `opening:${lot.id}`,
      })
      bump(lot.id, godown.id, qty)
    }
  }

  // --- one posted supplier invoice + GRN per supplier, adding stock to the newest batch of each variant. ---
  const invoiceRows: (typeof supplierInvoices.$inferInsert)[] = []
  const invoiceLineRows: (typeof supplierInvoiceLines.$inferInsert)[] = []
  const grnRows: (typeof grns.$inferInsert)[] = []
  const grnLineRows: (typeof grnLines.$inferInsert)[] = []
  const discrepancyRows: (typeof inboundDiscrepancies.$inferInsert)[] = []
  let discrepancySeq = 0

  for (const template of SUPPLIER_INVOICES) {
    // A distributor that does not carry a brand still has the supplier on file, but no bill from it:
    // the tenant's catalog overlay decides which lines exist (`variants` is that overlay).
    const inv = {
      ...template,
      variantKeys: template.variantKeys.filter((k) => variantByKey.has(k)),
    }
    if (inv.variantKeys.length === 0) continue
    const supplierId = tenantCatalog.supplierIds[inv.supplierKey]
    const invoiceId = demoId('supplier-invoice', inv.invoiceKey)
    const grnId = demoId('grn', inv.invoiceKey)
    let subtotal = 0
    let cgst = 0
    let sgst = 0
    let igst = 0
    let cess = 0
    const lineInserts: (typeof supplierInvoiceLines.$inferInsert)[] = []
    const grnLineInserts: (typeof grnLines.$inferInsert)[] = []

    inv.variantKeys.forEach((vk, i) => {
      const v = variantByKey.get(vk)
      if (!v) throw new Error(`unknown variant key in supplier invoice seed: ${vk}`)
      const cost = tenantCatalog.costsByVariantId.get(v.id)
      if (!cost) throw new Error(`no cost for variant ${vk}`)
      const refs = lotsByVariantId.get(v.id) ?? []
      const targetLot = refs.length > 0 ? nth(refs, refs.length - 1) : undefined
      if (!targetLot) throw new Error(`no stock lot for variant ${vk}`)

      const cases = 15 + i * 5
      const qtyPcs = cases * v.defaultCaseSize
      const ratePaise = cost.purchaseRatePaise
      const taxablePaise = paise(ratePaise * qtyPcs)
      const gst = splitGst(taxablePaise, v.gstBps, inv.supplierStateCode, '27')
      const cessAmt = percentOf(taxablePaise, v.cessBps)

      // The Reliance line for Campa Cola comes up 1 case short; a Guru Kripa Ratlami Sev case arrives damaged.
      const isShortLine = inv.invoiceKey === 'reliance-1' && vk === 'campa-cola-750ml'
      const isDamagedLine = inv.invoiceKey === 'guru-kripa-1' && vk === 'balaji-ratlami-sev-200g'
      const shortPcs = isShortLine ? v.defaultCaseSize : 0
      const damagedPcs = isDamagedLine ? v.defaultCaseSize : 0
      const countedQtyPcs = qtyPcs - shortPcs

      const lineId = demoId('supplier-invoice-line', `${inv.invoiceKey}:${vk}`)
      lineInserts.push({
        id: lineId,
        tenantId,
        supplierInvoiceId: invoiceId,
        lineNo: i + 1,
        description: v.name.toUpperCase(),
        variantId: v.id,
        hsnCode: v.hsnCode,
        batchNo: targetLot.batchNo,
        printedQty: cases,
        printedUnit: 'case',
        qtyPcs,
        ratePaise,
        rateBasis: 'piece',
        basisQty: 1,
        gstBps: v.gstBps,
        cessBps: v.cessBps,
        taxablePaise,
        taxPaise: gst.tax + cessAmt,
        lineTotalPaise: taxablePaise + gst.tax + cessAmt,
      })
      subtotal += taxablePaise
      cgst += gst.cgst
      sgst += gst.sgst
      igst += gst.igst
      cess += cessAmt

      const grnLineId = demoId('grn-line', `${inv.invoiceKey}:${vk}`)
      grnLineInserts.push({
        id: grnLineId,
        tenantId,
        grnId,
        supplierInvoiceLineId: lineId,
        variantId: v.id,
        lotId: targetLot.id,
        expectedQtyPcs: qtyPcs,
        countedQtyPcs,
        damagedQtyPcs: damagedPcs,
      })

      if (countedQtyPcs > 0) {
        ledgerRows.push({
          id: demoId('stock-ledger-grn', `${inv.invoiceKey}:${vk}`),
          tenantId,
          occurredAt: atIstTime(inv.invoiceDate, 11, 0),
          lotId: targetLot.id,
          locationId: godown.id,
          qtyDelta: countedQtyPcs,
          reason: 'grn',
          refType: 'grn',
          refId: grnId,
          actorId: people.accountant.id,
          idempotencyKey: `grn:${inv.invoiceKey}:${vk}`,
        })
        bump(targetLot.id, godown.id, countedQtyPcs)
      }

      if (isShortLine) {
        discrepancySeq += 1
        discrepancyRows.push({
          id: demoId('inbound-discrepancy', `${discrepancySeq}`),
          tenantId,
          grnId,
          grnLineId,
          kind: 'short',
          qtyPcs: shortPcs,
          amountPaise: shortPcs * ratePaise,
          status: 'open',
          note: `${v.name}: 1 case short against invoice on gate count.`,
        })
      }
      if (isDamagedLine) {
        discrepancySeq += 1
        discrepancyRows.push({
          id: demoId('inbound-discrepancy', `${discrepancySeq}`),
          tenantId,
          grnId,
          grnLineId,
          kind: 'damaged',
          qtyPcs: damagedPcs,
          amountPaise: damagedPcs * ratePaise,
          status: 'credited',
          note: `${v.name}: 1 case crushed in transit, credited by supplier.`,
        })
      }
    })

    const freightPaise = 50_000
    const totalPaise = subtotal + cgst + sgst + igst + cess + freightPaise
    invoiceRows.push({
      id: invoiceId,
      tenantId,
      supplierId,
      source: 'manual',
      status: 'received',
      invoiceNo: `${inv.supplierKey.toUpperCase().slice(0, 3)}/26-27/${String(482 + SUPPLIER_INVOICES.indexOf(inv)).padStart(5, '0')}`,
      invoiceDate: isoDate(inv.invoiceDate),
      supplierGstin: null,
      placeOfSupplyState: '27',
      subtotalPaise: subtotal,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: igst,
      cessPaise: cess,
      freightPaise,
      totalPaise,
      dueDate: isoDate(new Date(inv.invoiceDate.getTime() + inv.paymentTermsDays * 86_400_000)),
      approvedBy: people.accountant.id,
      approvedAt: atIstTime(inv.invoiceDate, 18, 0),
    })
    invoiceLineRows.push(...lineInserts)
    grnRows.push({
      id: grnId,
      tenantId,
      grnNo: `GRN-${String(SUPPLIER_INVOICES.indexOf(inv) + 1).padStart(4, '0')}`,
      supplierInvoiceId: invoiceId,
      locationId: godown.id,
      status: 'posted',
      countedBy: people.accountant.id,
      countedAt: atIstTime(inv.invoiceDate, 10, 30),
      postedBy: people.accountant.id,
      postedAt: atIstTime(inv.invoiceDate, 11, 0),
    })
    grnLineRows.push(...grnLineInserts)
  }

  await insertMany(db, supplierInvoices, invoiceRows)
  await insertMany(db, supplierInvoiceLines, invoiceLineRows)
  await insertMany(db, grns, grnRows)
  await insertMany(db, grnLines, grnLineRows)
  await insertMany(db, inboundDiscrepancies, discrepancyRows)

  // --- move a little stock to the damaged bin for three variants. ---
  for (const vk of DAMAGED_VARIANT_KEYS) {
    const v = variantByKey.get(vk)
    if (!v) continue
    const refs = lotsByVariantId.get(v.id) ?? []
    const lot = refs.length > 0 ? nth(refs, refs.length - 1) : undefined
    if (!lot) continue
    const qty = 6
    ledgerRows.push(
      {
        id: demoId('stock-ledger-damage-out', vk),
        tenantId,
        occurredAt: atIstTime(daysAgo(4), 15, 0),
        lotId: lot.id,
        locationId: godown.id,
        qtyDelta: -qty,
        reason: 'damage',
        refType: 'manual',
        refId: lot.id,
        actorId: people.manager.id,
        idempotencyKey: `damage-out:${vk}`,
        note: 'Carton wet from monsoon leak, moved to damaged bin.',
      },
      {
        id: demoId('stock-ledger-damage-in', vk),
        tenantId,
        occurredAt: atIstTime(daysAgo(4), 15, 0),
        lotId: lot.id,
        locationId: damaged.id,
        qtyDelta: qty,
        reason: 'damage',
        refType: 'manual',
        refId: lot.id,
        actorId: people.manager.id,
        idempotencyKey: `damage-in:${vk}`,
        note: 'Carton wet from monsoon leak, moved to damaged bin.',
      },
    )
    bump(lot.id, godown.id, -qty)
    bump(lot.id, damaged.id, qty)
  }

  await insertMany(db, stockLedger, ledgerRows)

  const balanceRows: (typeof stockBalances.$inferInsert)[] = []
  for (const [key, onHand] of balance) {
    const [lotId, locationId] = key.split(':')
    if (!lotId || !locationId) continue
    balanceRows.push({
      tenantId,
      lotId,
      locationId,
      onHand,
      reserved: 0,
      negativeAllowed: locationId === damaged.id,
    })
  }
  await insertMany(db, stockBalances, balanceRows)

  return { godownId: godown.id, damagedId: damaged.id, lotsByVariantId }
}
