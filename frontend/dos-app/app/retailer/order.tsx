/**
 * R7 — the shop's basket and the price list it is built from (docs/23 §6.1 R7).
 *
 * THE BASKET IS THE SHOP'S, NOT THIS SCREEN'S (founder, 2026-09-28: "a shopping app feel"). It used to
 * be `useState` here and was lost the moment the shop left this screen. It is now the one basket of
 * `src/groups/retailer/lib/cart.ts`, filled from the home, a brand page and search as much as from here:
 * kept across screens and restarts, one per distributor, emptied when this screen places the order and
 * when the shop signs out. The price reads (`pricing.rates`, the debounced `pricing.quote`) and the
 * "Pieces" pad moved beside it (`shopping.ts`, `pieces.tsx`) so every screen that sells prices alike.
 *
 * WHAT MAKES THIS SCREEN THE PRODUCT. A distributor's price list is not one list: it is the tier this
 * shop is on, the overrides set for this shop alone, the schemes it qualifies for and any rate its
 * distributor has agreed with it. Nothing here works any of that out. Every figure on the screen
 * comes from `pricing.quote` — the SAME engine (`priceOrder()` in `@dos/domain`) that prices the
 * order when it is placed and the bill when it is issued — so a shop never sees a rate its bill will
 * contradict. The sales app prices on the DEVICE because a rep has no signal in a lane; this app is
 * online only (docs/23 §6.4), so it asks the server and says so when it cannot.
 *
 * WHAT A SHOP MAY NOT SEE. Not a cost, not a landed price, not a margin, not who funds a scheme —
 * `tenant_product_costs` is back-office at the database and `schemes.list` answers the public shape
 * to this role. This screen therefore has no field that could carry one.
 *
 * SUBMIT IS THE SHOP'S OWN (founder decision, docs/22 §8 2026-09-05). `orders.submit` accepts the
 * retailer role for its own draft: two calls, `create` then `submit`, each with its own
 * client-generated id and idempotency key, so a double tap on a bad connection writes one order.
 *
 * "ORDER AGAIN" WRITES NOTHING UNTIL "PLACE ORDER" (DOS-098). Home opens this screen with a fresh
 * `?repeat=` id per tap; the shop's most recently placed order is read from `orders.lastPlaced` and its
 * items join the basket, in the pieces that order carried, and are placed through the same two calls.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import type { QuotedLine, RateItem, TenantProduct } from '@dos/contracts'
import {
  Button,
  Group,
  Money,
  QtyStepper,
  Row,
  Screen,
  Search,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  RupeeInput,
  caseLine,
  formatMoney,
  useColors,
  useGo,
  useStrings,
} from '@dos/ui'
import { uuidv7 } from '@dos/domain'
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'

import {
  toOrderLines,
  type CartLine,
  type OrderLineDraft,
} from '../../src/groups/retailer/lib/cart'
import { displayName, isSearching, matchItems } from '../../src/groups/retailer/lib/catalog'
import { usePiecesEntry } from '../../src/groups/retailer/lib/pieces'
import { useShopping } from '../../src/groups/retailer/lib/shopping'
import { Async, Panel } from '../../src/groups/retailer/lib/ui'

export default function PlaceOrder(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const go = useGo()
  const { session } = useSession()
  const signedIn = session !== null
  const distributor = session?.tenant.displayName ?? ''
  const params = useLocalSearchParams<{ repeat?: string }>()
  /** "Order again": a fresh id per tap on Home, so every tap is its own read of the last placed order. */
  const repeat = typeof params.repeat === 'string' ? params.repeat : null

  const shopping = useShopping()
  const { my, list, cart } = shopping
  const retailerId = my.retailerId

  const [query, setQuery] = useState('')
  /** The `repeat` id whose basket has been built (or refused), so a tap is seeded exactly once. */
  const [seededFor, setSeededFor] = useState<string | null>(null)
  /** Items of the repeated order left out because they are no longer on the price list. */
  const [leftOut, setLeftOut] = useState(0)
  /** The repeated order joined a basket that already had things in it — said, never hidden. */
  const [joined, setJoined] = useState(false)
  const [note, setNote] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [askVariant, setAskVariant] = useState<string | null>(null)
  const [askRate, setAskRate] = useState<number | null>(null)

  // --- what this distributor sells, and what is on the shelf --------------------------------
  const items = list.items
  const byVariant = list.byVariant
  // Pieces left to promise per item at the godown; null = not known (src/lib/stock.ts, DOS-097).
  const stock = shopping.stock

  /*
   * DOS-101: type an exact piece count, for an item this shop buys below a whole case ("Only 9 pc
   * left") or just wants an odd amount of. The pad lives in `pieces.tsx` and commits through the
   * basket's own `setQty`, the same call a stepper tap makes.
   */
  const pieces = usePiecesEntry({
    nameOf: (variantId) => {
      const item = byVariant.get(variantId)
      return item === undefined ? '' : displayName(item)
    },
    piecesOf: cart.piecesOf,
    setQty: shopping.setQty,
  })

  // --- "Order again": the last placed order's items join the basket ---------------------------
  /*
   * NOTHING IS WRITTEN UNTIL "PLACE ORDER" (DOS-098).
   *
   * `orders.lastPlaced` names the shop's most recently PLACED order — by when it was placed, by whoever
   * placed it, never a draft — and writes nothing. Its items join the basket here and are re-priced by
   * the quote below like any other basket. The tap's own id is in the key and `staleTime` is 0, so a
   * second "Order again" after a placement never seeds from a cached answer naming the order before it.
   *
   * THE PIECES, NOT THE UNIT. Each item keeps the pieces that order carried; how they are entered is
   * worked out on placing from TODAY's case size (`toOrderLines`). The old line's entered quantity and
   * unit are never forwarded: `orders.create` re-derives pieces as entered quantity × case size and
   * counts an `inner` entry as a case, so a forwarded one would quote the old pieces on this screen and
   * place up to five times as many.
   *
   * NOTHING HIDDEN IS PLACED. Only items on the price list join the basket, and the screen says how
   * many of that order's items it left out. An item already in the basket keeps the quantity the shop
   * chose (the basket is kept now, so it may hold things from the home), and the screen says the last
   * order was ADDED to them. Until the items are in there is no stepper to tap: the screen shows its
   * skeleton, and a failed read opens the price list with the reason instead.
   */
  const lastPlaced = useQuery(
    ['orders', 'last-placed', retailerId, repeat],
    () => api.api.orders.lastPlaced({ retailerId: retailerId ?? '' }),
    {
      enabled: signedIn && repeat !== null && retailerId !== null && seededFor !== repeat,
      staleTime: 0,
    },
  )
  const awaitingSeed =
    signedIn &&
    repeat !== null &&
    retailerId !== null &&
    seededFor !== repeat &&
    lastPlaced.error === undefined

  // A new tap starts from a clean screen: no search filter, no message from the last attempt.
  useEffect(() => {
    if (repeat === null) return
    setQuery('')
    setLeftOut(0)
    setJoined(false)
    setFailure(null)
  }, [repeat])

  const { addLines, ready: cartReady, count: cartCount } = cart
  useEffect(() => {
    if (repeat === null || seededFor === repeat) return
    if (lastPlaced.error !== undefined) {
      setFailure(t('r7.repeatFailed'))
      setSeededFor(repeat)
      return
    }
    // The whole price list decides what can be shown, and it carries today's case size.
    if (lastPlaced.data === undefined || list.isLoading || !cartReady) return
    const { item } = lastPlaced.data
    if (item === null) {
      setFailure(t('r7.repeatEmpty'))
      setSeededFor(repeat)
      return
    }
    // One line per item, as the stepper keeps it: two lines of one item come back as their pieces together.
    const piecesOf = new Map<string, number>()
    for (const line of item.lines)
      piecesOf.set(line.variantId, (piecesOf.get(line.variantId) ?? 0) + line.qtyPcs)
    const seeded: CartLine[] = []
    let missing = 0
    for (const [variantId, qtyPcs] of piecesOf) {
      if (!byVariant.has(variantId)) {
        missing += 1
        continue
      }
      if (qtyPcs > 0) seeded.push({ id: uuidv7(), variantId, qtyPcs })
    }
    setJoined(cartCount > 0 && seeded.length > 0)
    addLines(seeded)
    setLeftOut(missing)
    setSeededFor(repeat)
  }, [
    repeat,
    seededFor,
    lastPlaced.data,
    lastPlaced.error,
    list.isLoading,
    byVariant,
    cartReady,
    cartCount,
    addLines,
    t,
  ])

  // --- the live price (`useCartQuote`: 400 ms after the last tap, one call) ---------------------
  const quote = shopping.quote
  const totals = quote.quote.data?.totals
  const listRates = shopping.rates

  /** Items the distributor stopped listing were taken out of the kept basket; said once, here. */
  const { removed, acknowledgeRemoved } = cart
  useEffect(
    () => () => {
      acknowledgeRemoved()
    },
    [acknowledgeRemoved],
  )

  // --- writing ---------------------------------------------------------------------------------
  /*
   * `['order']` IS ON EVERY ONE OF THESE, AND THAT IS NOT A DETAIL.
   *
   * The cache invalidates by key PREFIX, and `/orders/[id]` — where "Place order" lands — reads the
   * order under `['order', id]`. `['orders']` does not prefix `['order', id]` — a different first
   * element — so without `['order']` the detail screen could serve a cached copy of the order from
   * before it was sent, for its 30-second freshness window. Measured once: `submit` 200, and the shop
   * landed on a screen headed "Not sent yet" with a live "Send this order" button under an order the
   * distributor had already accepted.
   */
  const create = useMutation(
    (input: { retailerId: string; lines: readonly OrderLineDraft[]; note: string }, meta) =>
      api.api.orders.create({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        retailerId: input.retailerId,
        source: 'retailer_app',
        ...(input.note === '' ? {} : { note: input.note }),
        lines: input.lines.map((line) => ({
          id: line.id,
          variantId: line.variantId,
          enteredQty: line.enteredQty,
          enteredUnit: line.enteredUnit,
        })),
      }),
    { invalidates: [['orders'], ['order']] },
  )
  const submit = useMutation(
    (input: { orderId: string }, meta) =>
      api.api.orders.submit({ id: input.orderId, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['orders'], ['order'], ['outstanding']] },
  )
  const ask = useMutation(
    (input: { retailerId: string; variantId: string; ratePaise: number; qtyPcs: number }, meta) =>
      api.api.pricing.bargains.request({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        retailerId: input.retailerId,
        variantId: input.variantId,
        askedRatePaise: input.ratePaise,
        qtyPcs: input.qtyPcs,
      }),
    { invalidates: [['bargains']] },
  )

  const busy = create.status === 'pending' || submit.status === 'pending'

  /** The basket's lines whose item is on the price list: the only ones drawn, and so the only ones sent. */
  const priced = cart.lines.filter((line) => line.qtyPcs > 0 && byVariant.has(line.variantId))

  const place = (): void => {
    if (retailerId === null || priced.length === 0 || busy || awaitingSeed) return
    setFailure(null)
    const lines = toOrderLines(priced, (variantId) => byVariant.get(variantId)?.caseSize)
    void create.mutateAsync({ retailerId, lines, note: note.trim() }).then(
      (result) =>
        submit.mutateAsync({ orderId: result.item.id }).then(
          (done) => {
            // Placed: the basket is spent. The next one starts empty.
            void cart.clear()
            setNote('')
            /*
             * The confirmation belongs to the screen the shop ends up on. A `setToast` after a
             * `router.replace` sets state on a screen that is being unmounted: nothing was ever
             * drawn, and the shop's only sign that its order went was a number in a title.
             */
            go.replace(`/orders/${done.item.id}?placed=1`)
          },
          (error: unknown) => {
            setFailure(error instanceof Error ? error.message : t('r7.failed'))
          },
        ),
      (error: unknown) => {
        setFailure(error instanceof Error ? error.message : t('r7.failed'))
      },
    )
  }

  /** Set an item's pieces in the basket — a stepper tap and the pieces pad both come here. */
  const setQty = (variantId: string, qtyPcs: number): void => {
    shopping.setQty(variantId, qtyPcs)
  }

  /** The items in the order first, then the rest of the price list — the thumb's own order. */
  const chosen = priced
    .map((line) => ({ line, item: byVariant.get(line.variantId) }))
    .filter((row): row is { line: CartLine; item: TenantProduct } => row.item !== undefined)
  const chosenIds = new Set(priced.map((line) => line.variantId))
  const searching = isSearching(query)
  const shown = searching ? matchItems(items, query) : items
  const rest = shown.filter((item) => !chosenIds.has(item.variantId))

  /*
   * AN ITEM WITHOUT A GST RATE IS SAID, NOT HIDDEN (DOS-096).
   *
   * `pricing.quote` carries GST, and an item whose HSN has no rate on the day is a 400 that names the codes —
   * for the whole request, as an unpriced item already is. On the one-piece list quote that left every row
   * without a rate under "Prices could not be loaded just now", which no retry fixes. So the sentence naming
   * the missing rate stands where the list was, and an order quote refused for the same reason does not
   * call every item in it unpriced.
   */
  const listGstMissing = unratedHsnCodes(listRates.error)
  const orderGstMissing = unratedHsnCodes(quote.quote.error)
  const unpricedNames =
    orderGstMissing !== null
      ? []
      : chosen
          .filter(
            (row) =>
              quote.settled.some((line) => line.variantId === row.line.variantId) &&
              quote.quote.data !== undefined &&
              quote.quotedOf(row.line.variantId) === undefined,
          )
          .map((row) => row.item.name)

  const askItem = askVariant === null ? undefined : byVariant.get(askVariant)
  const askLine = priced.find((line) => line.variantId === askVariant)
  const askQuoted = askLine === undefined ? undefined : quote.quotedOf(askLine.variantId)

  return (
    <Screen
      title={t('r7.title')}
      context={distributor}
      testID="r7-screen"
      bottomBar={
        <Row gap={4} justify="between" align="center" wrap>
          <Stack gap={1}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {quote.quote.isFetching || quote.approximate ? t('r7.pricing') : t('r7.net')}
            </Txt>
            <Money value={priced.length === 0 ? null : quote.total} size="moneyL" />
          </Stack>
          <Button
            label={t('r7.place')}
            variant="primary"
            loading={busy}
            disabled={priced.length === 0 || retailerId === null || awaitingSeed}
            {...(priced.length === 0 ? { disabledReason: t('r7.empty') } : {})}
            onPress={place}
            testID="r7-place"
          />
        </Row>
      }
    >
      <Stack gap={6}>
        {/* While "Order again" builds its basket the skeleton stands in for the steppers; its failure is not
            an error state here — the price list opens with `r7-failure` saying why (DOS-098). */}
        <Async state={[my, list, { isLoading: awaitingSeed }]} rows={4}>
          {my.unlinked ? (
            <Txt field="body" desk="body" testID="r7-unlinked">
              {t('r2.noShopBody', { name: distributor })}
            </Txt>
          ) : (
            <Stack gap={6}>
              {failure === null ? null : (
                <Txt field="body" desk="body" color={colors.status.brick.fg} testID="r7-failure">
                  {failure}
                </Txt>
              )}
              {leftOut === 0 ? null : (
                <Txt
                  field="body"
                  desk="body"
                  color={colors.status.ochre.fg}
                  testID="r7-repeat-partial"
                >
                  {t('r7.repeatPartial', { count: String(leftOut) })}
                </Txt>
              )}
              {joined ? (
                <Txt
                  field="body"
                  desk="body"
                  color={colors.text.secondary}
                  testID="r7-repeat-joined"
                >
                  {t('r7.repeatAdded')}
                </Txt>
              ) : null}
              {removed === 0 ? null : (
                <Txt field="body" desk="body" color={colors.status.ochre.fg} testID="r7-removed">
                  {t('r7.removed', { count: String(removed), name: distributor })}
                </Txt>
              )}
              {listRates.error === undefined || listGstMissing !== null ? null : (
                <Txt
                  field="body"
                  desk="body"
                  color={colors.status.ochre.fg}
                  testID="r7-rates-failed"
                >
                  {t('r7.ratesFailed')}
                </Txt>
              )}
              {orderGstMissing === null || listGstMissing !== null ? null : (
                <Txt
                  field="body"
                  desk="body"
                  color={colors.status.ochre.fg}
                  testID="r7-order-no-gst-rate"
                >
                  {t('r7.noGstRate', { name: distributor, codes: orderGstMissing.join(', ') })}
                </Txt>
              )}
              {unpricedNames.length === 0 ? null : (
                <Txt field="body" desk="body" color={colors.status.ochre.fg} testID="r7-unpriced">
                  {`${unpricedNames.join(', ')} — ${t('r7.unpriced', { name: distributor })}`}
                </Txt>
              )}

              {/* --- what is in the order --------------------------------------------------- */}
              {chosen.length === 0 ? null : (
                <Panel
                  title={t('r7.chosen')}
                  meta={
                    chosen.length === 1 ? t('r7.linesOne') : t('r7.lines', { count: chosen.length })
                  }
                  actions={
                    <Button
                      label={t('r7.clear')}
                      variant="ghost"
                      onPress={() => {
                        void cart.clear()
                      }}
                      testID="r7-clear"
                    />
                  }
                  testID="r7-chosen"
                >
                  <Group>
                    {chosen.map(({ line, item }) => (
                      <OrderRow
                        key={line.id}
                        item={item}
                        pieces={line.qtyPcs}
                        availablePieces={stock.availableOf(item.variantId)}
                        quoted={quote.quotedOf(item.variantId)}
                        standing={listRates.rateOf(item.variantId)}
                        onChange={(next) => {
                          setQty(item.variantId, next)
                        }}
                        onOpenPieces={() => {
                          pieces.open(item.variantId)
                        }}
                        onAsk={() => {
                          setAskVariant(item.variantId)
                          setAskRate(quote.quotedOf(item.variantId)?.ratePaise ?? null)
                        }}
                      />
                    ))}
                  </Group>
                </Panel>
              )}

              {/* --- the totals -------------------------------------------------------------- */}
              {totals === undefined || chosen.length === 0 ? null : (
                <Panel title={t('r7.total')} testID="r7-totals">
                  <Stack gap={2}>
                    <TotalRow label={t('r7.gross')} value={totals.grossPaise} />
                    <TotalRow
                      label={t('r7.discount')}
                      value={-(totals.discountPaise + totals.bargainPaise)}
                    />
                    {/* The order's own GST and rounding, from the quote — the figures the placed order stores
                        (DOS-096). The bill re-reads GST on its own date, so a rate change in between moves it. */}
                    <TotalRow label={t('r7.beforeGst')} value={totals.netPaise} />
                    <TotalRow label={t('r7.gst')} value={totals.taxPaise} />
                    {totals.roundOffPaise === 0 ? null : (
                      <TotalRow label={t('r7.roundOff')} value={totals.roundOffPaise} />
                    )}
                    <TotalRow label={t('r7.net')} value={totals.totalPaise} strong />
                    {(quote.quote.data?.cashDiscountPaise ?? 0) > 0 ? (
                      <Txt
                        field="label"
                        desk="meta"
                        color={colors.status.moss.fg}
                        testID="r7-cash-discount"
                      >
                        {my.shop !== null && my.shop.cashDiscountDays > 0
                          ? t('r7.cashDiscount', {
                              days: String(my.shop.cashDiscountDays),
                              amount: formatMoney(quote.quote.data?.cashDiscountPaise ?? 0),
                            })
                          : t('r7.cashDiscountNoWindow', {
                              amount: formatMoney(quote.quote.data?.cashDiscountPaise ?? 0),
                            })}
                      </Txt>
                    ) : null}
                  </Stack>
                </Panel>
              )}

              {/*
                THE SCREEN OPENS ON THE PRICE LIST, NOT ON AN EMPTY BOX.

                With nothing chosen the two panels above render nothing, so this note floated to the
                top and a shop opening "Place an order" on a phone spent its first screen on
                "Anything to tell them" and a text box (UX-00 §8.2: open on the most likely next
                action). There is nothing to say about an order that does not exist yet.
              */}
              {chosen.length === 0 ? null : (
                <TextInput
                  label={t('r7.note')}
                  value={note}
                  onChange={setNote}
                  capitalize="sentences"
                  maxLength={500}
                  testID="r7-note"
                />
              )}

              {/* --- the price list ---------------------------------------------------------- */}
              <Panel title={t('r7.catalog')} testID="r7-catalog">
                <Stack gap={4}>
                  <Search
                    testID="r7-search"
                    value={query}
                    onChange={setQuery}
                    placeholder={t('r7.search')}
                    state={
                      !searching
                        ? 'idle'
                        : list.isLoading
                          ? 'typing'
                          : shown.length === 0
                            ? 'noResults'
                            : 'results'
                    }
                  />
                  {listGstMissing !== null ? (
                    <Txt
                      field="body"
                      desk="body"
                      color={colors.status.ochre.fg}
                      testID="r7-no-gst-rate"
                    >
                      {t('r7.noGstRate', { name: distributor, codes: listGstMissing.join(', ') })}
                    </Txt>
                  ) : (
                    <Group>
                      {rest.map((item) => (
                        <OrderRow
                          key={item.variantId}
                          item={item}
                          pieces={0}
                          availablePieces={stock.availableOf(item.variantId)}
                          quoted={undefined}
                          standing={listRates.rateOf(item.variantId)}
                          onChange={(next) => {
                            setQty(item.variantId, next)
                          }}
                          onOpenPieces={() => {
                            pieces.open(item.variantId)
                          }}
                          onAsk={undefined}
                        />
                      ))}
                    </Group>
                  )}
                  {listGstMissing === null && rest.length === 0 && chosen.length === 0 ? (
                    <Txt
                      field="body"
                      desk="body"
                      color={colors.text.secondary}
                      testID="r7-no-items"
                    >
                      {searching ? t('r7.noMatch', { query }) : t('r7.noItems')}
                    </Txt>
                  ) : null}
                </Stack>
              </Panel>
            </Stack>
          )}
        </Async>
      </Stack>

      {/* R10 — ask for a better rate. `pricing.bargains.request` is ANY_MEMBER; the answer lands on
          the Offers screen, which is the only place this app reports an outcome it did not decide. */}
      <Sheet
        open={askVariant !== null}
        onClose={() => {
          setAskVariant(null)
        }}
        title={
          askItem === undefined
            ? t('r7.askBetter')
            : t('r7.askBetterOn', { item: displayName(askItem) })
        }
        testID="r7-ask"
      >
        <Stack gap={4}>
          <Txt field="body" desk="body" color={colors.text.secondary}>
            {t('r7.askListRate', { rate: formatMoney(askQuoted?.ratePaise ?? 0) })}
          </Txt>
          <RupeeInput
            label={t('r7.askRate')}
            value={askRate}
            onChange={setAskRate}
            testID="r7-ask-rate"
          />
          <Button
            label={t('r7.askSend')}
            variant="primary"
            loading={ask.status === 'pending'}
            disabled={askRate === null || askRate <= 0 || retailerId === null}
            {...(askRate === null || askRate <= 0 ? { disabledReason: t('r7.askRate') } : {})}
            onPress={() => {
              if (retailerId === null || askVariant === null || askRate === null) return
              void ask
                .mutateAsync({
                  retailerId,
                  variantId: askVariant,
                  ratePaise: askRate,
                  qtyPcs: askLine?.qtyPcs ?? 1,
                })
                .then(
                  () => {
                    setAskVariant(null)
                    setToast(t('r7.askSent'))
                  },
                  (error: unknown) => {
                    setFailure(error instanceof Error ? error.message : t('r7.failed'))
                    setAskVariant(null)
                  },
                )
            }}
            fullWidth
            testID="r7-ask-send"
          />
        </Stack>
      </Sheet>

      {pieces.sheet}

      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="r7-toast"
      />
    </Screen>
  )
}

