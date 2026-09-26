import { describe, expect, it } from 'vitest'
import { buildPlan, DEFAULT_HSN_FALLBACK, type PlanInput, type PlanOptions } from './plan.js'
import { similarPairs, similarity, trigrams } from './similar.js'
import { gstin } from './testing.js'
import type { LegacyBill, LegacyCustomer, LegacyItem, LegacySalesGstRow } from './types.js'

const options: PlanOptions = {
  asOf: '2026-09-26',
  ratesFrom: '2025-09-22',
  hsnFallback: DEFAULT_HSN_FALLBACK,
  defaultState: '27',
}

let row = 1
const item = (over: Partial<LegacyItem> = {}): LegacyItem => ({
  code: `T${String(row)}`,
  title: `TEST ITEM ${String(row)}`,
  packLabel: 'EACH',
  unitKind: 'each',
  mfgCode: 'TM',
  mfgName: 'TEST MAKER LTD',
  gstBps: 500,
  hsnRaw: '19053100',
  salePaise: 416,
  mrpPaise: 500,
  active: true,
  row: ++row,
  ...over,
})

const customer = (over: Partial<LegacyCustomer> = {}): LegacyCustomer => ({
  code: '11001',
  name: 'TEST SHOP ONE',
  address1: 'FLAT 1',
  address2: 'NEAR CIRCLE',
  address3: '',
  // one phone per code, so a spec sees "shared" only where it says so
  phoneRaw: `90000${(over.code ?? '11001').padStart(5, '0')}`,
  altPhoneRaw: '',
  areaName: 'TEST AREA',
  pincode: '421301',
  gstinRaw: '',
  ownerName: '',
  email: '',
  pan: '',
  stateCode: '27',
  foodLicense: '',
  ...over,
})

const bill = (over: Partial<LegacyBill> = {}): LegacyBill => ({
  bookCode: 'GL',
  salYear: '2026',
  billNo: '101',
  cashAcc: '11001',
  title: 'TEST SHOP ONE',
  areaName: 'TEST AREA',
  salesman: '',
  billDate: '2026-06-04',
  dueDate: '2026-06-04',
  amountPaise: 450_000,
  receivedPaise: 0,
  creditDays: 0,
  row: ++row,
  ...over,
})

const plan = (input: Partial<PlanInput> = {}, opts: Partial<PlanOptions> = {}) =>
  buildPlan(
    { items: [], customers: [], bills: [], salesGst: [], ...input },
    { ...options, ...opts },
  )

const kinds = (p: ReturnType<typeof plan>): string[] => p.issues.map((i) => i.kind).sort()

