import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../client.js'
import {
  exportJobs,
  externalPartyCodes,
  importJobs,
  importRows,
  receipts,
  retailerPurchaseHistory,
  tallyMappings,
  tallySyncLedger,
} from '../schema/index.js'
import type { VariantRow } from './catalog.js'
import { insertMany } from './db-helpers.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { RetailersResult, RetailerRow } from './retailers.js'
import type { SalesResult } from './sales.js'
import type { StockResult } from './stock.js'
import { atIstTime, daysAgo, isoDate, makeRng, nth, pick, randInt } from './util.js'

/**
 * Integrations demo data (docs/plans/integrations.md §6, the generic importer of docs/17 §D7): the
 * wizard's job history in every state the screens show, a staged party master with rows waiting for a
 * human, a staged outstanding file ready for the owner's sign-off, the buying history the suggested-
 * order engine reads, the CA's Tally names, one finished Tally export with its sync ledger and two
 * exports still in flight.
 *
 * The source files are REAL: each staged job's CSV is written into the local object store under the
 * same key the wizard's upload would use (`tenant/{tenantId}/import/{jobId}/…`, the way the docint
 * seed writes page images), so `imports.preview` reads it, a fresh `imports.create` against the same
 * key stages it again, and the smoke harness walks the whole wizard on real bytes. Their headers are
 * the built-in profiles' guessed columns (`profiles.data.ts` in @dos/core); the mapping each job holds
 * is the same guess, written by hand here because this package never imports core.
 *
 * Every row is keyed with `demoId('import-…', `${tenantId}:${key}`)` and inserted with
 * `onConflictDoNothing`, so re-seeding adds nothing and a second distributor gets its own rows.
 * Nothing here posts money or stock: the confirmed jobs point at rows the earlier seeds already wrote
 * (the retailers, the listings, billing's brand-DMS bill) — the record of an import, not a second one.
 */

/** Same resolution as the local object-storage driver: `OBJECT_STORAGE_DIR` or `<workspace>/.storage`. */
function storageRoot(): string {
  const configured = process.env.OBJECT_STORAGE_DIR?.trim()
  if (configured) return resolve(configured)
  let dir = resolve(process.cwd())
  for (let hop = 0; hop < 12; hop++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return join(dir, '.storage')
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return join(resolve(process.cwd()), '.storage')
}

function writeObject(objectKey: string, body: string): void {
  const full = join(storageRoot(), objectKey)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, body)
}

