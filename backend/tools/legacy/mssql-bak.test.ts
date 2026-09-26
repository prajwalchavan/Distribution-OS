import { describe, expect, it } from 'vitest'
import { readBakData, isCustomerCode } from './bak-data.js'
import {
  BakLayoutError,
  SqlBackup,
  decodeRecord,
  decodeValue,
  fixedLength,
  naiveLayout,
  T,
} from './mssql-bak.js'
import { buildBackup, col, encodeRecord, type SyntheticTable } from './testing.js'

describe('the row format', () => {
  // (int id, varchar name): status 0x30, fixed end 8, id 1, 2 columns, null bitmap 00, 1 variable column
  // ending at byte 18, then "abc" — laid out by hand from the documented row structure, not by our encoder.
  const hand = Buffer.from([
    0x30, 0x00, 0x08, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x01, 0x00, 0x12, 0x00, 0x61,
    0x62, 0x63,
  ])
  const columns = [col('id', T.int, 4, 1), col('name', T.varchar, 20, 2)]

  it('decodes a hand-assembled record', () => {
    expect(decodeRecord(hand, naiveLayout(columns), 't')).toEqual({ id: 1, name: 'abc' })
  })

  it('agrees with the encoder used by the other specs', () => {
    expect(encodeRecord(columns, { id: 1, name: 'abc' }).equals(hand)).toBe(true)
  })

  it('reads fixed and variable columns, nulls, decimals, datetimes and unicode', () => {
    const cols = [
      col('a', T.bigint, 8, 1),
      col('amt', T.numeric, 9, 2, 18, 2),
      col('when', T.datetime, 8, 3),
      col('code', T.char, 5, 4),
      col('flag', T.tinyint, 1, 5),
      col('name', T.nvarchar, 60, 6),
      col('note', T.varchar, 20, 7),
      col('gone', T.int, 4, 8),
    ]
    const rec = encodeRecord(cols, {
      a: 5_000_000_000,
      amt: -1234.56,
      when: '2026-06-04T13:30:15.000',
      code: 'AB',
      flag: 7,
      name: 'नमस्ते shop',
      note: null,
      gone: null,
    })
    expect(decodeRecord(rec, naiveLayout(cols), 't')).toEqual({
      a: 5_000_000_000,
      amt: -1234.56,
      when: '2026-06-04T13:30:15.000',
      code: 'AB',
      flag: 7,
      name: 'नमस्ते shop',
      note: null,
      gone: null,
    })
  })

  it('skips ghosts, forwarding stubs and anything that is not live data, keeps forwarded rows', () => {
    const layout = naiveLayout(columns)
    const rec = (status: number): Buffer => {
      const b = Buffer.from(hand)
      b[0] = status
      return b
    }
    expect(decodeRecord(rec(0x30), layout, 't')).not.toBeNull() // primary
    expect(decodeRecord(rec(0x32), layout, 't')).not.toBeNull() // forwarded record: the real row of a heap
    expect(decodeRecord(rec(0x34), layout, 't')).toBeNull() // forwarding stub
    expect(decodeRecord(rec(0x3c), layout, 't')).toBeNull() // ghost data record
  })

  it('refuses a record whose fixed area is not what the columns add up to, instead of shifting numbers', () => {
    const rec = encodeRecord(columns, { id: 1, name: 'abc' }, 4)
    expect(() => decodeRecord(rec, naiveLayout(columns), 'saldet')).toThrow(BakLayoutError)
    expect(() => decodeRecord(rec, naiveLayout(columns), 'saldet')).toThrow(/dropped or re-typed/)
    // the engine's own tables are read tolerantly: they gained columns between versions
    expect(decodeRecord(rec, naiveLayout(columns), 'sys', false)).not.toBeNull()
  })

  it('knows the storage size of each fixed type', () => {
    expect(fixedLength(col('x', T.int, 4, 1))).toBe(4)
    expect(fixedLength(col('x', T.numeric, 9, 1, 9))).toBe(5)
    expect(fixedLength(col('x', T.numeric, 9, 1, 18))).toBe(9)
    expect(fixedLength(col('x', T.nchar, 20, 1))).toBe(20)
    expect(fixedLength(col('x', T.nvarchar, 20, 1))).toBeNull()
  })

  it('decodes the date type from year 1, not 1901', () => {
    expect(decodeValue(col('d', T.date, 3, 1), Buffer.from([0, 0, 0]))).toBe('0001-01-01')
    expect(decodeValue(col('d', T.date, 3, 1), Buffer.from([0x0e, 0x00, 0x00]))).toBe('0001-01-15')
  })
})

