import { describe, expect, it } from 'vitest'
import { deriveOpenBills } from './bak-data.js'
import { SqlBackup, T } from './mssql-bak.js'
import { reconcileBills } from './reconcile.js'
import { buildBackup, col, type SyntheticTable } from './testing.js'
import type { LegacyBill } from './types.js'

const SALDAT: SyntheticTable = {
  name: 'saldat',
  columns: [
    col('BOOK_CODE', T.varchar, 10, 1),
    col('BILL_NO', T.bigint, 8, 2),
    col('SAL_YEAR', T.numeric, 9, 3, 9, 0),
    col('CASH_ACC', T.nvarchar, 60, 4),
    col('BILL_DATE', T.datetime, 8, 5),
    col('DUE_DATE', T.datetime, 8, 6),
    col('SAL_AMT', T.numeric, 9, 7, 18, 2),
    col('PARTY_NAME', T.nvarchar, 100, 8),
    col('PARTY_AREA', T.nvarchar, 100, 9),
    col('SMAN_ACC', T.nvarchar, 30, 10),
  ],
  rows: [
    // part-received: 400 on 10 June
    {
      BOOK_CODE: 'GL',
      BILL_NO: 1,
      SAL_YEAR: 2026,
      CASH_ACC: '11001',
      BILL_DATE: '2026-06-04T00:00:00.000',
      DUE_DATE: '2026-06-04T00:00:00.000',
      SAL_AMT: 1000,
      PARTY_NAME: 'TEST SHOP ONE',
      PARTY_AREA: 'TEST AREA',
      SMAN_ACC: null,
    },
    // paid in full on 20 June
    {
      BOOK_CODE: 'GL',
      BILL_NO: 2,
      SAL_YEAR: 2026,
      CASH_ACC: '11001',
      BILL_DATE: '2026-06-05T00:00:00.000',
      DUE_DATE: null,
      SAL_AMT: 1000,
      PARTY_NAME: 'TEST SHOP ONE',
      PARTY_AREA: null,
      SMAN_ACC: null,
    },
    // sold after the day being rebuilt
    {
      BOOK_CODE: 'GL',
      BILL_NO: 3,
      SAL_YEAR: 2026,
      CASH_ACC: '11002',
      BILL_DATE: '2026-07-20T00:00:00.000',
      DUE_DATE: null,
      SAL_AMT: 250.5,
      PARTY_NAME: 'TEST SHOP TWO',
      PARTY_AREA: null,
      SMAN_ACC: null,
    },
    // received with a settlement discount, and a receipt whose header is missing
    {
      BOOK_CODE: 'GL',
      BILL_NO: 4,
      SAL_YEAR: 2026,
      CASH_ACC: '11002',
      BILL_DATE: '2026-06-06T00:00:00.000',
      DUE_DATE: null,
      SAL_AMT: 500,
      PARTY_NAME: 'TEST SHOP TWO',
      PARTY_AREA: null,
      SMAN_ACC: null,
    },
    {
      BOOK_CODE: 'GL',
      BILL_NO: 5,
      SAL_YEAR: 2026,
      CASH_ACC: '11002',
      BILL_DATE: '2026-06-07T00:00:00.000',
      DUE_DATE: null,
      SAL_AMT: 300,
      PARTY_NAME: 'TEST SHOP TWO',
      PARTY_AREA: null,
      SMAN_ACC: null,
    },
  ],
}
const SALRCT: SyntheticTable = {
  name: 'salrct',
  columns: [col('RCT_NO', T.int, 4, 1), col('RCT_DATE', T.datetime, 8, 2)],
  rows: [
    { RCT_NO: 1, RCT_DATE: '2026-06-10T00:00:00.000' },
    { RCT_NO: 2, RCT_DATE: '2026-06-20T00:00:00.000' },
    { RCT_NO: 3, RCT_DATE: '2026-08-01T00:00:00.000' },
  ],
}
const SALRCTDET: SyntheticTable = {
  name: 'salrctdet',
  columns: [
    col('RCT_NO', T.int, 4, 1),
    col('BOOK_CODE', T.varchar, 10, 2),
    col('BILL_NO', T.bigint, 8, 3),
    col('RCT_AMT', T.numeric, 9, 4, 18, 2),
    col('SET_AMT', T.numeric, 9, 5, 18, 2),
  ],
  rows: [
    { RCT_NO: 1, BOOK_CODE: 'GL', BILL_NO: 1, RCT_AMT: 400, SET_AMT: 0 },
    { RCT_NO: 2, BOOK_CODE: 'GL', BILL_NO: 2, RCT_AMT: 1000, SET_AMT: 0 },
    { RCT_NO: 2, BOOK_CODE: 'GL', BILL_NO: 4, RCT_AMT: 490, SET_AMT: 10 },
    // no header for receipt 9: no date, counted as received
    { RCT_NO: 9, BOOK_CODE: 'GL', BILL_NO: 5, RCT_AMT: 300, SET_AMT: 0 },
    // received in August, after the day the tests rebuild
    { RCT_NO: 3, BOOK_CODE: 'GL', BILL_NO: 1, RCT_AMT: 600, SET_AMT: 0 },
  ],
}

