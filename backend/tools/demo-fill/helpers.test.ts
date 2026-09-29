import { describe, expect, it } from 'vitest'
import { REFERENCE_TAKEN, dayNumber, paymentReference } from './helpers.js'
import { addDays, demoId } from './ids.js'

const TENANT = '01a0eb1e-3c50-74e3-8bdb-c81a7fd0d498'

const PLACES = ['driver1', 'driver2', 'desk'] as const

describe("the tool's payment references (DOS-310: a reference is used once)", () => {
  it('has the shape of a UTR, a cheque number and a bank transfer reference', () => {
    const id = demoId(TENANT, '2026-09-29', 'receipt', 'x')
    expect(paymentReference('upi', '2026-09-29', id, 'driver1')).toMatch(/^\d{12}$/)
    expect(paymentReference('cheque', '2026-09-29', id, 'desk')).toMatch(/^\d{6}$/)
    expect(paymentReference('bank_transfer', '2026-09-29', id, null)).toMatch(/^NEFT\d{12}$/)
  })

  it('is the same for the same receipt and try, and another for the next try', () => {
    const id = demoId(TENANT, '2026-09-29', 'receipt', 'x')
    for (const mode of ['upi', 'cheque', 'bank_transfer'] as const) {
      const place = mode === 'bank_transfer' ? null : 'driver2'
      expect(paymentReference(mode, '2026-09-29', id, place)).toBe(
        paymentReference(mode, '2026-09-29', id, place),
      )
      const tries = new Set(
        [0, 1, 2, 3, 4].map((n) => paymentReference(mode, '2026-09-29', id, place, n)),
      )
      expect(tries.size).toBe(5)
    }
  })

  it("never gives two of the day's receipts one reference: van 1's door, van 2's door, the desk, every try", () => {
    // A van has one cheque door and one UPI door a day, the desk one cheque and one payment to match: on each day
    // of a year, the day's cheques (and the day's UPI payments), with all five tries of each, are all different.
    // (Before, a cheque number was the date and two digits of a digest: 3 cheques a day among 100 numbers met on
    // about one day in thirty, and the product asked "cheque number seen elsewhere" of the tool's own cheque.)
    for (const mode of ['cheque', 'upi'] as const)
      for (let d = 0; d < 366; d++) {
        const date = addDays('2026-09-01', d)
        const refs = PLACES.flatMap((place) =>
          [0, 1, 2, 3, 4].map((attempt) =>
            paymentReference(mode, date, demoId(TENANT, date, 'receipt', place), place, attempt),
          ),
        )
        expect(new Set(refs).size, `${mode} on ${date}`).toBe(refs.length)
      }
  })

  it('never repeats across days, whichever receipt, place and try', () => {
    // Every receipt the tool makes in a year of days, three tries each: no reference of one day is another's.
    for (const mode of ['upi', 'cheque', 'bank_transfer'] as const) {
      const dayOf = new Map<string, string>()
      for (let d = 0; d < 366; d++) {
        const date = addDays('2026-09-01', d)
        for (const place of mode === 'bank_transfer' ? [null, null, null, null] : PLACES) {
          const id = demoId(TENANT, date, 'receipt', String(place), String(dayOf.size))
          for (let attempt = 0; attempt < 3; attempt++) {
            const ref = paymentReference(mode, date, id, place, attempt)
            const seen = dayOf.get(ref)
            expect(
              seen === undefined || seen === date,
              `${mode} ${ref} on ${date} and ${String(seen)}`,
            ).toBe(true)
            dayOf.set(ref, date)
          }
        }
      }
    }
  })

  it('carries the business date', () => {
    const id = demoId(TENANT, '2026-09-29', 'receipt', 'x')
    const day = String(dayNumber('2026-09-29'))
    expect(paymentReference('upi', '2026-09-29', id, 'desk').startsWith(day.padStart(5, '0'))).toBe(
      true,
    )
    expect(paymentReference('bank_transfer', '2026-09-29', id, null).slice(4, 9)).toBe(
      day.padStart(5, '0'),
    )
    expect(paymentReference('cheque', '2026-09-29', id, 'driver1').slice(0, 4)).toBe(
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
