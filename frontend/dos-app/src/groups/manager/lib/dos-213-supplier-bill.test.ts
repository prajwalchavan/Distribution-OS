/**
 * DOS-213 — the typed supplier bill: arithmetic, rules and the body `supplierInvoices.create` receives.
 *
 * The figures below are the day-1 simulation's own: GUR/26-27/00496, Balaji Masala Masti Wafers 45 g,
 * 144 pc at ₹634.08 per case of 48 (= ₹13.21 a piece), batch GK20260828, HSN 19059020 at 18 % —
 * extraction 5894c5cc line 2: taxable 1 90 224 paise, line total 2 24 464 paise.
 */
import { describe, expect, it } from 'vitest'

import {
  billProblems,
  billTotals,
  createBody,
  lineFigures,
  lineProblems,
  parseDate,
  percentToBps,
  shelfLifeDays,
  type BillDraft,
  type DraftLine,
} from './supplier-bill'

const RATES = new Map([
  ['19059020', { gstBps: 1800, cessBps: 0 }],
  ['22021010', { gstBps: 2800, cessBps: 1200 }],
])

function line(over: Partial<DraftLine> = {}): DraftLine {
  return {
    id: '01a0c3de-0000-7000-8000-000000000001',
    variantId: 'v-masala',
    name: 'Balaji Masala Masti Wafers 45 g',
    hsnCode: '19059020',
    mrpPaise: null,
    variantMrpPaise: 2000,
    caseSize: 48,
    batchNo: 'GK20260828',
    expiry: '11-03-2027',
    qty: '3',
    unit: 'cs',
    freePcs: '',
    ratePaise: 63408,
    rateBasis: 'case',
    gstText: '',
    ...over,
  }
}

function bill(over: Partial<BillDraft> = {}): BillDraft {
  return {
    supplierId: 'sup-guru',
    supplierState: '27',
    billNo: 'GUR/26-27/00496',
    billDate: '21-09-2026',
    printedTotalPaise: null,
    lines: [line()],
    ...over,
  }
}

