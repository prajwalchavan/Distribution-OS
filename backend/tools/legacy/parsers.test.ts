import { describe, expect, it } from 'vitest'
import { mergeCustomers, parseCustomerMasterText } from './customers.js'
import { billKey, outstandingRecords, parseOutstandingRows } from './outstanding.js'
import { parseProductRows, productRecords, unitKindOf } from './products.js'
import { parseSalesGstRows, salesGstFacts, salesGstRecords } from './sales-gst.js'
import { LegacyFormatError, sheetRecords } from './sheets.js'
import { grid } from './testing.js'

const PRODUCT_HEADERS = [
  'ITEM_CODE',
  'ITEM_TITLE',
  'ITEM_PACK',
  'SDISP_TAX',
  'MFG_CODE',
  'MFG_NAME',
  'GST',
  'HSN_NO',
  'Status',
  'SALE_PRICE',
  'MRP_PRICE',
]
const product = (over: Partial<Record<(typeof PRODUCT_HEADERS)[number], string | number>> = {}) =>
  PRODUCT_HEADERS.map((h) => {
    const base: Record<string, string | number> = {
      ITEM_CODE: 'T001',
      ITEM_TITLE: 'TEST BISCUIT 50G',
      ITEM_PACK: 'EACH',
      SDISP_TAX: 0,
      MFG_CODE: 'TM',
      MFG_NAME: 'TEST MAKER LTD',
      GST: 5,
      HSN_NO: 19053100,
      Status: 'ACTIVE',
      SALE_PRICE: 4.16,
      MRP_PRICE: 5,
    }
    return over[h] ?? base[h] ?? ''
  })

describe('sheetRecords', () => {
  it('keys cells by upper-cased header and skips blank rows', () => {
    const rows = sheetRecords(
      grid(
        ['a', 'B'],
        [
          [1, 2],
          ['', ''],
          [3, 4],
        ],
      ),
      ['A', 'b'],
      'test',
    )
    expect(rows.map((r) => r.row)).toEqual([2, 4])
    expect(rows[1]?.cells.get('B')).toBe('4')
  })
  it('names the missing COLUMNS, never a cell, when a re-export renames one', () => {
    expect(() => sheetRecords(grid(['A'], [[1]]), ['A', 'B', 'C'], 'the list')).toThrow(
      new LegacyFormatError('the list: missing column(s) B, C'),
    )
    expect(() => sheetRecords([], ['A'], 'the list')).toThrow(/empty/)
  })
})

describe('product list', () => {
  const parse = (rows: (string | number)[][]) =>
    parseProductRows(productRecords(grid(PRODUCT_HEADERS, rows)))

  it('reads an item with its unit, rate, prices and status', () => {
    const { items, issues } = parse([product()])
    expect(issues).toEqual([])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      code: 'T001',
      title: 'TEST BISCUIT 50G',
      unitKind: 'each',
      gstBps: 500,
      hsnRaw: '19053100',
      salePaise: 416,
      mrpPaise: 500,
      active: true,
      mfgName: 'TEST MAKER LTD',
    })
  })

  it('classifies the price unit; a size label is "other" (its price is still per carton)', () => {
    expect(unitKindOf('EACH')).toBe('each')
    expect(unitKindOf('Case')).toBe('case')
    expect(unitKindOf('CASES')).toBe('case')
    expect(unitKindOf('250ML')).toBe('other')
    expect(unitKindOf('1LTR P')).toBe('other')
  })

  it('flags what is missing or odd without dropping the item', () => {
    const { items, issues } = parse([
      product({ ITEM_CODE: 'A', SALE_PRICE: '', MRP_PRICE: '' }),
      product({ ITEM_CODE: 'B', SALE_PRICE: 9, MRP_PRICE: 5 }),
      product({ ITEM_CODE: 'C', SALE_PRICE: 2, MRP_PRICE: 10 }),
      product({ ITEM_CODE: 'D', Status: 'INACTIVE' }),
    ])
    expect(items.map((i) => i.code)).toEqual(['A', 'B', 'C', 'D'])
    expect(items[0]).toMatchObject({ salePaise: null, mrpPaise: null })
    expect(issues.map((i) => i.kind).sort()).toEqual(
      [
        'inactive-item',
        'missing-mrp',
        'missing-price',
        'price-above-mrp',
        'price-below-half-mrp',
      ].sort(),
    )
  })

  it('drops a duplicate item code, a row with no code and a row with no GST rate', () => {
    const { items, issues } = parse([
      product({ ITEM_CODE: 'A' }),
      product({ ITEM_CODE: 'A' }),
      product({ ITEM_CODE: '' }),
      product({ ITEM_CODE: 'B', GST: '' }),
    ])
    expect(items.map((i) => i.code)).toEqual(['A'])
    expect(issues.map((i) => i.kind).sort()).toEqual([
      'bad-amount',
      'duplicate-item-code',
      'record-incomplete',
    ])
  })

  it('refuses a sheet whose columns were renamed', () => {
    expect(() => productRecords(grid(['ITEM_CODE'], [['A']]))).toThrow(/missing column/)
  })
})

