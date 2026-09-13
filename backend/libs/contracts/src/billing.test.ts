import { describe, expect, it } from 'vitest'
import {
  CreditNoteReasonSchema,
  isSaleableCreditNoteReason,
  UNSALEABLE_CREDIT_NOTE_REASONS,
} from './billing.js'

describe('credit note reasons', () => {
  it('DOS-116: a return_damaged credit note line is never saleable; every other credit-note reason is', () => {
    expect(isSaleableCreditNoteReason('return_damaged')).toBe(false)
    const others = CreditNoteReasonSchema.options.filter((r) => r !== 'return_damaged')
    expect(others.length).toBeGreaterThan(0)
    for (const reason of others) expect(isSaleableCreditNoteReason(reason), reason).toBe(true)

    // the list the server refuses and the manager app routes to the bin is exactly this one code
    expect([...UNSALEABLE_CREDIT_NOTE_REASONS]).toEqual(['return_damaged'])
    const unsaleable = CreditNoteReasonSchema.options.filter((r) => !isSaleableCreditNoteReason(r))
    expect(unsaleable).toEqual(['return_damaged'])
  })
})
