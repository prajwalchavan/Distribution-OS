import { describe, expect, it } from 'vitest'
import { REFERENCE_TAKEN, dayNumber, paymentReference } from './helpers.js'
import { addDays, demoId } from './ids.js'

const TENANT = '01a0eb1e-3c50-74e3-8bdb-c81a7fd0d498'

describe("the tool's payment references (DOS-310: a reference is used once)", () => {
  it('has the shape of a UTR, a cheque number and a bank transfer reference', () => {
    const id = demoId(TENANT, '2026-09-29', 'receipt', 'x')
    expect(paymentReference('upi', '2026-09-29', id)).toMatch(/^\d{12}$/)
    expect(paymentReference('cheque', '2026-09-29', id)).toMatch(/^\d{6}$/)
    expect(paymentReference('bank_transfer', '2026-09-29', id)).toMatch(/^NEFT\d{10}$/)
  })

  it('is the same for the same receipt and try, and another for the next try', () => {
    const id = demoId(TENANT, '2026-09-29', 'receipt', 'x')
    for (const mode of ['upi', 'cheque', 'bank_transfer'] as const) {
      expect(paymentReference(mode, '2026-09-29', id)).toBe(paymentReference(mode, '2026-09-29', id))
      const tries = new Set([0, 1, 2, 3, 4].map((n) => paymentReference(mode, '2026-09-29', id, n)))
      expect(tries.size).toBeGreaterThan(1)
    }
  })

  it('never repeats across days, whichever receipt and try', () => {
    // Every receipt the tool makes in a year of days, three tries each: no reference of one day is another's.
    for (const mode of ['upi', 'cheque', 'bank_transfer'] as const) {
      const dayOf = new Map<string, string>()
      for (let d = 0; d < 366; d++) {
        const date = addDays('2026-09-01', d)
        for (let r = 0; r < 4; r++) {
          const id = demoId(TENANT, date, 'receipt', String(r))
          for (let attempt = 0; attempt < 3; attempt++) {
            const ref = paymentReference(mode, date, id, attempt)
            const seen = dayOf.get(ref)
            expect(seen === undefined || seen === date, `${mode} ${ref} on ${date} and ${String(seen)}`).toBe(true)
            dayOf.set(ref, date)
          }
        }
      }
    }
  })

  it('carries the business date', () => {
    const id = demoId(TENANT, '2026-09-29', 'receipt', 'x')
    const day = String(dayNumber('2026-09-29'))
    expect(paymentReference('upi', '2026-09-29', id).startsWith(day.padStart(5, '0'))).toBe(true)
    expect(paymentReference('bank_transfer', '2026-09-29', id).slice(4, 9)).toBe(day.padStart(5, '0'))
    expect(paymentReference('cheque', '2026-09-29', id).slice(0, 4)).toBe(
      String(Number(day) % 10_000).padStart(4, '0'),
    )
  })

  it('knows the three refusals that say a reference is taken', () => {
    expect([...REFERENCE_TAKEN].sort()).toEqual([
      'cheque_already_recorded',
      'cheque_number_seen_elsewhere',
      'reference_already_recorded',
    ])
  })
})