const OUT_HEADERS = [
  'BOOK_CODE',
  'BILL_NO',
  'SAL_YEAR',
  'CASH_ACC',
  'ACC_TITLE',
  'AREA_NAME',
  'SALESMAN',
  'BILL_DATE',
  'DUE_DATE',
  'SAL_AMT',
  'TOT_RCT',
  'CRDAYS',
]
const bill = (over: Record<string, string | number> = {}) =>
  OUT_HEADERS.map(
    (h) =>
      over[h] ??
      (
        {
          BOOK_CODE: 'GL',
          BILL_NO: 101,
          SAL_YEAR: 2026,
          CASH_ACC: 11001,
          ACC_TITLE: 'TEST SHOP ONE',
          AREA_NAME: 'TEST AREA',
          SALESMAN: '',
          BILL_DATE: '2026-06-04',
          DUE_DATE: '2026-06-04',
          SAL_AMT: 4500,
          TOT_RCT: 0,
          CRDAYS: 0,
        } as Record<string, string | number>
      )[h] ??
      '',
  )

describe('outstanding report', () => {
  const parse = (rows: (string | number)[][]) =>
    parseOutstandingRows(outstandingRecords(grid(OUT_HEADERS, rows)))

  it('reads a bill keyed by book, year and number', () => {
    const { items, issues } = parse([bill()])
    expect(issues).toEqual([])
    expect(items[0]).toMatchObject({
      bookCode: 'GL',
      salYear: '2026',
      billNo: '101',
      cashAcc: '11001',
      billDate: '2026-06-04',
      amountPaise: 450_000,
      receivedPaise: 0,
    })
    expect(billKey(items[0] as never)).toBe('GL|2026|101')
  })

  it('keeps the partial receipt and refuses a repeat of the same bill key', () => {
    const { items, issues } = parse([bill({ TOT_RCT: 3160.5 }), bill()])
    expect(items).toHaveLength(1)
    expect(items[0]?.receivedPaise).toBe(316_050)
    expect(issues.map((i) => i.kind)).toEqual(['duplicate-bill'])
  })

  it('reports an unreadable amount or date and skips the row', () => {
    const { items, issues } = parse([
      bill({ BILL_NO: 1, SAL_AMT: 'abc' }),
      bill({ BILL_NO: 2, BILL_DATE: 'soon' }),
      bill({ BILL_NO: 3, CASH_ACC: '' }),
    ])
    expect(items).toEqual([])
    expect(issues.map((i) => i.kind).sort()).toEqual([
      'bad-amount',
      'bad-date',
      'record-incomplete',
    ])
  })
})

