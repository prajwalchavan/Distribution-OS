/**
 * What a rate request's order id MEANS on the desk (DOS-090).
 *
 * `bargain_requests.order_id` is the id the rep's phone minted for a draft that may still be on that
 * phone: `orders.create` writes the same id when the order is finally placed, which is exactly why the
 * request gates that order and no other. Until then `orders.get` answers 404, and the Rate requests
 * row named an order nobody could open — so the row says which of the three cases it is, and the age
 * of the ask, so a request for a draft that was abandoned is visible and can be rejected there.
 *
 * Pure: the screen resolves the ids (one read per distinct id on the page, cached) and this turns each
 * answer into a sentence. It never links anywhere — there is nothing to open for a missing order.
 */
export type OrderResolution =
  /** The request names no order: the rate applies to any order of this shop. */
  | { kind: 'none' }
  /** The server has no such order: it is still a draft on the rep's phone. */
  | { kind: 'missing' }
  /** The order exists; a placed order with no number yet is a draft ON THE SERVER. */
  | { kind: 'found'; orderNo: string | null; state: string }
  /** Not resolved yet (still loading, or offline): say nothing rather than guess. */
  | { kind: 'unknown' }

export type Translate = (key: string, params?: Record<string, string | number>) => string

/** The resolution for one request's `orderId`, from the page's resolved map. */
export function resolutionOf(
  orderId: string | null | undefined,
  resolved: ReadonlyMap<string, OrderResolution>,
): OrderResolution {
  if (orderId === null || orderId === undefined || orderId === '') return { kind: 'none' }
  return resolved.get(orderId) ?? { kind: 'unknown' }
}

/** The sentence for one resolution, or null when there is nothing honest to say yet. */
export function orderLabel(resolution: OrderResolution, t: Translate): string | null {
  switch (resolution.kind) {
    case 'none':
      return t('m2.rateOrderAny')
    case 'missing':
      return t('m2.rateOrderMissing')
    case 'found':
      return t('m2.rateOrderFound', {
        no: resolution.orderNo ?? t('m2.rateOrderDraft'),
        state: resolution.state,
      })
    case 'unknown':
      return null
  }
}