const ITEMS: SyntheticTable = {
  name: 'm_itemas',
  columns: [
    col('ITEM_CODE', T.nvarchar, 60, 1),
    col('ITEM_TITLE', T.nvarchar, 200, 2),
    col('ITEM_CLBL', T.numeric, 9, 3, 18, 0),
    col('HSN_NO', T.varchar, 20, 4),
    col('ITEM_ACT', T.char, 1, 5),
  ],
  rows: [
    { ITEM_CODE: 'T1', ITEM_TITLE: 'TEST ONE', ITEM_CLBL: 40, HSN_NO: '08135020', ITEM_ACT: '1' },
    { ITEM_CODE: 'T2', ITEM_TITLE: 'TEST TWO', ITEM_CLBL: 0, HSN_NO: '', ITEM_ACT: '0' },
    // more than one page of rows
    ...Array.from({ length: 45 }, (_, i) => ({
      ITEM_CODE: `X${String(i)}`,
      ITEM_TITLE: 'FILLER',
      ITEM_CLBL: i,
      HSN_NO: '2009',
      ITEM_ACT: '1',
    })),
  ],
}

const ACCOUNTS: SyntheticTable = {
  name: 'm_accmas',
  columns: [
    col('CASH_ACC', T.nvarchar, 60, 1),
    col('ACC_TITLE', T.nvarchar, 200, 2),
    col('LEVL_CODE', T.nvarchar, 10, 3),
    col('ACC_TEL', T.nvarchar, 40, 4),
    col('AREA_CODE', T.nvarchar, 10, 5),
    col('GST', T.varchar, 20, 6),
    col('State', T.int, 4, 7),
  ],
  rows: [
    {
      CASH_ACC: '11001',
      ACC_TITLE: 'TEST SHOP ONE',
      LEVL_CODE: 'BD',
      ACC_TEL: '9000000001',
      AREA_CODE: '11',
      GST: '',
      State: 27,
    },
    {
      CASH_ACC: 'GK',
      ACC_TITLE: 'TEST SUPPLIER',
      LEVL_CODE: 'BS',
      ACC_TEL: '9000000002',
      AREA_CODE: '',
      GST: '27ABCDE1234F1Z5',
      State: 24,
    },
    {
      CASH_ACC: 'CASH',
      ACC_TITLE: 'CASH IN HAND',
      LEVL_CODE: 'BC',
      ACC_TEL: '',
      AREA_CODE: '',
      GST: '',
      State: 27,
    },
  ],
}

const AREAS: SyntheticTable = {
  name: 'm_area',
  columns: [col('AREA_CODE', T.nvarchar, 10, 1), col('AREA_NAME', T.nvarchar, 100, 2)],
  rows: [{ AREA_CODE: '11', AREA_NAME: 'TEST AREA' }],
}

const PURDAT: SyntheticTable = {
  name: 'PURDAT',
  columns: [
    col('PUR_NO', T.int, 4, 1),
    col('IN_TYPE', T.nvarchar, 4, 2),
    col('CASH_ACC', T.nvarchar, 60, 3),
    col('BILL_DATE', T.datetime, 8, 4),
  ],
  rows: [
    { PUR_NO: 1, IN_TYPE: 'P', CASH_ACC: 'GK', BILL_DATE: '2026-06-01T00:00:00.000' },
    { PUR_NO: 2, IN_TYPE: 'P', CASH_ACC: 'GK', BILL_DATE: '2026-07-01T00:00:00.000' },
    { PUR_NO: 3, IN_TYPE: 'I', CASH_ACC: null, BILL_DATE: null },
  ],
}
const PURDET: SyntheticTable = {
  name: 'PURDET',
  columns: [
    col('PUR_NO', T.int, 4, 1),
    col('IN_TYPE', T.nvarchar, 4, 2),
    col('ITEM_CODE', T.nvarchar, 60, 3),
    col('BILL_PRICE', T.numeric, 9, 4, 18, 2),
    col('COST_PRICE', T.numeric, 9, 5, 18, 2),
    col('MRP_PRICE', T.numeric, 9, 6, 18, 2),
  ],
  rows: [
    { PUR_NO: 1, IN_TYPE: 'P', ITEM_CODE: 'T1', BILL_PRICE: 10, COST_PRICE: 10.5, MRP_PRICE: 15 },
    {
      PUR_NO: 2,
      IN_TYPE: 'P',
      ITEM_CODE: 'T1',
      BILL_PRICE: 11.11,
      COST_PRICE: 11.5,
      MRP_PRICE: 16,
    },
    { PUR_NO: 3, IN_TYPE: 'I', ITEM_CODE: 'T2', BILL_PRICE: 1, COST_PRICE: 1, MRP_PRICE: 2 },
  ],
}