const bak = new SqlBackup(buildBackup([SALDAT, SALRCT, SALRCTDET]))

describe('the outstanding rebuilt from the backup', () => {
  it('is what each bill still owes at the END of the day asked for, from receipts dated up to then', () => {
    const july1 = deriveOpenBills(bak, '2026-07-01')
    if ('unsupported' in july1) throw new Error(july1.unsupported)
    // bill 2 is paid, 3 is not yet sold, 4 is paid with a settlement discount, 5 is paid by a receipt with no date
    expect(july1.bills.map((b) => [b.billNo, b.amountPaise, b.receivedPaise])).toEqual([
      ['1', 100_000, 40_000],
    ])
    expect(july1.bills[0]).toMatchObject({
      bookCode: 'GL',
      salYear: '2026',
      cashAcc: '11001',
      billDate: '2026-06-04',
      title: 'TEST SHOP ONE',
      areaName: 'TEST AREA',
    })
    expect(july1.facts).toMatchObject({
      billsRead: 5,
      receiptLines: 5,
      receiptsWithoutDate: 1,
      open: 1,
      salYears: 1,
    })
  })

  it('counts a receipt dated the very day, and later receipts only when the day reaches them', () => {
    const june10 = deriveOpenBills(bak, '2026-06-10')
    const june9 = deriveOpenBills(bak, '2026-06-09')
    const sept = deriveOpenBills(bak, '2026-09-01')
    if ('unsupported' in june10 || 'unsupported' in june9 || 'unsupported' in sept)
      throw new Error('unsupported')
    expect(june10.bills.find((b) => b.billNo === '1')?.receivedPaise).toBe(40_000)
    expect(june9.bills.find((b) => b.billNo === '1')?.receivedPaise).toBe(0)
    // by September: bill 1 is settled by the August receipt, and bill 3 (250.50) is the one bill still open
    expect(sept.bills.map((b) => [b.billNo, b.amountPaise - b.receivedPaise])).toEqual([
      ['3', 25_050],
    ])
  })

  it('orders bills by date, then number', () => {
    const june = deriveOpenBills(bak, '2026-06-09')
    if ('unsupported' in june) throw new Error(june.unsupported)
    expect(june.bills.map((b) => b.billNo)).toEqual(['1', '2', '4'])
  })

  it('says why it cannot rebuild, instead of guessing, when the tables are missing or span years', () => {
    const noReceipts = new SqlBackup(buildBackup([SALDAT]))
    expect(deriveOpenBills(noReceipts, '2026-07-01')).toEqual({
      unsupported: 'the backup has no salrctdet, salrct table',
    })
    const twoYears = new SqlBackup(
      buildBackup([
        {
          ...SALDAT,
          rows: [...SALDAT.rows, { ...(SALDAT.rows[0] ?? {}), BILL_NO: 99, SAL_YEAR: 2027 }],
        },
        SALRCT,
        SALRCTDET,
      ]),
    )
    expect(deriveOpenBills(twoYears, '2026-07-01')).toEqual({
      unsupported: 'the backup holds bills of 2 sales years; rebuild one year at a time',
    })
  })
})

const bill = (over: Partial<LegacyBill>): LegacyBill => ({
  bookCode: 'GL',
  salYear: '2026',
  billNo: '1',
  cashAcc: '11001',
  title: '',
  areaName: '',
  salesman: '',
  billDate: '2026-06-10',
  dueDate: null,
  amountPaise: 1000,
  receivedPaise: 0,
  creditDays: 0,
  row: 2,
  ...over,
})

describe('reconcileBills', () => {
  it('counts what the report and the rebuild share, where they differ, and what only one has', () => {
    const report = [
      bill({ billNo: '1' }),
      bill({ billNo: '2', receivedPaise: 200 }),
      bill({ billNo: '3' }),
      bill({ billNo: '4', amountPaise: 500 }),
    ]
    const rebuilt = [
      bill({ billNo: '1' }), // same
      bill({ billNo: '2', receivedPaise: 100 }), // different balance
      bill({ billNo: '3' }), // same
      bill({ billNo: '8', amountPaise: 700, billDate: '2026-05-20' }), // older than the report's first bill
      bill({ billNo: '9', amountPaise: 300, billDate: '2026-06-12' }),
    ]
    expect(reconcileBills(report, rebuilt)).toEqual({
      reportBills: 4,
      rebuiltBills: 5,
      inBoth: 3,
      sameBalance: 2,
      differentBalance: 1,
      onlyInReport: 1,
      onlyInRebuilt: 2,
      reportOnlyPaise: 500,
      rebuiltOnlyPaise: 1000,
      rebuiltOnlyBeforeReportStart: 1,
      reportStart: '2026-06-10',
      reportEnd: '2026-06-10',
    })
  })
  it('is all zeros for two empty lists', () => {
    expect(reconcileBills([], [])).toMatchObject({ reportBills: 0, inBoth: 0, reportStart: null })
  })
})