describe('items and HSN rates', () => {
  it('plans one product per item with one rate per HSN heading', () => {
    const p = plan({
      items: [
        item({ code: 'A', hsnRaw: '19053100' }),
        item({ code: 'B', hsnRaw: '19053100' }),
        item({ code: 'C', hsnRaw: '20052000', gstBps: 1200 }),
      ],
    })
    expect(p.items.map((i) => i.code)).toEqual(['A', 'B', 'C'])
    expect(p.hsnRates).toEqual([
      { hsn: '19053100', gstBps: 500, items: 2 },
      { hsn: '20052000', gstBps: 1200, items: 1 },
    ])
    expect(p.manufacturers).toEqual([{ name: 'TEST MAKER LTD', code: 'TM' }])
  })

  it('S-176: a heading the list gives two rates keeps the majority and refuses the rest', () => {
    const p = plan({
      items: [
        item({ code: 'A', hsnRaw: '22029990', gstBps: 500 }),
        item({ code: 'B', hsnRaw: '22029990', gstBps: 500 }),
        item({ code: 'C', hsnRaw: '22029990', gstBps: 4000 }),
      ],
    })
    expect(p.items.map((i) => i.code)).toEqual(['A', 'B'])
    expect(p.hsnRates).toEqual([{ hsn: '22029990', gstBps: 500, items: 2 }])
    expect(kinds(p)).toEqual(['hsn-rate-conflict'])
  })

  it('restores a leading zero from the sheet, and trusts the backup where it has the text', () => {
    const sheetOnly = plan({ items: [item({ code: 'A', hsnRaw: '8135020' })] })
    expect(sheetOnly.items[0]).toMatchObject({ hsn: '08135020', hsnAssumed: true })
    expect(kinds(sheetOnly)).toEqual(['hsn-padded'])
    const withBackup = plan({
      items: [item({ code: 'A', hsnRaw: '8135020' })],
      itemExtras: new Map([
        [
          'A',
          {
            hsn: '08135020',
            closingQty: null,
            purchaseRatePaise: null,
            landedCostPaise: null,
            mrpPaise: null,
            supplierCode: null,
            active: null,
          },
        ],
      ]),
    })
    expect(withBackup.items[0]).toMatchObject({ hsn: '08135020', hsnAssumed: false })
    expect(kinds(withBackup)).toEqual([])
  })

  it('gives an item with no HSN the heading for its rate, and says so; or skips it when told not to', () => {
    const noHsn = [
      item({ code: 'A', hsnRaw: null, gstBps: 4000 }),
      item({ code: 'B', hsnRaw: null, gstBps: 500 }),
    ]
    const withFallback = plan({ items: noHsn })
    expect(withFallback.items.map((i) => [i.code, i.hsn, i.hsnAssumed])).toEqual([
      ['A', '2202', true],
      ['B', '22029920', true],
    ])
    expect(kinds(withFallback)).toEqual(['hsn-assumed', 'hsn-assumed'])
    const strict = plan({ items: noHsn }, { hsnFallback: null })
    expect(strict.items).toEqual([])
    expect(kinds(strict)).toEqual(['missing-hsn', 'missing-hsn'])
  })

  it('lists only items that are active AND priced; the backup can also retire an item', () => {
    const p = plan({
      items: [
        item({ code: 'A' }),
        item({ code: 'B', salePaise: null }),
        item({ code: 'C', active: false }),
        item({ code: 'D' }),
      ],
      itemExtras: new Map([
        [
          'D',
          {
            hsn: '',
            closingQty: 12,
            purchaseRatePaise: 350,
            landedCostPaise: 360,
            mrpPaise: 500,
            supplierCode: 'GK',
            active: false,
          },
        ],
      ]),
    })
    expect(p.items.map((i) => [i.code, i.listed])).toEqual([
      ['A', true],
      ['B', false],
      ['C', false],
      ['D', false],
    ])
    expect(p.items[3]).toMatchObject({
      openingQty: 12,
      purchaseRatePaise: 350,
      landedCostPaise: 360,
      supplierCode: 'GK',
    })
  })

  it('uses the latest purchase MRP only when the list has none', () => {
    const extras = new Map([
      [
        'A',
        {
          hsn: '',
          closingQty: null,
          purchaseRatePaise: null,
          landedCostPaise: null,
          mrpPaise: 777,
          supplierCode: null,
          active: null,
        },
      ],
      [
        'B',
        {
          hsn: '',
          closingQty: null,
          purchaseRatePaise: null,
          landedCostPaise: null,
          mrpPaise: 777,
          supplierCode: null,
          active: null,
        },
      ],
    ])
    const p = plan({
      items: [item({ code: 'A', mrpPaise: null }), item({ code: 'B', mrpPaise: 500 })],
      itemExtras: extras,
    })
    expect(p.items.map((i) => i.mrpPaise)).toEqual([777, 500])
  })
})

describe('shops', () => {
  it('normalises the phone, keeps the GSTIN only when its check digit holds, and derives the state from it', () => {
    const good = gstin('24ABCDE1234F1Z')
    const p = plan({
      customers: [
        customer({ code: '1', name: 'SHOP A', phoneRaw: '09000000001', gstinRaw: good }),
        customer({ code: '2', name: 'SHOP B', phoneRaw: '0', gstinRaw: '24ABCDE1234F1ZX' }),
        customer({ code: '3', name: 'SHOP C', phoneRaw: 'not a number' }),
      ],
    })
    expect(p.retailers[0]).toMatchObject({ phone: '+919000000001', gstin: good, stateCode: '24' })
    expect(p.retailers[1]).toMatchObject({ phone: '', gstin: null, stateCode: '27' })
    expect(p.retailers[2]?.phone).toBe('')
    expect(kinds(p)).toEqual(['bad-gstin', 'bad-phone', 'missing-phone'])
  })

  it('takes a missing GSTIN and the state from the GST register, and flags a register that contradicts the GSTIN', () => {
    const good = gstin('27ABCDE1234F1Z')
    const reg = (cashAcc: string, gst: string, state: string): LegacySalesGstRow => ({
      cashAcc,
      gstinRaw: gst,
      stateLabel: state,
      billNo: '1',
      billDate: '2026-08-01',
      taxablePaise: 100,
      totalPaise: 105,
      gstSlabBps: 500,
      row: 2,
    })
    const own = gstin('27ABCDE1234G1Z')
    const p = plan({
      customers: [
        customer({ code: '1', name: 'SHOP A', stateCode: '' }),
        customer({ code: '2', name: 'SHOP B', gstinRaw: own, stateCode: '' }),
      ],
      salesGst: [reg('1', good, '27 - Maharashtra'), reg('2', '', '24 - Gujarat')],
    })
    expect(p.retailers[0]).toMatchObject({ gstin: good, stateCode: '27' })
    expect(p.retailers[1]).toMatchObject({ gstin: own, stateCode: '27' })
    expect(kinds(p)).toEqual(['gstin-state-mismatch'])
  })

  it('builds the address and one beat per area', () => {
    const p = plan({
      customers: [
        customer({ code: '1', name: 'SHOP A', address3: 'LANE 3', pincode: '421301' }),
        customer({ code: '2', name: 'SHOP B', areaName: 'test  area', pincode: '0' }),
        customer({ code: '3', name: 'SHOP C', areaName: '' }),
      ],
    })
    expect(p.retailers[0]?.address).toEqual({
      line1: 'FLAT 1',
      line2: 'NEAR CIRCLE, LANE 3',
      area: 'TEST AREA',
      pincode: '421301',
    })
    expect(p.retailers[1]?.address).not.toHaveProperty('pincode')
    expect(p.retailers[1]?.beatName).toBe('TEST AREA')
    expect(p.retailers[2]?.beatName).toBeNull()
    expect(p.beats).toEqual(['TEST AREA'])
    expect(kinds(p)).toContain('blank-area')
  })

  it('reports probable duplicates, shared phones and shared GSTINs without merging anything', () => {
    const g = gstin('27ABCDE1234F1Z')
    const p = plan({
      customers: [
        customer({
          code: '1',
          name: 'SHREE GANESH KIRANA STORE',
          phoneRaw: '9000000001',
          gstinRaw: g,
        }),
        customer({
          code: '2',
          name: 'Shree Ganesh Kirana Stores',
          phoneRaw: '9000000001',
          gstinRaw: g,
        }),
        customer({ code: '3', name: 'OM TEST DAIRY', phoneRaw: '9000000002' }),
      ],
    })
    expect(p.retailers).toHaveLength(3)
    expect(kinds(p)).toEqual(['possible-duplicate-customer', 'shared-gstin', 'shared-phone'])
  })

  it('takes the first of a repeated customer code and refuses a nameless one', () => {
    const p = plan({
      customers: [
        customer({ code: '1' }),
        customer({ code: '1', name: 'OTHER' }),
        customer({ code: '2', name: ' ' }),
      ],
    })
    expect(p.retailers.map((r) => r.code)).toEqual(['1'])
    expect(kinds(p)).toEqual(['record-incomplete'])
  })
})