// a table whose records are 4 bytes longer than its declared columns (a dropped column)
const DAMAGED: SyntheticTable = {
  name: 'saldet',
  columns: [col('BILL_NO', T.int, 4, 1), col('ITEM_CODE', T.nvarchar, 60, 2)],
  rows: [{ BILL_NO: 1, ITEM_CODE: 'T1' }],
  extraFixedBytes: 4,
}

describe('SqlBackup', () => {
  const buffer = buildBackup([ITEMS, ACCOUNTS, AREAS, PURDAT, PURDET, DAMAGED])
  const bak = new SqlBackup(buffer)

  it('recognises a tape-format container and finds the pages wherever the extents put them', () => {
    expect(SqlBackup.isMtf(buffer)).toBe(true)
    expect(SqlBackup.isMtf(Buffer.from('not a backup'))).toBe(false)
    expect(bak.stats().tables).toBe(6)
    expect(bak.tableNames()).toEqual(
      ['PURDAT', 'PURDET', 'saldet', 'm_accmas', 'm_area', 'm_itemas'].sort(),
    )
  })

  it("lists a table's columns from the catalogue and reads every row across pages", () => {
    expect(bak.columns('m_itemas').map((c) => c.name)).toEqual([
      'ITEM_CODE',
      'ITEM_TITLE',
      'ITEM_CLBL',
      'HSN_NO',
      'ITEM_ACT',
    ])
    const rows = bak.rows('m_itemas')
    expect(rows).toHaveLength(47)
    expect(rows[0]).toMatchObject({ ITEM_CODE: 'T1', ITEM_CLBL: 40, HSN_NO: '08135020' })
    expect(rows.filter((r) => r.ITEM_TITLE === 'FILLER')).toHaveLength(45)
  })

  it('refuses a table whose layout it cannot trust, saying why, and reads the others', () => {
    const got = bak.tryRows('saldet')
    expect('unsupported' in got && got.unsupported).toMatch(/dropped or re-typed/)
    expect('rows' in bak.tryRows('m_area')).toBe(true)
    expect(() => bak.rows('nothing')).toThrow(/no table/)
  })

  it('reads the item, cost, customer and supplier tables into what the importer needs', () => {
    const data = readBakData(bak)
    expect(data.itemExtras.get('T1')).toEqual({
      hsn: '08135020',
      closingQty: 40,
      // the LATEST supplier bill (July), not the first
      purchaseRatePaise: 1111,
      landedCostPaise: 1150,
      mrpPaise: 1600,
      supplierCode: 'GK',
      active: true,
    })
    // an opening-stock ('I') line is not a purchase: no cost for T2
    expect(data.itemExtras.get('T2')).toMatchObject({
      closingQty: null,
      purchaseRatePaise: null,
      active: false,
    })
    expect(data.customers).toHaveLength(1)
    expect(data.customers[0]).toMatchObject({
      code: '11001',
      areaName: 'TEST AREA',
      phoneRaw: '9000000001',
      stateCode: '27',
    })
    expect(data.suppliers).toEqual([
      {
        code: 'GK',
        name: 'TEST SUPPLIER',
        gstinRaw: '27ABCDE1234F1Z5',
        phoneRaw: '9000000002',
        stateCode: '24',
      },
    ])
    expect(data.unsupported.map((u) => u.table)).toEqual(['saldet'])
    expect(data.facts).toMatchObject({
      items: 47,
      itemsWithStock: 45,
      customers: 1,
      suppliers: 1,
      purchaseLines: 2,
      itemsWithCost: 1,
    })
  })

  it('takes a five-digit code for a customer and a letter code for anything else', () => {
    expect(isCustomerCode('11001')).toBe(true)
    expect(isCustomerCode('GK')).toBe(false)
    expect(isCustomerCode('1100')).toBe(false)
  })
})
