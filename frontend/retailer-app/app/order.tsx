/**
 * R7 — the price list this shop actually gets, and the order built from it (docs/23 §6.1 R7).
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
 * retailer role for its own draft: two calls, `create` (or `setLines` on a repeat draft) then
 * `submit`, each with its own client-generated id and idempotency key, so a double tap on a bad
 * connection writes one order.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import type { OrderLine, QuotedLine, TenantProduct } from '@dos/contracts'
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
  useStrings,
} from '@dos/ui'
import { uuidv7 } from '@dos/domain'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { today } from '../src/lib/dates'
import { useMyShop } from '../src/lib/shop'
import { Async, Panel } from '../src/lib/ui'

/** One line as the screen holds it while it is being typed. Pieces are the state; cases are typing. */
interface DraftLine {
  /** The line's own client-generated UUIDv7 — the id the order row will carry. */
  id: string
  variantId: string
  qtyPcs: number
  /** What the shop typed, and in what — carried to the order so the bill reprints it (docs/17 A3). */
  enteredQty: number
  /** The contract's own unit, so a repeat draft's `inner` pack entry survives being loaded here. */
  enteredUnit: OrderLine['enteredUnit']
}

export default function PlaceOrder(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null
  const distributor = session?.tenant.displayName ?? ''
  const params = useLocalSearchParams<{ orderId?: string }>()
  const seedOrderId = typeof params.orderId === 'string' ? params.orderId : null

  const my = useMyShop()
  const retailerId = my.retailerId

  const [query, setQuery] = useState('')
  const [lines, setLines] = useState<readonly DraftLine[]>([])
  const [seeded, setSeeded] = useState(false)
  const [note, setNote] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [askVariant, setAskVariant] = useState<string | null>(null)
  const [askRate, setAskRate] = useState<number | null>(null)

  // --- what this distributor sells, and what is on the shelf --------------------------------
  const catalog = useQuery(
    ['catalog', query],
    () =>
      api.api.tenantCatalog.list({
        limit: 200,
        listedOnly: true,
        ...(query.trim().length >= 2 ? { q: query.trim() } : {}),
      }),
    { enabled: signedIn, staleTime: 300_000 },
  )
  const stock = useQuery(['sellable'], () => api.api.inventory.stock.sellable({ limit: 500 }), {
    enabled: signedIn,
    staleTime: 60_000,
  })

  /**
   * Available-to-promise per item, summed across the distributor's locations.
   *
   * `stock.sellable` answers ONE ROW PER LOT PER LOCATION — the same item appears many times — so a
   * screen that read the first row would tell a shop "1 pc left" of something the godown has cartons
   * of. It is a hint, never a promise: the order is reserved when the distributor confirms it.
   */
  const available = useMemo(() => {
    const totals = new Map<string, number>()
    for (const row of stock.data?.items ?? [])
      totals.set(row.variantId, (totals.get(row.variantId) ?? 0) + row.available)
    return totals
  }, [stock.data])

  const items = catalog.data?.items ?? []
  const byVariant = useMemo(() => {
    const map = new Map<string, TenantProduct>()
    for (const item of items) map.set(item.variantId, item)
    return map
  }, [items])

  // --- a repeat draft: the server already copied and re-priced the lines ----------------------
  const seed = useQuery(
    ['order', seedOrderId],
    () => api.api.orders.get({ id: seedOrderId ?? '' }),
    { enabled: signedIn && seedOrderId !== null && !seeded },
  )
  useEffect(() => {
    if (seeded || seed.data === undefined) return
    setLines(
      seed.data.item.lines.map((line) => ({
        id: line.id,
        variantId: line.variantId,
        qtyPcs: line.qtyPcs,
        enteredQty: line.enteredQty,
        enteredUnit: line.enteredUnit,
      })),
    )
    setSeeded(true)
  }, [seed.data, seeded])

  // --- the live price -------------------------------------------------------------------------
  /*
   * DEBOUNCED, because every tap on a stepper is a new order. `pricing.quote` is a real round trip to
   * the distributor's service; firing one per tap would put a shop's thumb ahead of the answer and
   * paint three stale totals on the way to the right one. 400 ms after the last tap, one call.
   */
  const priced = lines.filter((line) => line.qtyPcs > 0)
  const [settled, setSettled] = useState<readonly DraftLine[]>([])
  /*
   * `wanted` is the IDENTITY of the lines and `pricedRef` holds the array itself: `priced` is rebuilt
   * on every render, so depending on it would restart the timer forever and no quote would ever fire.
   */
  const wanted = JSON.stringify(priced.map((line) => [line.id, line.variantId, line.qtyPcs]))
  const pricedRef = useRef(priced)
  pricedRef.current = priced
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(pricedRef.current)
    }, 400)
    return () => {
      clearTimeout(timer)
    }
  }, [wanted])

  const quoteKey = JSON.stringify(settled.map((line) => [line.variantId, line.qtyPcs]))
  const quote = useQuery(
    ['quote', retailerId, quoteKey],
    () =>
      api.api.pricing.quote({
        retailerId: retailerId ?? '',
        pricingDate: today(),
        lines: settled.map((line) => ({
          lineId: line.id,
          variantId: line.variantId,
          qtyPcs: line.qtyPcs,
        })),
      }),
    { enabled: signedIn && retailerId !== null && settled.length > 0, staleTime: 30_000 },
  )
  const quoted = useMemo(() => {
    const map = new Map<string, QuotedLine>()
    for (const line of quote.data?.lines ?? []) map.set(line.lineId, line)
    return map
  }, [quote.data])

  /**
   * THE PRICE LIST HAS TO CARRY PRICES.
   *
   * The founder's brief is "the catalog with the prices this shop actually gets — its tier, its
   * overrides, the schemes it qualifies for". The order quote above only prices what is already in
   * the basket, so a shop opening this screen saw a list of names, pack sizes and MRPs and not one
   * rate it would actually pay — on the screen whose whole job is the price.
   *
   * So the catalogue is quoted ONCE at one piece per item, through the same engine: at a quantity of
   * one, no quantity scheme triggers, and what comes back is exactly the shop's own standing rate —
   * its tier price, with its retailer override and any rate its distributor has agreed applied.
   * `listRatePaise` beside it is the distributor's list rate, so a shop can see it is getting
   * something better. Schemes then show themselves on the row as soon as a quantity is chosen,
   * because the order quote takes over from there.
   */
  const listVariants = items.map((item) => item.variantId)
  const listKey = JSON.stringify(listVariants)
  const listQuote = useQuery(
    ['list-quote', retailerId, listKey],
    () =>
      api.api.pricing.quote({
        retailerId: retailerId ?? '',
        pricingDate: today(),
        lines: listVariants.map((variantId) => ({ lineId: variantId, variantId, qtyPcs: 1 })),
      }),
    {
      enabled: signedIn && retailerId !== null && listVariants.length > 0,
      staleTime: 300_000,
    },
  )
  const listRates = useMemo(() => {
    const map = new Map<string, QuotedLine>()
    for (const line of listQuote.data?.lines ?? []) map.set(line.variantId, line)
    return map
  }, [listQuote.data])

  // --- writing ---------------------------------------------------------------------------------
  /*
   * `['order']` IS ON EVERY ONE OF THESE, AND THAT IS NOT A DETAIL.
   *
   * The cache invalidates by key PREFIX, and this screen reads the repeat draft under `['order', id]`
   * while `/orders/[id]` reads the very same key. `['orders']` does not prefix `['order', id]` — a
   * different first element — so after "Place order" the detail screen this one navigates to served
   * the cached DRAFT for its 30-second freshness window. Measured: `setLines` 200, `submit` 200, and
   * the shop landed on a screen headed "Not sent yet" with a live "Send this order" button under an
   * order the distributor had already accepted.
   */
  const create = useMutation(
    (input: { retailerId: string; lines: readonly DraftLine[]; note: string }, meta) =>
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
  const replace = useMutation(
    (input: { orderId: string; lines: readonly DraftLine[] }, meta) =>
      api.api.orders.setLines({
        id: input.orderId,
        idempotencyKey: meta.idempotencyKey,
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

  const busy =
    create.status === 'pending' || replace.status === 'pending' || submit.status === 'pending'

  const place = (): void => {
    if (retailerId === null || priced.length === 0 || busy) return
    setFailure(null)
    const first =
      seedOrderId === null
        ? create.mutateAsync({ retailerId, lines: priced, note: note.trim() })
        : replace.mutateAsync({ orderId: seedOrderId, lines: priced })
    void first.then(
      (result) =>
        submit.mutateAsync({ orderId: result.item.id }).then(
          (done) => {
            setLines([])
            setNote('')
            /*
             * The confirmation belongs to the screen the shop ends up on. A `setToast` after a
             * `router.replace` sets state on a screen that is being unmounted: nothing was ever
             * drawn, and the shop's only sign that its order went was a number in a title.
             */
            router.replace(`/orders/${done.item.id}?placed=1`)
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

  const setQty = (variantId: string, pieces: number): void => {
    const item = byVariant.get(variantId)
    const caseSize = item?.caseSize ?? 1
    setLines((current) => {
      const existing = current.find((line) => line.variantId === variantId)
      const entered =
        caseSize > 1 && pieces % caseSize === 0
          ? { enteredQty: pieces / caseSize, enteredUnit: 'case' as const }
          : { enteredQty: Math.max(pieces, 1), enteredUnit: 'piece' as const }
      if (existing === undefined) {
        if (pieces <= 0) return current
        return [...current, { id: uuidv7(), variantId, qtyPcs: pieces, ...entered }]
      }
      if (pieces <= 0) return current.filter((line) => line.variantId !== variantId)
      return current.map((line) =>
        line.variantId === variantId ? { ...line, qtyPcs: pieces, ...entered } : line,
      )
    })
  }

  /** The items in the order first, then the rest of the price list — the thumb's own order. */
  const chosen = priced
    .map((line) => ({ line, item: byVariant.get(line.variantId) }))
    .filter((row): row is { line: DraftLine; item: TenantProduct } => row.item !== undefined)
  const chosenIds = new Set(priced.map((line) => line.variantId))
  const rest = items.filter((item) => !chosenIds.has(item.variantId))

  const totals = quote.data?.totals
  const unpricedNames = chosen
    .filter((row) => settled.some((line) => line.id === row.line.id) && !quoted.has(row.line.id))
    .map((row) => row.item.name)

  const askItem = askVariant === null ? undefined : byVariant.get(askVariant)
  const askLine = priced.find((line) => line.variantId === askVariant)
  const askQuoted = askLine === undefined ? undefined : quoted.get(askLine.id)

  return (
    <Screen
      title={t('r7.title')}
      context={distributor}
      testID="r7-screen"
      bottomBar={
        <Row gap={4} justify="between" align="center" wrap>
          <Stack gap={1}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {quote.isFetching ? t('r7.pricing') : t('r7.net')}
            </Txt>
            <Money value={totals?.netPaise ?? null} size="moneyL" />
          </Stack>
          <Button
            label={t('r7.place')}
            variant="primary"
            loading={busy}
            disabled={priced.length === 0 || retailerId === null}
            {...(priced.length === 0 ? { disabledReason: t('r7.empty') } : {})}
            onPress={place}
            testID="r7-place"
          />
        </Row>
      }
    >
      <Stack gap={6}>
        <Async state={[my, catalog]} rows={4}>
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
              {listQuote.error === undefined ? null : (
                <Txt
                  field="body"
                  desk="body"
                  color={colors.status.ochre.fg}
                  testID="r7-rates-failed"
                >
                  {t('r7.ratesFailed')}
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
                        setLines([])
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
                        availablePieces={available.get(item.variantId) ?? null}
                        quoted={quoted.get(line.id)}
                        standing={listRates.get(item.variantId)}
                        onChange={(pieces) => {
                          setQty(item.variantId, pieces)
                        }}
                        onAsk={() => {
                          setAskVariant(item.variantId)
                          setAskRate(quoted.get(line.id)?.ratePaise ?? null)
                        }}
                      />
                    ))}
                  </Group>
                </Panel>
              )}

              {/* --- the totals -------------------------------------------------------------- */}
              {totals === undefined ? null : (
                <Panel title={t('r7.total')} testID="r7-totals">
                  <Stack gap={2}>
                    <TotalRow label={t('r7.gross')} value={totals.grossPaise} />
                    <TotalRow
                      label={t('r7.discount')}
                      value={-(totals.discountPaise + totals.bargainPaise)}
                    />
                    <TotalRow label={t('r7.net')} value={totals.netPaise} strong />
                    {(quote.data?.cashDiscountPaise ?? 0) > 0 ? (
                      <Txt
                        field="label"
                        desk="meta"
                        color={colors.status.moss.fg}
                        testID="r7-cash-discount"
                      >
                        {my.shop !== null && my.shop.cashDiscountDays > 0
                          ? t('r7.cashDiscount', {
                              days: String(my.shop.cashDiscountDays),
                              amount: formatMoney(quote.data?.cashDiscountPaise ?? 0),
                            })
                          : t('r7.cashDiscountNoWindow', {
                              amount: formatMoney(quote.data?.cashDiscountPaise ?? 0),
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
                      query.trim().length < 2
                        ? 'idle'
                        : catalog.isFetching
                          ? 'typing'
                          : items.length === 0
                            ? 'noResults'
                            : 'results'
                    }
                  />
                  <Group>
                    {rest.map((item) => (
                      <OrderRow
                        key={item.variantId}
                        item={item}
                        pieces={0}
                        availablePieces={available.get(item.variantId) ?? null}
                        quoted={undefined}
                        standing={listRates.get(item.variantId)}
                        onChange={(pieces) => {
                          setQty(item.variantId, pieces)
                        }}
                        onAsk={undefined}
                      />
                    ))}
                  </Group>
                  {rest.length === 0 && chosen.length === 0 ? (
                    <Txt
                      field="body"
                      desk="body"
                      color={colors.text.secondary}
                      testID="r7-no-items"
                    >
                      {query.trim().length >= 2 ? t('r7.noMatch', { query }) : t('r7.noItems')}
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
          askItem === undefined ? t('r7.askBetter') : t('r7.askBetterOn', { item: askItem.name })
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
 * TWO RATES, TWO DIFFERENT FACTS. `standing` is the item quoted at one piece — this shop's own rate
 * before any quantity scheme, which is what a price list is for. `quoted` is the line as the engine
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
  onAsk,
}: {
  item: TenantProduct
  pieces: number
  availablePieces: number | null
  quoted: QuotedLine | undefined
  standing: QuotedLine | undefined
  onChange: (pieces: number) => void
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
          {pieces > 0 ? <Money value={quoted?.lineNetPaise ?? null} size="moneyM" /> : null}
          {scheme === undefined ? null : <StatusChip label={scheme} family="clay" figure />}
        </Stack>
      </Row>
      <QtyStepper
        pieces={pieces}
        caseSize={caseSize}
        onChange={onChange}
        availablePieces={availablePieces}
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