/**
 * The HSN codes a refused quote names when their GST rate is missing (DOS-096), else null. The service sends
 * them as `data.hsnCodes` on its 400; any other refusal keeps the screen's own sentence for it.
 */
function unratedHsnCodes(
  error: { status: number; data: unknown } | undefined,
): readonly string[] | null {
  if (error === undefined || error.status !== 400) return null
  const { data } = error
  if (typeof data !== 'object' || data === null) return null
  const codes = (data as { hsnCodes?: unknown }).hsnCodes
  if (!Array.isArray(codes) || codes.length === 0) return null
  const named = codes.filter((code): code is string => typeof code === 'string')
  return named.length === codes.length ? named : null
}

function TotalRow({
  label,
  value,
  strong = false,
}: {
  label: string
  value: number
  strong?: boolean
}): React.JSX.Element {
  const colors = useColors()
  return (
    <Row justify="between" align="center" gap={4}>
      <Txt
        field={strong ? 'bodyStrong' : 'body'}
        desk="body"
        color={strong ? undefined : colors.text.secondary}
      >
        {label}
      </Txt>
      <Money value={value} size={strong ? 'moneyM' : 'cell'} />
    </Row>
  )
}

/**
 * One item of the price list, with the rate this shop pays, its stock hint and the stepper.
 *
 * TWO RATES, TWO DIFFERENT FACTS. `standing` is the item priced at one piece by `pricing.rates` — this
 * shop's own rate before any quantity scheme, which is what a price list is for. `quoted` is the line as the engine
 * priced it AT THE CHOSEN QUANTITY, so once there is a quantity the scheme and the line total come
 * from that instead. Neither is worked out here.
 */