describe('opening bills', () => {
  const shops = { customers: [customer(), customer({ code: '11002', name: 'TEST SHOP TWO' })] }

  it('carries what is still owed, and says when a receipt was part of it', () => {
    const p = plan({
      ...shops,
      bills: [
        bill({ billNo: '1', amountPaise: 336_000, receivedPaise: 316_000 }),
        bill({ billNo: '2' }),
      ],
    })
    expect(p.bills.map((b) => [b.billNo, b.openPaise, b.originalPaise, b.receivedPaise])).toEqual([
      ['1', 20_000, 336_000, 316_000],
      ['2', 450_000, 450_000, 0],
    ])
    expect(kinds(p)).toEqual(['partly-received-bill'])
  })

  it('imports nothing for a settled bill or one received in excess, and reports both', () => {
    const p = plan({
      ...shops,
      bills: [
        bill({ billNo: '1', amountPaise: 1000, receivedPaise: 1000 }),
        bill({ billNo: '2', amountPaise: 1000, receivedPaise: 1500 }),
      ],
    })
    expect(p.bills).toEqual([])
    expect(kinds(p)).toEqual(['over-received-bill', 'settled-bill'])
  })

  it('skips a bill whose customer is not in the master, and counts a name that differs', () => {
    const p = plan({
      ...shops,
      bills: [bill({ billNo: '1', cashAcc: '99999' }), bill({ billNo: '2', title: 'TEST SHOP 1' })],
    })
    expect(p.bills.map((b) => b.billNo)).toEqual(['2'])
    expect(kinds(p)).toEqual(['name-differs-from-master', 'unknown-customer'])
  })

  it('keeps two bills that would print one number apart by book and year', () => {
    const p = plan({
      ...shops,
      bills: [bill({ billNo: '7' }), bill({ billNo: '7', salYear: '2027' }), bill({ billNo: '8' })],
    })
    expect(p.bills.map((b) => b.invoiceNo)).toEqual(['GL-2026-7', 'GL-2027-7', '8'])
  })

  it('adds the areas of bills to the beats', () => {
    const p = plan({ ...shops, bills: [bill({ areaName: 'A BILL-ONLY AREA' })] })
    expect(p.beats).toContain('A BILL-ONLY AREA')
  })
})

describe('similarity', () => {
  it('scores near-identical names high and unrelated names low', () => {
    expect(
      similarity(trigrams('Shree Ganesh Kirana'), trigrams('SHREE GANESH KIRANA STORE')),
    ).toBeGreaterThan(0.6)
    expect(similarity(trigrams('Om Dairy'), trigrams('Bikaner Sweets'))).toBeLessThan(0.2)
    expect(similarity(new Set(), trigrams('x'))).toBe(0)
  })
  it('marks names equal once punctuation and spacing are gone as exact', () => {
    expect(similarPairs(['A-B  C', 'a b c', 'zzz'])).toEqual([{ a: 0, b: 1, exact: true }])
  })
})
