/**
 * The shop front's own furniture, composed ONLY from the `@dos/ui` contract (founder, 2026-09-28:
 * "a shopping app feel, not some complex feel").
 *
 * `ItemTile` is the kit's `<ProductTile>` fed from the four reads a tile needs — the item, this shop's
 * own rate, the engine's quote of the basket and the stock hint — so the home, a brand page and search
 * cannot draw the same item three different ways. `ShopCartBar` is the kit's `<CartBar>` fed from the
 * basket and its quote, and it opens the order screen (R7), where "Place order" is.
 */
import { CartBar, ProductTile, formatMoney, useGo, useStrings } from '@dos/ui'
import type { TenantProduct } from '@dos/contracts'

import { brandOf, displayName } from './catalog'
import { tileOffer } from './offer'
import type { Shopping } from './shopping'

/** "24 pc case · 70 g": the pack as it is written on the carton. */
export function packLine(
  t: (key: string, vars?: Record<string, string | number>) => string,
  item: TenantProduct,
): string {
  const net = item.netUnit === 'pcs' ? '' : `${String(item.netQty)} ${item.netUnit}`
  return [t('r7.case', { size: String(item.caseSize) }), net]
    .filter((part) => part !== '')
    .join(' · ')
}

export function ItemTile({
  item,
  shopping,
  onOpenPieces,
  testID,
}: {
  item: TenantProduct
  shopping: Shopping
  onOpenPieces: (variantId: string) => void
  testID?: string
}): React.JSX.Element {
  const t = useStrings()
  const pieces = shopping.cart.piecesOf(item.variantId)
  const quoted = pieces > 0 ? shopping.quote.quotedOf(item.variantId) : undefined
  /** The rate at the quantity in the basket once the engine has priced it, else the standing rate. */
  const rate = quoted?.ratePaise ?? shopping.rates.rateOf(item.variantId)?.ratePaise ?? null

  /*
   * THE OFFER: what the engine DID once there is a quantity, else what the offer IS. `appliedRules`
   * is the money that actually came off and the pieces that were actually added — the same figures
   * the bill will print (UX-01 R5) — and before the item is in the basket the tile says the offer in
   * a few words instead.
   */
  const off = (quoted?.discountPaise ?? 0) + (quoted?.bargainPaise ?? 0)
  const free = quoted?.freeQtyPcs ?? 0
  const applied =
    off > 0 || free > 0
      ? [
          off > 0 ? `−${formatMoney(off)}` : '',
          free > 0 ? t('r7.free', { pieces: String(free) }) : '',
        ]
          .filter((part) => part !== '')
          .join(' · ')
      : null
  const named = shopping.offers
    .forItem(item)
    .map((scheme) => tileOffer(t, scheme))
    .find((phrase): phrase is string => phrase !== null)
  const offer = applied ?? named

  /*
   * STOCK, IN THE ORDER SCREEN'S OWN WORDS, BEFORE THE + AS WELL AS AFTER IT (retailer check,
   * 2026-09-28). The tile used to say nothing until something was in the basket, and then the kit
   * stepper's line — "Only 0 cs available — rest short-supplied" for 4 pieces left of a 48-piece case,
   * appended to "1 cs = 48 pc · 19 cs available", which wrapped in a two-across tile. So the tile no
   * longer hands the stepper `availablePieces` and says it itself: nothing when there is plenty,
   * "Out of stock", "Only 4 pc left", or — once the basket holds more than that — that the shop may
   * get less. A hint, never a block: the distributor reserves stock when it confirms the order.
   */
  const available = shopping.stock.availableOf(item.variantId)
  const stock =
    available === null
      ? undefined
      : available <= 0
        ? t('r7.outOfStock')
        : pieces > available
          ? t('r2.stockShort', { pieces: String(available) })
          : available < item.caseSize
            ? t('r7.lowStock', { pieces: String(available) })
            : undefined

  return (
    <ProductTile
      name={displayName(item)}
      brand={brandOf(item)}
      pack={packLine(t, item)}
      rate={rate}
      rateUnit={t('r2.perPiece')}
      mrp={item.mrpPaise}
      {...(offer === undefined || offer === null ? {} : { offer })}
      pieces={pieces}
      caseSize={item.caseSize}
      onChange={(next) => {
        shopping.setQty(item.variantId, next)
      }}
      onOpenPieces={() => {
        onOpenPieces(item.variantId)
      }}
      {...(stock === undefined ? {} : { stock })}
      {...(testID === undefined ? {} : { testID })}
    />
  )
}

/**
 * "{count} items · {total}" and "See order" at the foot of every shopping screen. The total is the
 * engine's quote of the basket; while the basket has moved on and the new quote is on its way, the
 * last figure is printed as "about" (`cartTotal`). An empty basket draws no bar at all.
 */
export function ShopCartBar({ shopping }: { shopping: Shopping }): React.JSX.Element {
  const t = useStrings()
  const go = useGo()
  return (
    <CartBar
      testID="shop-cart"
      count={shopping.cart.count}
      total={shopping.quote.total}
      approximate={shopping.quote.approximate}
      actionLabel={t('r2.seeOrder')}
      onAction={() => {
        go.push('/order')
      }}
    />
  )
}