function OrderRow({
  item,
  pieces,
  availablePieces,
  quoted,
  standing,
  onChange,
  onOpenPieces,
  onAsk,
}: {
  item: TenantProduct
  pieces: number
  availablePieces: number | null
  quoted: QuotedLine | undefined
  standing: RateItem | undefined
  onChange: (pieces: number) => void
  onOpenPieces: () => void
  onAsk: (() => void) | undefined
}): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const caseSize = item.caseSize
  const stockLine =
    availablePieces === null
      ? t('r7.stockUnknown')
      : availablePieces <= 0
        ? t('r7.outOfStock')
        : availablePieces < caseSize
          ? t('r7.lowStock', { pieces: String(availablePieces) })
          : t('r7.inStock')

  /**
   * The offer, in the words the shop reads on the row (UX-00 §6.4 `schemeLabel`).
   *
   * `appliedRules` is what the ENGINE did to this line, so this is not a promise about a scheme — it
   * is the money that actually came off, plus the free pieces that actually got added.
   */
  /** The rate the shop pays: at the chosen quantity when there is one, else its standing rate. */
  const rate = quoted?.ratePaise ?? standing?.ratePaise ?? null
  const listRate = quoted?.listRatePaise ?? standing?.listRatePaise ?? null
  const betterThanList = rate !== null && listRate !== null && rate < listRate

  const off = (quoted?.discountPaise ?? 0) + (quoted?.bargainPaise ?? 0)
  const free = quoted?.freeQtyPcs ?? 0
  const scheme =
    off > 0 || free > 0
      ? [
          off > 0 ? `−${formatMoney(off)}` : '',
          free > 0 ? t('r7.free', { pieces: String(free) }) : '',
        ]
          .filter((part) => part !== '')
          .join(' · ')
      : undefined

  return (
    <Stack
      gap={2}
      padY={3}
      padX={3}
      border="bottom"
      borderTone="faint"
      testID={`r7-row-${item.variantId}`}
    >
      <Row gap={3} justify="between" align="start">
        <Stack gap={1} grow>
          <Txt field="bodyStrong" desk="cell" numberOfLines={2}>
            {item.localAlias ?? item.name}
          </Txt>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {[
              t('r7.case', { size: String(caseSize) }),
              item.mrpPaise === null ? '' : t('r7.mrp', { amount: formatMoney(item.mrpPaise) }),
              stockLine,
            ]
              .filter((part) => part !== '')
              .join(' · ')}
          </Txt>
          {rate === null ? null : (
            <Txt field="moneyM" desk="cell" numeric color={colors.text.secondary}>
              {[
                t('r7.perPiece', { rate: formatMoney(rate) }),
                betterThanList ? t('r7.yourRate', { list: formatMoney(listRate ?? 0) }) : '',
                pieces > 0 ? caseLine(pieces, caseSize, t) : '',
              ]
                .filter((part) => part !== '')
                .join(' · ')}
            </Txt>
          )}
        </Stack>
        <Stack gap={1} align="end">
          {/*
            A row that is not in the order has no line total, and `<Money value={null}>` draws an em
            dash — which on a phone sits at the top right of the row and reads like a control next to
            the stepper's own "−". The row already says "Not ordered".
          */}
          {pieces > 0 ? <Money value={quoted?.lineTotalPaise ?? null} size="moneyM" /> : null}
          {scheme === undefined ? null : <StatusChip label={scheme} family="clay" figure />}
        </Stack>
      </Row>
      <QtyStepper
        pieces={pieces}
        caseSize={caseSize}
        onChange={onChange}
        availablePieces={availablePieces}
        onOpenPieces={onOpenPieces}
        testID={`r7-qty-${item.variantId}`}
      />
      {onAsk === undefined ? null : (
        <Row justify="end">
          <Button
            label={t('r7.askBetter')}
            variant="ghost"
            onPress={onAsk}
            testID={`r7-ask-${item.variantId}`}
          />
        </Row>
      )}
    </Stack>
  )
}