/** `import_rows.id` exactly as core derives it (`rowIdFor`): sha256 of `import-row:<job>:<n>`, v7-shaped. */
function rowIdFor(jobId: string, rowNo: number): string {
  const h = createHash('sha256')
    .update(`import-row:${jobId}:${String(rowNo)}`)
    .digest()
  const b = Buffer.from(h.subarray(0, 16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = b.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const csv = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [header, ...rows]
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    .join('\n') + '\n'

const mapping = (columns: readonly (readonly [string, string])[], dateFormat = 'auto') => ({
  columns: columns.map(([column, field]) => ({ column, field })),
  constants: [],
  dateFormat,
  amountUnit: 'rupees',
})

const PARTY_HEADER = [
  'Party Code',
  'Party Name',
  'Contact Person',
  'Mobile',
  'GSTIN',
  'PAN',
  'Address 1',
  'Address 2',
  'Area',
  'City',
  'Pincode',
  'State Code',
  'Route',
  'Ledger Name',
] as const
const PARTY_MAPPING = mapping([
  ['Party Code', 'partyCode'],
  ['Party Name', 'partyName'],
  ['Contact Person', 'ownerName'],
  ['Mobile', 'phone'],
  ['GSTIN', 'gstin'],
  ['PAN', 'pan'],
  ['Address 1', 'addressLine1'],
  ['Address 2', 'addressLine2'],
  ['Area', 'area'],
  ['City', 'city'],
  ['Pincode', 'pincode'],
  ['State Code', 'stateCode'],
  ['Route', 'beatName'],
  ['Ledger Name', 'tallyLedgerName'],
])
const ITEM_HEADER = [
  'Item Code',
  'Item Name',
  'Barcode',
  'Brand',
  'HSN',
  'MRP',
  'Case Qty',
  'GST %',
  'Short Name',
] as const
const ITEM_MAPPING = mapping([
  ['Item Code', 'itemCode'],
  ['Item Name', 'itemName'],
  ['Barcode', 'ean'],
  ['Brand', 'brandName'],
  ['HSN', 'hsnCode'],
  ['MRP', 'mrp'],
  ['Case Qty', 'caseSize'],
  ['GST %', 'gstRate'],
  ['Short Name', 'localAlias'],
])
const OUTSTANDING_HEADER = [
  'Party Code',
  'Party Name',
  'Bill No',
  'Bill Date',
  'Balance',
  'Due Date',
] as const
const OUTSTANDING_MAPPING = mapping(
  [
    ['Party Code', 'partyCode'],
    ['Party Name', 'partyName'],
    ['Bill No', 'invoiceNo'],
    ['Bill Date', 'invoiceDate'],
    ['Balance', 'amount'],
    ['Due Date', 'dueDate'],
  ],
  'DD-MM-YYYY',
)
const SALES_HEADER = [
  'Party Code',
  'Party Name',
  'Bill No',
  'Bill Date',
  'Item Code',
  'Item Name',
  'Qty',
  'Unit',
  'Rate',
] as const
const SALES_MAPPING = mapping(
  [
    ['Party Code', 'partyCode'],
    ['Party Name', 'partyName'],
    ['Bill No', 'invoiceNo'],
    ['Bill Date', 'invoiceDate'],
    ['Item Code', 'itemCode'],
    ['Item Name', 'itemName'],
    ['Qty', 'qty'],
    ['Unit', 'unit'],
    ['Rate', 'rate'],
  ],
  'DD-MM-YYYY',
)
const FA_HEADER = [
  'Outlet Code',
  'Outlet Name',
  'Invoice No',
  'Invoice Date',
  'Outlet GSTIN',
  'State Code',
  'SKU Code',
  'SKU Name',
  'EAN',
  'HSN',
  'Qty',
  'Free Qty',
  'UOM',
  'Rate',
  'Discount',
  'GST %',
  'Batch',
  'Expiry',
  'MRP',
] as const
const FA_MAPPING = mapping([
  ['Outlet Code', 'partyCode'],
  ['Outlet Name', 'partyName'],
  ['Invoice No', 'invoiceNo'],
  ['Invoice Date', 'invoiceDate'],
  ['Outlet GSTIN', 'buyerGstin'],
  ['State Code', 'placeOfSupplyState'],
  ['SKU Code', 'itemCode'],
  ['SKU Name', 'itemName'],
  ['EAN', 'ean'],
  ['HSN', 'hsnCode'],
  ['Qty', 'qty'],
  ['Free Qty', 'freeQty'],
  ['UOM', 'unit'],
  ['Rate', 'rate'],
  ['Discount', 'discount'],
  ['GST %', 'gstRate'],
  ['Batch', 'batchNo'],
  ['Expiry', 'expiryDate'],
  ['MRP', 'mrp'],
])

const ddmmyyyy = (d: Date): string => {
  const iso = isoDate(d)
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`
}
const digits = (phone: string): string => phone.replace(/^\+91/, '')
const tradeezeeCode = (r: RetailerRow): string => `TE-${r.code.replace('R-', 'P')}`
const rupees = (paise: number): string => (paise / 100).toFixed(2)

/** The TradeEzee party row of a seeded shop, exactly as the shop is on file (so a commit is a no-op update). */
function partyRow(r: RetailerRow, beatName: string, phone = digits(r.phone)): string[] {
  return [
    tradeezeeCode(r),
    r.name,
    r.ownerName,
    phone,
    r.gstin ?? '',
    '',
    `${r.name} Building`,
    '',
    'Kalyan West',
    'Kalyan',
    '421301',
    '27',
    beatName,
    `${r.name} (${r.code})`,
  ]
}

export async function seedIntegrations(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  retailersRes: RetailersResult,
  stock: StockResult,
  sales: SalesResult,
  people: PeopleResult,
): Promise<void> {
  const id = (kind: string, key: string): string => demoId(`import-${kind}`, `${tenantId}:${key}`)
  const rng = makeRng(`integrations:${tenantId}`)
  const beatName = (r: RetailerRow): string =>
    retailersRes.beats.find((b) => b.key === r.beatKey)?.name ?? ''
  const shops = retailersRes.retailers
  const byKey = new Map(variants.map((v) => [v.key, v]))
  const variant = (key: string): VariantRow => {
    const v = byKey.get(key)
    if (!v) throw new Error(`no demo variant ${key}`)
    return v
  }
  const itemVariants = [
    variant('campa-cola-750ml'),
    variant('campa-orange-750ml'),
    variant('too-yumm-karare-60g'),
    variant('balaji-simply-salted-45g'),
  ]
  const shortName = (v: VariantRow): string => v.name.replace(/\s(ml|g|L)$/i, '').slice(0, 40)
  const jobRows: (typeof importJobs.$inferInsert)[] = []
  const rowRows: (typeof importRows.$inferInsert)[] = []
  const stagedAt = (daysAgoN: number, hour: number) => atIstTime(daysAgo(daysAgoN), hour)

  /** One job with its file (written to the object store) and its rows. */
  function job(i: {
    key: string
    source: string
    target: string
    fileName: string
    header: readonly string[]
    rows: readonly (readonly string[])[]
    mapping: unknown
    status: typeof importJobs.$inferInsert.status
    requestedBy: string
    at: Date
    rowOutcome: (
      rowNo: number,
      raw: Record<string, string>,
    ) => Partial<typeof importRows.$inferInsert> & { status: typeof importRows.$inferInsert.status }
    error?: string
    dryRun?: Record<string, unknown> | null
    confirmedBy?: string
    cancel?: { reason: string }
  }): string {
    const jobId = id('job', i.key)
    const objectKey = `tenant/${tenantId}/import/${jobId}/${i.fileName}`
    writeObject(objectKey, csv(i.header, i.rows))
    const committed = i.status === 'committed' || i.status === 'confirmed'
    let ok = 0
    let errors = 0
    i.rows.forEach((cells, index) => {
      const raw: Record<string, string> = {}
      i.header.forEach((h, c) => {
        raw[h] = cells[c] ?? ''
      })
      const rowNo = index + 1
      const outcome = i.rowOutcome(rowNo, raw)
      if (outcome.status === 'committed') ok++
      if (outcome.status === 'error') errors++
      rowRows.push({
        id: rowIdFor(jobId, rowNo),
        tenantId,
        importJobId: jobId,
        rowNo,
        raw,
        candidates: [],
        ...outcome,
      })
    })
    jobRows.push({
      id: jobId,
      tenantId,
      kind: i.source,
      target: i.target,
      sourceObjectKey: objectKey,
      sourceFileName: i.fileName,
      mapping: i.mapping ?? {},
      hasHeaderRow: true,
      sourceColumns: [...i.header],
      status: i.status,
      requestedBy: i.requestedBy,
      totalRows: i.status === 'failed' ? null : i.rows.length,
      okRows: committed ? ok : 0,
      errorRows: committed ? errors : 0,
      startedAt: i.at,
      finishedAt: new Date(i.at.getTime() + 20_000),
      committedAt: committed ? new Date(i.at.getTime() + 60_000) : null,
      confirmedAt: i.status === 'confirmed' ? new Date(i.at.getTime() + 3_600_000) : null,
      confirmedBy: i.status === 'confirmed' ? (i.confirmedBy ?? i.requestedBy) : null,
      cancelledAt: i.cancel ? new Date(i.at.getTime() + 600_000) : null,
      cancelReason: i.cancel?.reason ?? null,
      error: i.error ?? null,
      dryRun: i.dryRun ?? null,
      createdAt: i.at,
      updatedAt: i.at,
    })
    return jobId
  }

  const done = (extra: Partial<Record<string, unknown>> = {}) => ({
    status: 'done',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    errors: 0,
    needsReview: 0,
    willSkip: 0,
    amountPaise: null,
    sampleErrors: [],
    ...extra,
  })

  // 1. The party master the cut-over started with: every shop on file, confirmed a fortnight ago.
  const partyShops = shops.slice(0, 10)
  job({
    key: 'party-confirmed',
    source: 'tradeezee',
    target: 'party_master',
    fileName: 'tradeezee-party-master.csv',
    header: PARTY_HEADER,
    rows: partyShops.map((r) => partyRow(r, beatName(r))),
    mapping: PARTY_MAPPING,
    status: 'confirmed',
    requestedBy: people.manager.id,
    confirmedBy: people.owner.id,
    at: stagedAt(14, 10),
    dryRun: done({ rows: 10, willCreate: 0, willUpdate: 10 }),
    rowOutcome: (rowNo) => {
      const r = nth(partyShops, rowNo - 1)
      return {
        status: 'committed',
        plan: 'update',
        retailerId: r.id,
        normalized: {
          partyCode: tradeezeeCode(r),
          partyName: r.name,
          phone: r.phone,
          stateCode: '27',
          matchedBy: 'phone',
        },
        entityType: 'retailer',
        entityId: r.id,
        before: { ownerName: r.ownerName, phone: r.phone, name: r.name, active: true },
        effects: { created: false },
      }
    },
  })

  // 2. This month's party file, staged: eight matched by phone, two the matcher could not resolve.
  const reviewShops = shops.slice(10, 20)
  job({
    key: 'party-staged',
    source: 'tradeezee',
    target: 'party_master',
    fileName: 'tradeezee-party-master-sept.csv',
    header: PARTY_HEADER,
    rows: reviewShops.map((r, i) =>
      i === 8
        ? partyRow(r, beatName(r), '98765') // a garbled mobile
        : i === 9
          ? partyRow({ ...r, name: `${r.name} Annexe` }, beatName(r), '9820099999') // a shop nobody knows
          : partyRow(r, beatName(r)),
    ),
    mapping: PARTY_MAPPING,
    status: 'staged',
    requestedBy: people.manager.id,
    at: stagedAt(1, 9),
    dryRun: done({
      rows: 10,
      willCreate: 1,
      willUpdate: 8,
      errors: 1,
      sampleErrors: [
        { rowNo: 9, field: 'phone', message: '"Mobile": "98765" is not an Indian mobile number' },
      ],
    }),
    rowOutcome: (rowNo) => {
      const r = nth(reviewShops, rowNo - 1)
      if (rowNo === 9)
        return {
          status: 'error',
          plan: null,
          normalized: { partyCode: tradeezeeCode(r), partyName: r.name, stateCode: '27' },
          error: '"Mobile": "98765" is not an Indian mobile number',
        }
      if (rowNo === 10)
        return {
          status: 'matched',
          plan: 'create',
          normalized: {
            partyCode: tradeezeeCode(r),
            partyName: `${r.name} Annexe`,
            phone: '+919820099999',
            stateCode: '27',
          },
          candidates: [
            {
              entityType: 'retailer',
              entityId: r.id,
              label: `${r.code} · ${r.name} · ${r.phone}`,
              scoreBps: 8_600,
            },
          ],
        }
      return {
        status: 'matched',
        plan: 'update',
        retailerId: r.id,
        normalized: {
          partyCode: tradeezeeCode(r),
          partyName: r.name,
          phone: r.phone,
          stateCode: '27',
          matchedBy: 'phone',
        },
        candidates: [
          {
            entityType: 'retailer',
            entityId: r.id,
            label: `${r.code} · ${r.name} · ${r.phone}`,
            scoreBps: 9_800,
          },
        ],
      }
    },
  })

  // 3. The item master: four listings matched by name, two the catalog does not have (never proposed).
  const itemRows = [
    ...itemVariants.map((v, i) => [
      `TE-I00${String(i + 1)}`,
      v.name.toUpperCase(),
      '',
      v.brandKey === 'tooyumm' ? 'Too Yumm' : v.brandKey === 'balaji' ? 'Balaji' : 'Campa',
      v.hsnCode,
      rupees(v.mrpPaise),
      String(v.defaultCaseSize),
      String(v.gstBps / 100),
      shortName(v),
    ]),
    ['TE-I005', 'PARLE G 80G', '', 'Parle', '1905', '10.00', '96', '18', 'Parle G 80'],
    [
      'TE-I006',
      'HALDIRAM BHUJIA 200G',
      '',
      'Haldiram',
      '2106',
      '55.00',
      '24',
      '12',
      'Haldiram Bhujia 200',
    ],
  ]
  job({
    key: 'items-confirmed',
    source: 'tradeezee',
    target: 'item_master',
    fileName: 'tradeezee-item-master.csv',
    header: ITEM_HEADER,
    rows: itemRows,
    mapping: ITEM_MAPPING,
    status: 'confirmed',
    requestedBy: people.owner.id,
    at: stagedAt(13, 11),
    dryRun: done({ rows: 6, willCreate: 4, willUpdate: 0, needsReview: 2 }),
    rowOutcome: (rowNo, raw) => {
      const v = itemVariants[rowNo - 1]
      if (!v)
        return {
          status: 'skipped',
          plan: null,
          normalized: { itemCode: raw['Item Code'], itemName: raw['Item Name'] },
          error: `no item in the catalog matches "${raw['Item Name'] ?? ''}"`,
        }
      return {
        status: 'committed',
        plan: 'create',
        variantId: v.id,
        normalized: {
          itemCode: raw['Item Code'],
          itemName: raw['Item Name'],
          localAlias: shortName(v),
          matchedItemBy: 'name',
        },
        entityType: 'tenant_product',
        entityId: demoId('tenant-product', v.key),
        effects: { created: true },
      }
    },
  })

  // 4. Old dues not yet carried in: six bills, staged and matched, waiting for the owner's sign-off.
  const openingHosts = [
    ...shops.filter((r) => r.tier === 'C'),
    ...shops.filter((r) => r.tier === 'B'),
  ].slice(0, 6)
  const openingBills = openingHosts.map((r, i) => ({
    shop: r,
    no: `GL/17${String(20 + i * 3).padStart(2, '0')}`,
    date: daysAgo(48 - i * 5),
    due: daysAgo(34 - i * 5),
    paise: [1_240_000, 2_875_050, 660_000, 1_912_500, 3_308_000, 985_000][i] ?? 500_000,
  }))
  job({
    key: 'outstanding-staged',
    source: 'tradeezee',
    target: 'opening_outstanding',
    fileName: 'tradeezee-outstanding.csv',
    header: OUTSTANDING_HEADER,
    rows: openingBills.map((b) => [
      tradeezeeCode(b.shop),
      b.shop.name,
      b.no,
      ddmmyyyy(b.date),
      rupees(b.paise),
      ddmmyyyy(b.due),
    ]),
    mapping: OUTSTANDING_MAPPING,
    status: 'staged',
    requestedBy: people.accountant.id,
    at: stagedAt(2, 16),
    dryRun: done({
      rows: 6,
      willCreate: 6,
      willUpdate: 0,
      amountPaise: openingBills.reduce((s, b) => s + b.paise, 0),
    }),
    rowOutcome: (rowNo) => {
      const b = nth(openingBills, rowNo - 1)
      return {
        status: 'matched',
        plan: 'create',
        retailerId: b.shop.id,
        normalized: {
          partyCode: tradeezeeCode(b.shop),
          partyName: b.shop.name,
          invoiceNo: b.no,
          invoiceDate: isoDate(b.date),
          dueDate: isoDate(b.due),
          amount: b.paise,
          retailerId: b.shop.id,
          matchedBy: 'code',
        },
        candidates: [
          {
            entityType: 'retailer',
            entityId: b.shop.id,
            label: `${b.shop.code} · ${b.shop.name} · ${b.shop.phone}`,
            scoreBps: 10_000,
          },
        ],
      }
    },
  })

  // 5. The sales register: forty old bill lines → buying history, confirmed. No money, no stock.
  const historyRows: {
    shop: RetailerRow
    v: VariantRow
    no: string
    date: Date
    qtyPcs: number
    rate: number
  }[] = []
  for (let n = 0; n < 40; n++) {
    const shop = pick(rng, shops)
    const v = pick(rng, itemVariants)
    const cases = randInt(rng, 1, 4)
    historyRows.push({
      shop,
      v,
      no: `GL/15${String(10 + n).padStart(2, '0')}`,
      date: daysAgo(120 - n * 2),
      qtyPcs: cases * v.defaultCaseSize,
      rate: Math.round((v.mrpPaise * 0.86) / (1 + (v.gstBps + v.cessBps) / 10_000)),
    })
  }
  const salesJob = job({
    key: 'sales-confirmed',
    source: 'tradeezee',
    target: 'sales_register',
    fileName: 'tradeezee-sales-register.csv',
    header: SALES_HEADER,
    rows: historyRows.map((h) => [
      tradeezeeCode(h.shop),
      h.shop.name,
      h.no,
      ddmmyyyy(h.date),
      `TE-I00${String(itemVariants.indexOf(h.v) + 1)}`,
      shortName(h.v),
      String(h.qtyPcs / h.v.defaultCaseSize),
      'CS',
      rupees(h.rate * h.v.defaultCaseSize),
    ]),
    mapping: SALES_MAPPING,
    status: 'confirmed',
    requestedBy: people.manager.id,
    at: stagedAt(12, 15),
    dryRun: done({ rows: 40, willCreate: 40, willUpdate: 0 }),
    rowOutcome: (rowNo) => {
      const h = nth(historyRows, rowNo - 1)
      return {
        status: 'committed',
        plan: 'create',
        retailerId: h.shop.id,
        variantId: h.v.id,
        normalized: {
          invoiceNo: h.no,
          invoiceDate: isoDate(h.date),
          qtyPcs: h.qtyPcs,
          ratePaise: h.rate,
          retailerId: h.shop.id,
          variantId: h.v.id,
          matchedBy: 'code',
          matchedItemBy: 'alias',
        },
        entityType: 'purchase_history',
        entityId: id('history', String(rowNo)),
      }
    },
  })

  // 6. Too Yumm's FieldAssist export: one bill already captured by billing's seed, the rest overlapping.
  const dmsShop = nth(shops, 12)
  const karare = variant('too-yumm-karare-60g')
  const faRows = [
    [
      `FA-OUT-${String(13).padStart(4, '0')}`,
      dmsShop.name,
      'TY/26-27/00412',
      isoDate(daysAgo(6)),
      dmsShop.gstin ?? '',
      '27',
      'TY-KAR-60',
      karare.name,
      '',
      karare.hsnCode,
      '96',
      '0',
      'PCS',
      '17.00',
      '0',
      '12',
      'TY26H',
      '2027-02-20',
      rupees(karare.mrpPaise),
    ],
    [
      `FA-OUT-${String(13).padStart(4, '0')}`,
      dmsShop.name,
      'TY/26-27/00398',
      isoDate(daysAgo(20)),
      dmsShop.gstin ?? '',
      '27',
      'TY-KAR-60',
      karare.name,
      '',
      karare.hsnCode,
      '48',
      '0',
      'PCS',
      '17.00',
      '0',
      '12',
      'TY26G',
      '2027-01-15',
      rupees(karare.mrpPaise),
    ],
    [
      `FA-OUT-0002`,
      nth(shops, 1).name,
      'TY/26-27/00399',
      isoDate(daysAgo(20)),
      nth(shops, 1).gstin ?? '',
      '27',
      'TY-KAR-60',
      karare.name,
      '',
      karare.hsnCode,
      '48',
      '0',
      'PCS',
      '17.00',
      '0',
      '12',
      'TY26G',
      '2027-01-15',
      rupees(karare.mrpPaise),
    ],
  ]
  job({
    key: 'fieldassist-confirmed',
    source: 'fieldassist',
    target: 'brand_dms_invoices',
    fileName: 'fieldassist-invoices-aug.csv',
    header: FA_HEADER,
    rows: faRows,
    mapping: FA_MAPPING,
    status: 'confirmed',
    requestedBy: people.accountant.id,
    confirmedBy: people.manager.id,
    at: stagedAt(5, 18),
    dryRun: done({
      rows: 3,
      willCreate: 1,
      willUpdate: 0,
      willSkip: 2,
      amountPaise: Math.round(96 * 1700 * 1.12),
    }),
    rowOutcome: (rowNo, raw) => {
      const shop = rowNo === 3 ? nth(shops, 1) : dmsShop
      const base = {
        retailerId: shop.id,
        variantId: karare.id,
        normalized: {
          partyCode: raw['Outlet Code'],
          invoiceNo: raw['Invoice No'],
          invoiceDate: raw['Invoice Date'],
          qtyPcs: Number(raw.Qty),
          ratePaise: 1700,
          gstRate: 1200,
          matchedBy: 'code',
          matchedItemBy: 'name',
        },
      }
      if (rowNo === 1)
        return {
          ...base,
          status: 'committed',
          plan: 'create',
          entityType: 'invoice',
          entityId: demoId('invoice', 'brand-dms'),
          effects: {},
        }
      return {
        ...base,
        status: 'skipped',
        plan: 'skip',
        error: `bill ${raw['Invoice No'] ?? ''} is already on file`,
      }
    },
  })

  // 7. Two abandoned uploads: a mis-mapped file the operator cancelled, and a file that was not a CSV at all.
  job({
    key: 'party-cancelled',
    source: 'marg',
    target: 'party_master',
    fileName: 'marg-parties.csv',
    header: PARTY_HEADER,
    rows: shops.slice(20, 23).map((r) => partyRow(r, beatName(r))),
    mapping: PARTY_MAPPING,
    status: 'cancelled',
    requestedBy: people.manager.id,
    at: stagedAt(9, 12),
    cancel: { reason: 'wrong file — this was the Marg export of another firm' },
    rowOutcome: () => ({ status: 'staged', plan: null }),
  })
  job({
    key: 'items-failed',
    source: 'excel',
    target: 'item_master',
    fileName: 'items.pdf',
    header: ['col_1'],
    rows: [],
    mapping: null,
    status: 'failed',
    requestedBy: people.manager.id,
    at: stagedAt(8, 12),
    error: 'the file is neither a CSV nor an XLSX workbook',
    rowOutcome: () => ({ status: 'staged', plan: null }),
  })

  await insertMany(db, importJobs, jobRows)
  await insertMany(db, importRows, rowRows)

  // The buying history the confirmed sales-register job wrote (docs/17 A11).
  await insertMany(
    db,
    retailerPurchaseHistory,
    historyRows.map((h, i) => ({
      id: id('history', String(i + 1)),
      tenantId,
      retailerId: h.shop.id,
      variantId: h.v.id,
      invoiceNo: h.no,
      invoiceDate: isoDate(h.date),
      qtyPcs: h.qtyPcs,
      ratePaise: h.rate,
      source: 'migration',
      importJobId: salesJob,
    })),
  )

  // The codes the confirmed party master learned (`tradeezee`) and the FieldAssist outlet codes the
  // importer matches on (`fieldassist`; the retailers seed's `field_assist` rows are the DMS's own view).
  await insertMany(db, externalPartyCodes, [
    ...partyShops.map((r) => ({
      id: id('code', `tradeezee:${r.code}`),
      tenantId,
      system: 'tradeezee',
      code: tradeezeeCode(r),
      retailerId: r.id,
    })),
    ...shops.slice(0, 14).map((r, i) => ({
      id: id('code', `fieldassist:${r.code}`),
      tenantId,
      system: 'fieldassist',
      code: `FA-OUT-${String(i + 1).padStart(4, '0')}`,
      retailerId: r.id,
    })),
  ])

  // 8. The CA's Tally names: stock items, godowns, units, voucher types, the round-off ledger.
  await insertMany(db, tallyMappings, [
    ...variants.slice(0, 10).map((v) => ({
      id: id('tally', `stock_item:${v.key}`),
      tenantId,
      entityType: 'stock_item',
      entityId: v.id,
      tallyName: v.name,
      tallyParent:
        v.brandKey === 'tooyumm' ? 'Too Yumm' : v.brandKey === 'balaji' ? 'Balaji' : 'Campa',
    })),
    {
      id: id('tally', 'godown:main'),
      tenantId,
      entityType: 'godown',
      entityId: stock.godownId,
      tallyName: 'Main Godown',
      tallyParent: null,
    },
    {
      id: id('tally', 'godown:damaged'),
      tenantId,
      entityType: 'godown',
      entityId: stock.damagedId,
      tallyName: 'Damaged Stock',
      tallyParent: null,
    },
    {
      id: id('tally', 'unit:pcs'),
      tenantId,
      entityType: 'unit',
      entityId: 'PCS',
      tallyName: 'Pcs',
      tallyParent: null,
    },
    {
      id: id('tally', 'unit:case'),
      tenantId,
      entityType: 'unit',
      entityId: 'CASE',
      tallyName: 'Case',
      tallyParent: null,
    },
    {
      id: id('tally', 'voucher:sales'),
      tenantId,
      entityType: 'voucher_type',
      entityId: 'sales',
      tallyName: 'Sales',
      tallyParent: null,
    },
    {
      id: id('tally', 'voucher:receipts'),
      tenantId,
      entityType: 'voucher_type',
      entityId: 'receipts',
      tallyName: 'Receipt',
      tallyParent: null,
    },
    {
      id: id('tally', 'voucher:purchases'),
      tenantId,
      entityType: 'voucher_type',
      entityId: 'purchases',
      tallyName: 'Purchase',
      tallyParent: null,
    },
    {
      id: id('tally', 'voucher:credit_note'),
      tenantId,
      entityType: 'voucher_type',
      entityId: 'credit_note',
      tallyName: 'Credit Note',
      tallyParent: null,
    },
    {
      id: id('tally', 'ledger:ROUND_OFF'),
      tenantId,
      entityType: 'ledger',
      entityId: 'ROUND_OFF',
      tallyName: 'Round Off',
      tallyParent: 'Indirect Expenses',
    },
  ])

  // 9. One Tally export that finished (the first seeded week), its file in the object store and its
  //    sync ledger, plus two exports still queued for the worker.
  const exportId = id('export', 'tally-week-1')
  const oldest = [...sales.invoices].sort(
    (a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime(),
  )
  const from = isoDate(oldest[0]?.invoiceDate ?? daysAgo(14))
  const to = isoDate(new Date((oldest[0]?.invoiceDate ?? daysAgo(14)).getTime() + 6 * 86_400_000))
  const weekInvoices = oldest.filter((i) => isoDate(i.invoiceDate) <= to)
  const weekReceipts = await db
    .select({ id: receipts.id, receiptNo: receipts.receiptNo })
    .from(receipts)
    .where(and(eq(receipts.tenantId, tenantId), eq(receipts.status, 'deposited')))
    // `receivedAt` ties across receipts; `id` makes the five the export names the same every run.
    .orderBy(asc(receipts.receivedAt), asc(receipts.id))
    .limit(5)
  const exportKey = `tenant/${tenantId}/exports/${exportId}/tally-${from}-to-${to}.xml`
  const guid = (docType: string, docId: string): string => {
    const hex = createHash('sha256').update(`${tenantId}:${docType}:${docId}`).digest('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  }
  writeObject(
    exportKey,
    `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>Tarsun Enterprises</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${weekInvoices
      .map(
        (i) =>
          `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER REMOTEID="${guid('invoice', i.id)}" VCHTYPE="Sales" ACTION="Create"><DATE>${isoDate(i.invoiceDate).replace(/-/g, '')}</DATE><GUID>${guid('invoice', i.id)}</GUID><VOUCHERNUMBER>${i.invoiceNo}</VOUCHERNUMBER></VOUCHER></TALLYMESSAGE>`,
      )
      .join('')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`,
  )
  const exportedAt = stagedAt(7, 19)
  await insertMany(db, exportJobs, [
    {
      id: exportId,
      tenantId,
      kind: 'tally_xml',
      params: { from, to, voucherTypes: ['sales', 'receipts', 'purchases'] },
      status: 'succeeded',
      requestedBy: people.accountant.id,
      objectKey: exportKey,
      rowCount: weekInvoices.length + weekReceipts.length,
      startedAt: exportedAt,
      finishedAt: new Date(exportedAt.getTime() + 4_000),
      createdAt: exportedAt,
      updatedAt: exportedAt,
    },
    {
      id: id('export', 'gstr1-queued'),
      tenantId,
      kind: 'gstr1_json',
      params: { from: isoDate(daysAgo(34)), to: isoDate(daysAgo(4)), supplyType: 'all' },
      status: 'queued',
      requestedBy: people.accountant.id,
      createdAt: stagedAt(0, 9),
      updatedAt: stagedAt(0, 9),
    },
    {
      id: id('export', 'outstanding-queued'),
      tenantId,
      kind: 'outstanding_xlsx',
      params: { from: isoDate(daysAgo(0)), to: isoDate(daysAgo(0)) },
      status: 'queued',
      requestedBy: people.owner.id,
      createdAt: stagedAt(0, 9),
      updatedAt: stagedAt(0, 9),
    },
  ])
  await insertMany(db, tallySyncLedger, [
    ...weekInvoices.map((i) => ({
      id: id('sync', `invoice:${i.id}`),
      tenantId,
      docType: 'invoice',
      docId: i.id,
      tallyGuid: guid('invoice', i.id),
      tallyVoucherId: i.invoiceNo,
      exportJobId: exportId,
      exportedAt,
      contentHash: createHash('sha256')
        .update(`${i.id}:${String(i.totalPaise)}`)
        .digest('hex'),
    })),
    ...weekReceipts.map((r) => ({
      id: id('sync', `receipt:${r.id}`),
      tenantId,
      docType: 'receipt',
      docId: r.id,
      tallyGuid: guid('receipt', r.id),
      tallyVoucherId: r.receiptNo,
      exportJobId: exportId,
      exportedAt,
      contentHash: createHash('sha256').update(r.id).digest('hex'),
    })),
  ])
}