describe('sales GST register', () => {
  const headers = [
    'GST',
    'ACC_TITLE',
    'STATE',
    'BILL_NO',
    'BILL_DATE',
    'CASH_ACC',
    'STAXABLE_AMT',
    'ITAX_RATE',
    'AMT',
  ]
  it('summarises bills, customers and slabs; a two-slab bill is one bill', () => {
    const { items } = parseSalesGstRows(
      salesGstRecords(
        grid(headers, [
          ['', 'A', '27 - Maharashtra', 1, '2026-08-01', 11001, 100, 5, 105],
          ['', 'A', '27 - Maharashtra', 2, '2026-08-02', 11001, 50, 5, 52.5],
          ['', 'B', '27 - Maharashtra', 2, '2026-08-02', 11001, 50, 40, 70],
          ['', 'C', '27 - Maharashtra', 3, '2026-08-31', 11002, 10, 5, 10.5],
        ]),
      ),
    )
    const facts = salesGstFacts(items)
    expect(facts).toMatchObject({
      rows: 4,
      distinctBills: 3,
      customers: 2,
      multiSlabBills: 1,
      slabsBps: [500, 4000],
      from: '2026-08-01',
      to: '2026-08-31',
    })
  })
})

const PDF_TEXT = `
  TEST FIRM ENTERPRISES                                              FY :  2026-2027    Friday, 18 Sep, 2026

AccountWise ListWithAll Details2

CODE      PARTY NAME


11001       TEST SHOP ONE  KHADAKPADA
           Address Line1         : FLAT 1 TEST BUILDING
           Address Line2         : NEAR TEST CIRCLE                                          Telephone no:        9000000001
           Address line 3        :
           Area Name             : TEST AREA                                                 Pincode  :           421301
           GST NO.               :
           Food License          : NA                                                        Valid Upto :        31/12/2030
11002       TEST SHOP TWO
           Address Line1         : SHOP 2
           Address Line2         :                                                           Telephone no:        0
           Address line 3        : LANE 3
           Area Name             : OTHER AREA                                                Pincode  :           0
           GST NO.               : 27ABCDE1234F1Z5
           Food License          : 1234                                                      Valid Upto :        31/12/2031
Powered By: Test Software                                                                          Page 1 of 1
`

describe('customer master (PDF text, layout mode)', () => {
  it('reads one record per header and every labelled line under it', () => {
    const { items, issues } = parseCustomerMasterText(PDF_TEXT)
    expect(issues).toEqual([])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      code: '11001',
      name: 'TEST SHOP ONE KHADAKPADA',
      address1: 'FLAT 1 TEST BUILDING',
      address2: 'NEAR TEST CIRCLE',
      phoneRaw: '9000000001',
      areaName: 'TEST AREA',
      pincode: '421301',
      gstinRaw: '',
    })
    expect(items[1]).toMatchObject({
      code: '11002',
      address3: 'LANE 3',
      phoneRaw: '0',
      pincode: '0',
      gstinRaw: '27ABCDE1234F1Z5',
      foodLicense: '1234',
    })
  })

  it('ignores the page banner and footer and flags a record that lost its lines', () => {
    const { items, issues } = parseCustomerMasterText(`${PDF_TEXT}\n11003       TEST SHOP THREE\n`)
    expect(items.map((i) => i.code)).toEqual(['11001', '11002', '11003'])
    expect(issues).toEqual([{ kind: 'record-incomplete', ref: 'customers:11003' }])
  })

  it('merges a second list: the first leads, blanks are filled, new customers are added', () => {
    const base = parseCustomerMasterText(PDF_TEXT).items
    const extra = [
      {
        ...(base[0] as never as Record<string, string>),
        phoneRaw: '',
        ownerName: 'TEST OWNER',
        stateCode: '27',
      },
      { ...(base[1] as never as Record<string, string>), name: 'DIFFERENT SPELLING' },
      { ...(base[0] as never as Record<string, string>), code: '11009', name: 'NEW SHOP' },
    ] as never
    const out = mergeCustomers(base, extra)
    expect(out.customers.map((c) => c.code)).toEqual(['11001', '11002', '11009'])
    expect(out.customers[0]).toMatchObject({
      phoneRaw: '9000000001',
      ownerName: 'TEST OWNER',
      stateCode: '27',
    })
    expect(out.customers[1]?.name).toBe('TEST SHOP TWO')
    expect(out.onlyInExtra).toBe(1)
    expect(out.disagreements).toBe(1)
  })
})