describe('DOS-213: a typed supplier bill', () => {
  it('3 cases of 48 at ₹634.08 a case = 144 pc, taxable ₹1,902.24, GST 18 % inside Maharashtra', () => {
    const f = lineFigures(line(), RATES.get('19059020'), '27', '27')
    expect(f.pieces).toBe(144)
    expect(f.taxablePaise).toBe(190224)
    expect(f.cgstPaise).toBe(17120)
    expect(f.sgstPaise).toBe(17120)
    expect(f.igstPaise).toBe(0)
    expect(f.lineTotalPaise).toBe(224464)
  })

  it('the same line typed as 144 pieces at ₹13.21 a piece comes to the same taxable', () => {
    const f = lineFigures(
      line({ qty: '144', unit: 'pcs', ratePaise: 1321, rateBasis: 'piece' }),
      RATES.get('19059020'),
      '27',
      '27',
    )
    expect(f.pieces).toBe(144)
    expect(f.taxablePaise).toBe(190224)
  })

  it('a supplier from another state is charged IGST, and cess comes from the HSN', () => {
    const f = lineFigures(
      line({ hsnCode: '22021010', qty: '10', unit: 'pcs', ratePaise: 1000, rateBasis: 'piece' }),
      RATES.get('22021010'),
      '29',
      '27',
    )
    expect(f.igstPaise).toBe(2800)
    expect(f.cgstPaise).toBe(0)
    expect(f.cessPaise).toBe(1200)
    expect(f.lineTotalPaise).toBe(10000 + 2800 + 1200)
  })

  it('GST comes from the HSN unless the desk types what the bill printed', () => {
    expect(lineFigures(line(), RATES.get('19059020'), '27', '27').gstBps).toBe(1800)
    expect(lineFigures(line({ gstText: '12' }), RATES.get('19059020'), '27', '27').gstBps).toBe(
      1200,
    )
    expect(percentToBps('2.5')).toBe(250)
    expect(percentToBps('101')).toBeNull()
    // an HSN with no rate on file is a problem to fix, never a silent 0 %
    expect(lineProblems(line({ hsnCode: '99999999' }), undefined)).toContain('gst')
  })

  it('names what is missing on a line', () => {
    expect(lineProblems(line(), RATES.get('19059020'))).toEqual([])
    expect(
      lineProblems(
        line({ variantId: null, qty: '', ratePaise: null, expiry: '31-02-2027' }),
        RATES.get('19059020'),
      ),
    ).toEqual(['item', 'qty', 'rate', 'expiry'])
    expect(
      lineProblems(line({ mrpPaise: null, variantMrpPaise: null }), RATES.get('19059020')),
    ).toContain('mrp')
  })

  it('reads the dates a bill prints and refuses the ones that are not dates', () => {
    expect(parseDate('21-09-2026')).toBe('2026-09-21')
    expect(parseDate('1/9/2026')).toBe('2026-09-01')
    expect(parseDate('2026-09-21')).toBe('2026-09-21')
    expect(parseDate('29-02-2026')).toBeNull()
    expect(parseDate('tomorrow')).toBeNull()
  })

  it('tells the desk how much shelf life a batch has on the bill date', () => {
    expect(shelfLifeDays(line({ expiry: '15-10-2026' }), '2026-09-21')).toBe(24)
    expect(shelfLifeDays(line({ expiry: '' }), '2026-09-21')).toBeNull()
  })

  it('rounds the bill to the rupee, or takes the printed total within ₹1', () => {
    const auto = billTotals(bill(), RATES, '27')
    expect(auto.linesTotalPaise).toBe(224464)
    expect(auto.roundOffPaise).toBe(36)
    expect(auto.totalPaise).toBe(224500)
    const printed = billTotals(bill({ printedTotalPaise: 224400 }), RATES, '27')
    expect(printed.roundOffPaise).toBe(-64)
    expect(billProblems(bill({ printedTotalPaise: 224400 }), RATES, '27', '2026-09-21')).toEqual([])
    expect(billProblems(bill({ printedTotalPaise: 234400 }), RATES, '27', '2026-09-21')).toEqual([
      'total',
    ])
  })

  it('will not book a bill without a supplier, a number, a real date or a complete line', () => {
    expect(
      billProblems(
        bill({ supplierId: null, billNo: ' ', billDate: '22-09-2026', lines: [] }),
        RATES,
        '27',
        '2026-09-21',
      ),
    ).toEqual(['supplier', 'billNo', 'futureDate', 'lines'])
  })

  it('builds the body the server checks to the paisa: header total = Σ lines + round-off', () => {
    const body = createBody(
      bill({
        lines: [
          line(),
          line({
            id: '01a0c3de-0000-7000-8000-000000000002',
            qty: '1248',
            unit: 'pcs',
            ratePaise: 1321,
            rateBasis: 'piece',
            batchNo: '',
            expiry: '',
          }),
        ],
      }),
      RATES,
      '27',
    )
    expect(body.source).toBe('manual')
    expect(body.invoiceDate).toBe('2026-09-21')
    expect(body.lines.map((l) => l.lineNo)).toEqual([1, 2])
    expect(body.lines[0]).toMatchObject({
      qtyPcs: 144,
      printedQty: 3,
      printedUnit: 'cs',
      rateBasis: 'case',
      basisQty: 48,
      ratePaise: 63408,
      batchNo: 'GK20260828',
      expiryDate: '2027-03-11',
      mrpPaise: 2000,
      gstBps: 1800,
    })
    expect(body.lines[1]).toMatchObject({ batchNo: null, expiryDate: null, basisQty: 1 })
    const sumLines = body.lines.reduce((s, l) => s + l.lineTotalPaise, 0)
    expect(body.totalPaise).toBe(sumLines + body.roundOffPaise + body.freightPaise)
    expect(body.subtotalPaise + body.cgstPaise + body.sgstPaise + body.igstPaise).toBe(sumLines)
  })
})
