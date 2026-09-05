import { describe, expect, it } from 'vitest'
import {
  DailyTenantStatsInput,
  GrowthSeriesInput,
  GstSalesRegisterInput,
  parseReportExportKind,
  REGISTER_WINDOW_DAYS,
  reportExportKind,
  RequestReportExportInput,
  SERIES_POINT_CAPS,
  SeriesGetInput,
  windowBuckets,
  windowDays,
} from './reporting.js'
import { GstSummaryInput } from './billing.js'

describe('reporting window arithmetic', () => {
  it('counts calendar days inclusively', () => {
    expect(windowDays('2026-09-01', '2026-09-01')).toBe(1)
    expect(windowDays('2026-09-01', '2026-09-30')).toBe(30)
    expect(windowDays('2026-02-27', '2026-03-02')).toBe(4)
    expect(windowDays('2026-09-05', '2026-09-04')).toBe(0)
  })

  it('counts Monday-anchored weeks and calendar months', () => {
    // 2026-09-06 is a Sunday, 2026-09-07 a Monday: two days in two different weeks.
    expect(windowBuckets('week', '2026-09-06', '2026-09-07')).toBe(2)
    expect(windowBuckets('week', '2026-09-07', '2026-09-13')).toBe(1)
    expect(windowBuckets('week', '2026-01-01', '2026-12-31')).toBe(53)
    expect(windowBuckets('month', '2026-01-31', '2026-02-01')).toBe(2)
    expect(windowBuckets('month', '2025-01-15', '2026-12-15')).toBe(24)
    expect(windowBuckets('day', '2026-06-01', '2026-08-31')).toBe(92)
  })

  it('refuses a series window past the point cap, or with to before from', () => {
    const ok = SeriesGetInput.safeParse({
      metric: 'invoiced',
      grain: 'day',
      from: '2026-06-01',
      to: '2026-08-31',
    })
    expect(ok.success).toBe(true)
    expect(ok.data?.compare).toBe('none')
    expect(ok.data?.topGroups).toBe(12)
    const wide = SeriesGetInput.safeParse({
      metric: 'invoiced',
      grain: 'day',
      from: '2026-06-01',
      to: '2026-09-01',
    })
    expect(wide.success).toBe(false)
    expect(JSON.stringify(wide.error?.issues)).toContain('window_too_wide')
    // The same range at month grain is three points, well inside the cap.
    expect(
      SeriesGetInput.safeParse({
        metric: 'invoiced',
        grain: 'month',
        from: '2026-06-01',
        to: '2026-09-01',
      }).success,
    ).toBe(true)
    expect(
      SeriesGetInput.safeParse({
        metric: 'invoiced',
        grain: 'month',
        from: '2024-01-01',
        to: '2026-09-01',
      }).success,
    ).toBe(false)
    expect(
      SeriesGetInput.safeParse({ metric: 'orders', from: '2026-09-05', to: '2026-09-04' }).success,
    ).toBe(false)
    expect(SERIES_POINT_CAPS).toEqual({ day: 92, week: 53, month: 24 })
  })

  it('caps growth at 24 months and fixes the grain', () => {
    expect(GrowthSeriesInput.safeParse({ from: '2025-01-01', to: '2026-12-31' }).success).toBe(true)
    expect(GrowthSeriesInput.safeParse({ from: '2024-12-31', to: '2026-12-31' }).success).toBe(
      false,
    )
    expect(GrowthSeriesInput.parse({ from: '2026-01-01', to: '2026-06-30' })).toMatchObject({
      metric: 'invoiced',
      basis: 'mom',
    })
  })

  it('caps a register window in days, the wrapped GST register included', () => {
    expect(DailyTenantStatsInput.safeParse({ from: '2026-06-01', to: '2026-08-31' }).success).toBe(
      true,
    )
    expect(DailyTenantStatsInput.safeParse({ from: '2026-06-01', to: '2026-09-01' }).success).toBe(
      false,
    )
    expect(REGISTER_WINDOW_DAYS.dailySales).toBe(92)
    expect(REGISTER_WINDOW_DAYS.collections).toBe(31)
    // Billing's own input shape passes through untouched, and gains only the cap.
    const wide = { from: '2026-01-01', to: '2026-06-30', groupBy: 'rate' as const }
    expect(GstSummaryInput.safeParse(wide).success).toBe(true)
    expect(GstSalesRegisterInput.safeParse(wide).success).toBe(false)
    const month = { from: '2026-08-01', to: '2026-08-31' }
    expect(GstSalesRegisterInput.parse(month)).toEqual(GstSummaryInput.parse(month))
  })
})

describe('report export kinds', () => {
  it('names the export_jobs kind as report_<register>_<format> and parses it back', () => {
    expect(reportExportKind('gstSalesRegister', 'csv')).toBe('report_gstSalesRegister_csv')
    expect(parseReportExportKind('report_gstSalesRegister_csv')).toEqual({
      register: 'gstSalesRegister',
      format: 'csv',
    })
    expect(parseReportExportKind('report_outstanding_json')).toEqual({
      register: 'outstanding',
      format: 'json',
    })
    expect(parseReportExportKind('tally_xml')).toBeNull()
    expect(parseReportExportKind('claim_sheet')).toBeNull()
    expect(parseReportExportKind('report_nope_csv')).toBeNull()
    expect(parseReportExportKind('report_gstSalesRegister_pdf')).toBeNull()
  })

  it('defaults an export request to CSV with empty filters', () => {
    const parsed = RequestReportExportInput.parse({
      idempotencyKey: '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a10',
      id: '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a11',
      register: 'dailySales',
    })
    expect(parsed.format).toBe('csv')
    expect(parsed.filters).toEqual({})
    expect(
      RequestReportExportInput.safeParse({
        idempotencyKey: '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a10',
        id: '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a11',
        register: 'salesTrend',
      }).success,
    ).toBe(false)
  })
})
