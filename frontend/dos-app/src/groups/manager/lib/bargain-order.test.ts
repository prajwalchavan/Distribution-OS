import { describe, expect, it } from 'vitest'

import { orderLabel, resolutionOf, type OrderResolution } from './bargain-order'

/**
 * DOS-090: a rate request carries the order id the rep's phone minted, which is the id the draft will
 * be placed under — so until it is placed, `orders.get` answers 404 and the Rate requests row named an
 * order nobody could open. The row must SAY which of the three it is.
 */
const t = (key: string, params?: Record<string, string | number>): string =>
  params === undefined ? key : `${key}(${JSON.stringify(params)})`

describe('DOS-090: what a rate request says about the order it names', () => {
  it('a request whose order is not on the server reads not placed yet', () => {
    expect(orderLabel({ kind: 'missing' }, t)).toBe('m2.rateOrderMissing')
  })

  it('a request whose order exists reads its number and state', () => {
    expect(orderLabel({ kind: 'found', orderNo: 'SO-0879', state: 'confirmed' }, t)).toBe(
      'm2.rateOrderFound({"no":"SO-0879","state":"confirmed"})',
    )
    // A placed order with no number yet is a draft on the server, not a draft on the phone.
    expect(orderLabel({ kind: 'found', orderNo: null, state: 'draft' }, t)).toBe(
      'm2.rateOrderFound({"no":"m2.rateOrderDraft","state":"draft"})',
    )
  })

  it('a request with no order at all reads any order of this shop', () => {
    expect(orderLabel({ kind: 'none' }, t)).toBe('m2.rateOrderAny')
  })

  it('says nothing while the answer is still unknown: never a guess, never a link to nothing', () => {
    expect(orderLabel({ kind: 'unknown' }, t)).toBeNull()
  })
})

describe('DOS-090: resolving one page of rate requests', () => {
  it('reads a settled orders.get per id: fulfilled is found, rejected is missing, absent is unknown', () => {
    const resolved = resolutionOf(
      'order-1',
      new Map<string, OrderResolution>([
        ['order-1', { kind: 'found', orderNo: 'SO-1', state: 'submitted' }],
        ['order-2', { kind: 'missing' }],
      ]),
    )
    expect(resolved).toEqual({ kind: 'found', orderNo: 'SO-1', state: 'submitted' })
    expect(resolutionOf('order-2', new Map([['order-2', { kind: 'missing' }]]))).toEqual({
      kind: 'missing',
    })
    // An id the page has not resolved yet, and a request that names no order at all.
    expect(resolutionOf('order-3', new Map())).toEqual({ kind: 'unknown' })
    expect(resolutionOf(null, new Map())).toEqual({ kind: 'none' })
  })
})
