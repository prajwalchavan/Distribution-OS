import { describe, expect, it } from 'vitest'
import { buildPlan, DEFAULT_HSN_FALLBACK } from './plan.js'
import { buildReport, countIssues, formatIssueRefs, formatReport, type Sources } from './report.js'
import { gstin } from './testing.js'

const sources: Sources = {
  products: { rows: 2, parsed: 2 },
  outstanding: { source: 'sheet', rows: 2, parsed: 2, reconciliation: null, rebuilt: null },
  customers: { parsed: 2 },
  salesGst: null,
  backup: null,
  backupUnsupported: 0,
}

describe('the report', () => {
  const g = gstin('27ABCDE1234F1Z')
  const plan = buildPlan(
    {
      items: [
        {
          code: 'SECRETCODE1',
          title: 'SECRET PRODUCT NAME',
          packLabel: 'EACH',
          unitKind: 'each',
          mfgCode: 'M',
          mfgName: 'SECRET MAKER',
          gstBps: 500,
          hsnRaw: '19053100',
          salePaise: 400,
          mrpPaise: 500,
          active: true,
          row: 2,
        },
      ],
      customers: [
        {
          code: '11001',
          name: 'SECRET SHOP NAME',
          address1: 'SECRET LANE',
          address2: '',
          address3: '',
          phoneRaw: '9123456780',
          altPhoneRaw: '',
          areaName: 'SECRET AREA',
          pincode: '421301',
          gstinRaw: g,
          ownerName: 'SECRET OWNER',
          email: '',
          pan: '',
          stateCode: '',
          foodLicense: '',
        },
      ],
      bills: [
        {
          bookCode: 'GL',
          salYear: '2026',
          billNo: '424242',
          cashAcc: '11001',
          title: 'SECRET SHOP NAME',
          areaName: 'SECRET AREA',
          salesman: '',
          billDate: '2026-06-04',
          dueDate: null,
          amountPaise: 100_000,
          receivedPaise: 25_000,
          creditDays: 0,
          row: 2,
        },
      ],
      salesGst: [],
    },
    {
      asOf: '2026-09-26',
      ratesFrom: '2025-09-22',
      hsnFallback: DEFAULT_HSN_FALLBACK,
      defaultState: '27',
    },
  )
  const report = buildReport({
    mode: 'dry-run',
    asOf: '2026-09-26',
    plan,
    parseIssues: [],
    sources,
  })

  it('states the plan in counts and rupees', () => {
    expect(report.plan.items).toMatchObject({
      planned: 1,
      listed: 1,
      hsnHeadings: 1,
      gstRatesBps: [500],
    })
    expect(report.plan.retailers).toMatchObject({
      planned: 1,
      withPhone: 1,
      withGstin: 1,
      byState: { '27': 1 },
    })
    expect(report.plan.bills).toMatchObject({
      planned: 1,
      openPaise: 75_000,
      originalPaise: 100_000,
      receivedPaise: 25_000,
      partlyReceived: 1,
    })
    expect(report.plan.bills.ageingPaise).toEqual({
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 75_000,
    })
    expect(report.issues).toEqual({ 'partly-received-bill': 1 })
    expect(formatReport(report)).toContain('₹750.00 owed')
  })

  it('carries no name, phone, GSTIN, address, bill number or item code — JSON or text', () => {
    const everything = `${JSON.stringify(report)}\n${formatReport(report)}\n${formatIssueRefs(plan.issues)}`
    for (const secret of ['SECRET', '9123456780', g, '424242', 'SECRETCODE1', '421301'])
      expect(everything, secret).not.toContain(secret)
  })

  it('reconciles the ledger against the plan when a write happened', () => {
    const wrote = buildReport({
      mode: 'commit',
      asOf: '2026-09-26',
      plan,
      parseIssues: [],
      sources,
      written: {
        steps: {} as never,
        failures: [],
        openingBillPaise: 75_000,
        notes: { openingStockUnitsWithoutMrp: 0, hsnHeadingsHeldBack: 0 },
      },
    })
    expect(wrote.reconciliation).toEqual({
      plannedOpenPaise: 75_000,
      inLedgerPaise: 75_000,
      equal: true,
    })
    expect(formatReport(wrote)).toContain('EQUAL')
    const off = buildReport({
      mode: 'commit',
      asOf: '2026-09-26',
      plan,
      parseIssues: [],
      sources,
      written: {
        steps: {} as never,
        failures: ['x'],
        openingBillPaise: 1,
        notes: { openingStockUnitsWithoutMrp: 0, hsnHeadingsHeldBack: 0 },
      },
    })
    expect(off.reconciliation?.equal).toBe(false)
    expect(off.failures).toBe(1)
  })

  it('counts issues by kind, sorted', () => {
    expect(
      countIssues([
        { kind: 'shared-phone', ref: 'a' },
        { kind: 'bad-phone', ref: 'b' },
        { kind: 'shared-phone', ref: 'c' },
      ]),
    ).toEqual({ 'bad-phone': 1, 'shared-phone': 2 })
  })
})
