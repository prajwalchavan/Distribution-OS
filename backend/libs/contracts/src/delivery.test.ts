import { describe, expect, it } from 'vitest'
import {
  DeliveryLineReasonSchema,
  isSaleableReturn,
  UNSALEABLE_RETURN_REASONS,
} from './delivery.js'

describe('delivery line reasons', () => {
  it('DOS-058: damaged and expired returns are never saleable; refused, wrong_item, short_loaded, other and no reason are', () => {
    expect(isSaleableReturn('damaged')).toBe(false)
    expect(isSaleableReturn('expired')).toBe(false)
    for (const reason of ['refused', 'wrong_item', 'short_loaded', 'other'] as const)
      expect(isSaleableReturn(reason), reason).toBe(true)
    expect(isSaleableReturn(null)).toBe(true)
    expect(isSaleableReturn(undefined)).toBe(true)

    // the list the server refuses and the delivery app routes to the bin is exactly these two codes
    expect([...UNSALEABLE_RETURN_REASONS].sort()).toEqual(['damaged', 'expired'])
    const unsaleable = DeliveryLineReasonSchema.options.filter((r) => !isSaleableReturn(r))
    expect(unsaleable.sort()).toEqual(['damaged', 'expired'])
  })
})
