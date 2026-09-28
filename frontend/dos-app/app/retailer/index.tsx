/**
 * R2 — the shop front: the shopkeeper's home (founder, 2026-09-28: "a shopping app feel, not some
 * complex feel"; "minimise the understanding effort").
 *
 * WHAT IT IS, TOP TO BOTTOM. The distributor that is open, as one chip — in the phone shell's own
 * header, at the top of the page on a desk (`DistributorChip`). "Search items". "Order again", one
 * slim card with its button beside the words, two taps to a placed order (UX-01 R3). "Your items" — what this shop buys most often, as
 * tiles with the rate it pays and a big +. "Shop by brand". The offers running today, as a short row.
 * A van on its way, if there is one. One slim line for money. Everything the home used to open on —
 * the distributor cards, the four figures, the last orders, call and WhatsApp — is still here: the
 * cards behind the chip, the rest folded under "More". Nothing was removed from the product.
 *
 * ONE BASKET. Every + on this page goes into the same basket as the brand pages and the order screen
 * (`src/groups/retailer/lib/cart.ts`): kept across screens and restarts, one per distributor, emptied
 * when an order is placed and when the shop signs out. The bar at the foot says what is in it and what
 * the engine that prices the bill says it comes to (UX-01 R5), "about" until that answer is in.
 *
 * NO PHOTOS YET (founder, 2026-09-28): there is no image field in the catalogue, so a tile's picture is
 * its brand's initial on the brand's own colour (`<ProductTile>`).
 *
 * THE FIRST SCREEN OF A PHONE SELLS (retailer check, 2026-09-28). At 390 × 844 the old top — an
 * 86 px header holding only "⋯", the chip on a row of its own, a 178 px last-order card with a
 * full-width button, and wide gaps — left 0 complete tiles and 0 "+ Add" above the tab bar. The chip
 * moved into the header, the last-order card became one row, and the gaps close up on a phone, so the
 * first two of "Your items" stand whole, "+ Add" and all, before any scroll.
 *
 * EVERY READ IS FOR THE DISTRIBUTOR THAT IS OPEN, and there is never a merged view (UX-01 R11): the
 * chip names it, and the only place several distributors appear side by side is the sheet behind it,
 * one card each.
 *
 * "ORDER AGAIN" WRITES NOTHING UNTIL "PLACE ORDER" (DOS-098). Tap one opens the order screen with a
 * fresh `?repeat=` id, which puts the shop's last PLACED order in the basket at today's prices; tap two
 * is "Place order" there.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  Box,
  BrandTile,
  Button,
  EmptyState,
  Group,
  KpiStrip,
  ListRow,
  Money,
  MoreGroup,
  Pressable,
  Row,
  Screen,
  Scroll,
  Search,
  Stack,
  StatusChip,
  TileGrid,
  Txt,
  formatMoney,
  tileColumns,
  useColors,
  useGo,
  useStrings,
  useViewport,
} from '@dos/ui'
import type { JobAction } from '@dos/ui'
import { uuidv7 } from '@dos/domain'
import { links } from '@dos/ui/platform'
import { useState } from 'react'

import {
  NO_BRAND,
  brandsOf,
  displayName,
  isSearching,
  matchItems,
} from '../../src/groups/retailer/lib/catalog'
import { instantWithClock, longInstant, shortDate } from '../../src/groups/retailer/lib/dates'
import { DistributorChip, dialable, digitsOnly } from '../../src/groups/retailer/lib/distributors'
import { offerSentence, scopeSentence } from '../../src/groups/retailer/lib/offer'
import { usePiecesEntry } from '../../src/groups/retailer/lib/pieces'
import { useMyShop } from '../../src/groups/retailer/lib/shop'
import { ItemTile, ShopCartBar } from '../../src/groups/retailer/lib/shop-ui'
import {
  PLACED_STATES,
  useLastOrder,
  useShopping,
  useUsualItems,
  type Shopping,
} from '../../src/groups/retailer/lib/shopping'
import { Async, Panel, orderFamily } from '../../src/groups/retailer/lib/ui'
import { useWord } from '../../src/groups/retailer/lib/words'

/** A stop the shop is still waiting for; `completed`, `failed` and `skipped` are behind it. */
const OPEN_STOPS = new Set(['pending', 'started', 'arrived'])

/** Search shows this many tiles at most; typing more narrows it. */
const MAX_MATCHES = 40

export default function Home(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const go = useGo()
  const viewport = useViewport()
  const { session } = useSession()
  const signedIn = session !== null
  const distributor = session?.tenant.displayName ?? ''

  const shopping = useShopping()
  const { my, list, cart } = shopping
  const retailerId = my.retailerId

  const [query, setQuery] = useState('')
  /*
   * A search typed at one distributor is not carried to the next: the chip that switches may be in
   * the shell's header, outside this screen, so the home notices the switch itself.
   */
  const tenantId = session?.tenant.id ?? null
  const [queryTenant, setQueryTenant] = useState(tenantId)
  if (queryTenant !== tenantId) {
    setQueryTenant(tenantId)
    setQuery('')
  }
  /** A phone closes up the gaps: the first screen is for products (see the header comment). */
  const phone = viewport.kind === 'phone'

  const pieces = usePiecesEntry({
    nameOf: (variantId) => {
      const item = list.byVariant.get(variantId)
      return item === undefined ? '' : displayName(item)
    },
    piecesOf: cart.piecesOf,
    setQty: shopping.setQty,
    testID: 'r2-pieces',
  })

  const usual = useUsualItems()
  const last = useLastOrder(retailerId, list)
  const dues = useQuery(
    ['outstanding', retailerId],
    () =>
      api.api.receivables.outstanding.get({ retailerId: retailerId ?? '', includeBills: false }),
    { enabled: signedIn && retailerId !== null },
  )
  const stops = useQuery(
    ['stops', retailerId],
    () => api.api.delivery.stops.list({ retailerId: retailerId ?? '', limit: 20 }),
    { enabled: signedIn && retailerId !== null },
  )

  const searching = isSearching(query)
  const matches = searching ? matchItems(list.items, query) : []

  /** Two rows of tiles at the width this is drawn at: six on a phone, ten on a desk. */
  const shown = Math.max(6, tileColumns(viewport.width) * 2)
  const yourItems = usual.variantIds
    .map((variantId) => list.byVariant.get(variantId))
    .filter((item) => item !== undefined)
    .slice(0, shown)
  const brands = brandsOf(list.items)
  const coming = (stops.data?.items ?? []).find((stop) => OPEN_STOPS.has(stop.state))
  const comingOrder = coming?.deliveries.find((row) => row.orderId !== null)?.orderId ?? null

  /** Tap one of the two-tap reorder (DOS-098): a fresh `repeat` id per tap, nothing written. */
  const orderAgain = (): void => {
    if (retailerId === null) return
    go.push(`/order?repeat=${uuidv7()}`)
  }

  const seeAll = (
    <Button
      label={t('r2.seeAll')}
      variant="ghost"
      onPress={() => {
        go.push('/order')
      }}
      fullWidth={false}
      testID="r2-see-all"
    />
  )

  return (
    <Screen testID="r2-screen" bottomBar={<ShopCartBar shopping={shopping} />}>
      <Stack gap={phone ? 4 : 6}>
        {/* --- 1. the distributor that is open: in the header on a phone (`_layout.tsx`) ---------- */}
        {phone ? null : <DistributorChip place="page" />}

        {/* --- 2. search --------------------------------------------------------------------- */}
        {my.unlinked ? null : (
          <Box maxWidth={640}>
            <Search
              testID="r2-search"
              value={query}
              onChange={setQuery}
              placeholder={t('r2.searchItems')}
              state={
                !searching
                  ? 'idle'
                  : list.isLoading
                    ? 'typing'
                    : matches.length === 0
                      ? 'noResults'
                      : 'results'
              }
            />
          </Box>
        )}

        <Async state={[my, list]} rows={4}>
          {my.unlinked ? (
            <EmptyState
              testID="r2-unlinked"
              message={`${t('r2.noShop')} — ${t('r2.noShopBody', { name: distributor })}`}
            />
          ) : searching ? (
            /* --- search results, in place of the shop front ------------------------------- */
            <Panel
              title={
                matches.length === 1
                  ? t('r2.matchOne')
                  : t('r2.matches', { count: String(matches.length) })
              }
              testID="r2-results"
            >
              {matches.length === 0 ? (
                <Txt field="body" desk="body" color={colors.text.secondary} testID="r2-no-match">
                  {t('r2.noMatch', { query: query.trim() })}
                </Txt>
              ) : (
                <Stack gap={4}>
                  <TileGrid testID="r2-result-tiles">
                    {matches.slice(0, MAX_MATCHES).map((item) => (
                      <ItemTile
                        key={item.variantId}
                        item={item}
                        shopping={shopping}
                        onOpenPieces={pieces.open}
                        testID={`r2-tile-${item.variantId}`}
                      />
                    ))}
                  </TileGrid>
                  {matches.length > MAX_MATCHES ? (
                    <Txt field="label" desk="meta" color={colors.text.secondary}>
                      {t('r2.moreMatches', { count: String(MAX_MATCHES) })}
                    </Txt>
                  ) : null}
                </Stack>
              )}
            </Panel>
          ) : (
            <Stack gap={phone ? 6 : 8}>
              {/* --- 3. order again ------------------------------------------------------- */}
              {last.state === 'ready' || last.state === 'reading' ? (
                <LastOrderCard
                  title={t('r2.lastOrderTitle')}
                  subtitle={
                    last.state === 'reading'
                      ? undefined
                      : last.totalPaise === null
                        ? last.lines.length === 1
                          ? t('r2.lastOrderCountOne')
                          : t('r2.lastOrderCount', { count: String(last.lines.length) })
                        : last.lines.length === 1
                          ? t('r2.lastOrderLineOne', { amount: roundRupees(last.totalPaise) })
                          : t('r2.lastOrderLine', {
                              count: String(last.lines.length),
                              amount: roundRupees(last.totalPaise),
                            })
                  }
                  onPress={
                    last.orderId === null
                      ? undefined
                      : () => {
                          go.push(`/orders/${last.orderId ?? ''}`)
                        }
                  }
                  primary={{
                    // With things already in the basket the button says it ADDS to them.
                    label: cart.count > 0 ? t('r2.addLastOrder') : t('r2.orderAgain'),
                    onPress: orderAgain,
                    disabled: last.state !== 'ready',
                    disabledReason: last.state !== 'ready' ? t('r7.pricing') : undefined,
                    testID: 'r2-order-again',
                  }}
                />
              ) : null}

              {/* --- 4. your items -------------------------------------------------------- */}
              {yourItems.length === 0 ? null : (
                <Panel title={t('r2.yourItems')} actions={seeAll} testID="r2-your-items">
                  <TileGrid testID="r2-your-tiles">
                    {yourItems.map((item) => (
                      <ItemTile
                        key={item.variantId}
                        item={item}
                        shopping={shopping}
                        onOpenPieces={pieces.open}
                        testID={`r2-tile-${item.variantId}`}
                      />
                    ))}
                  </TileGrid>
                </Panel>
              )}

              {/* --- 5. shop by brand ----------------------------------------------------- */}
              {brands.length === 0 ? (
                <EmptyState message={t('r2.empty', { name: distributor })} />
              ) : (
                <Panel
                  title={t('r2.byBrand')}
                  actions={yourItems.length === 0 ? seeAll : undefined}
                  testID="r2-brands"
                >
                  <Scroll horizontal testID="r2-brand-row">
                    <Row gap={3} padY={1}>
                      {brands.map((brand) => (
                        <Box key={brand.id} width={136}>
                          <BrandTile
                            name={brand.id === NO_BRAND ? t('r2.otherItems') : (brand.name ?? '')}
                            detail={
                              brand.count === 1
                                ? t('r2.brandItemsOne')
                                : t('r2.brandItems', { count: String(brand.count) })
                            }
                            onPress={() => {
                              go.push(`/brand/${brand.id}`)
                            }}
                            testID={`r2-brand-${brand.id}`}
                          />
                        </Box>
                      ))}
                    </Row>
                  </Scroll>
                </Panel>
              )}

              {/* --- 6. offers ------------------------------------------------------------- */}
              <OffersRow shopping={shopping} />

              {/* --- 7. on the way --------------------------------------------------------- */}
              {coming === undefined ? null : (
                <Pressable
                  onPress={() => {
                    go.push(comingOrder === null ? '/orders' : `/orders/${comingOrder}`)
                  }}
                  testID="r2-coming"
                >
                  <Box border="all" borderTone="faint" radius="md" padX={4} padY={3}>
                    <Row gap={3} justify="between" align="center">
                      <Txt field="bodyStrong" desk="section">
                        {coming.state === 'arrived'
                          ? t('r2.atYourShop')
                          : coming.etaAt === null
                            ? t('r2.onTheWayNoEta')
                            : t('r2.onTheWay', { when: instantWithClock(coming.etaAt) })}
                      </Txt>
                      <Txt field="bodyStrong" desk="section" color={colors.accent.fg}>
                        ›
                      </Txt>
                    </Row>
                  </Box>
                </Pressable>
              )}

              {/* --- 8. money, one slim line ------------------------------------------------ */}
              <Row gap={4} justify="between" align="center" wrap testID="r2-money">
                {dues.data !== undefined && dues.data.outstandingPaise === 0 ? (
                  <Txt field="body" desk="body" color={colors.text.secondary}>
                    {t('r2.nothingOwed')}
                  </Txt>
                ) : (
                  <Row gap={2} align="center">
                    <Txt field="body" desk="body" color={colors.text.secondary}>
                      {t('r2.owes')}
                    </Txt>
                    <Money value={dues.data?.outstandingPaise ?? null} size="moneyM" />
                  </Row>
                )}
                {dues.data !== undefined && dues.data.outstandingPaise === 0 ? null : (
                  <Button
                    label={t('r2.payNow')}
                    variant="secondary"
                    onPress={() => {
                      go.push('/pay')
                    }}
                    fullWidth={false}
                    testID="r2-pay"
                  />
                )}
              </Row>

              {/* --- everything that is not shopping, folded ------------------------------- */}
              {/* No count beside "More": "More 3" did not say what the 3 was (retailer check). */}
              <MoreGroup id="retailer.home.more" testID="r2-more">
                <HomeMore />
              </MoreGroup>
            </Stack>
          )}
        </Async>
      </Stack>

      {pieces.sheet}
    </Screen>
  )
}

/** "about ₹8,400": a figure said as "about" is said in whole rupees. */
function roundRupees(paise: number): string {
  return formatMoney(Math.round(paise / 100) * 100).replace(/\.00$/, '')
}

/**
 * "Your last order": ONE slim card, the words on the left and "Order again" beside them (founder,
 * 2026-09-28: the order-again card; UX-01 R3: two taps to a placed order). The kit's `<JobCard>` puts
 * its primary button full width on a phone, under the words; here that made a 178 px card that, with
 * the header, pushed every "+ Add" below the fold (retailer check, 2026-09-28). The body opens the
 * order it repeats; the button is its own target beside it, never inside it (a button inside a button
 * is dead to the touch on the web).
 */
function LastOrderCard({
  title,
  subtitle,
  onPress,
  primary,
}: {
  title: string
  subtitle?: string | undefined
  onPress?: (() => void) | undefined
  primary: JobAction
}): React.JSX.Element {
  const colors = useColors()
  const words = (
    <Stack gap={1}>
      <Txt field="bodyStrong" desk="section" numberOfLines={1}>
        {title}
      </Txt>
      {subtitle === undefined ? null : (
        <Txt field="label" desk="meta" color={colors.text.secondary} numberOfLines={2}>
          {subtitle}
        </Txt>
      )}
    </Stack>
  )
  return (
    <Box
      border="all"
      borderTone="faint"
      radius="lg"
      padX={3}
      padY={2}
      background="surface"
      maxWidth={640}
      testID="r2-last-order"
    >
      <Row gap={3} align="center">
        <Box grow>
          {onPress === undefined ? (
            words
          ) : (
            <Pressable onPress={onPress} label={title} testID="r2-last-order-open">
              {words}
            </Pressable>
          )}
        </Box>
        <Button
          label={primary.label}
          variant="primary"
          onPress={primary.onPress}
          fullWidth={false}
          disabled={primary.disabled}
          disabledReason={primary.disabledReason}
          testID={primary.testID}
        />
      </Row>
    </Box>
  )
}

/** The offers running today, as a short row that opens the Offers page. */
function OffersRow({ shopping }: { shopping: Shopping }): React.JSX.Element | null {
  const t = useStrings()
  const colors = useColors()
  const go = useGo()
  const running = shopping.offers.running
  if (running.length === 0) return null
  const brandName = (id: string | null): string | undefined => {
    if (id === null) return undefined
    return shopping.list.items.find((item) => item.brandId === id)?.brandName ?? undefined
  }
  const open = (): void => {
    go.push('/deals')
  }
  return (
    <Panel
      title={t('r2.offers')}
      actions={
        <Button
          label={t('r2.seeOffers')}
          variant="ghost"
          onPress={open}
          fullWidth={false}
          testID="r2-see-offers"
        />
      }
      testID="r2-offers"
    >
      <Scroll horizontal testID="r2-offer-row">
        <Row gap={3} padY={1}>
          {running.slice(0, 8).map((scheme) => (
            <Box key={scheme.id} width={232}>
              <Pressable onPress={open} testID={`r2-offer-${scheme.id}`}>
                <Box
                  border="all"
                  borderTone="faint"
                  radius="md"
                  pad={3}
                  background="surface"
                  minHeight={112}
                >
                  <Stack gap={1}>
                    <Txt field="bodyStrong" desk="section" numberOfLines={3}>
                      {offerSentence(t, scheme)}
                    </Txt>
                    <Txt field="label" desk="meta" color={colors.text.secondary} numberOfLines={1}>
                      {scopeSentence(t, scheme, brandName(scheme.brandId))}
                    </Txt>
                  </Stack>
                </Box>
              </Pressable>
            </Box>
          ))}
        </Row>
      </Scroll>
    </Panel>
  )
}

/**
 * What the home used to open on and is not shopping: the four figures, the last orders, and a way to
 * call or message the distributor (founder, 2026-09-28: everything that is not a job goes under
 * "More"; nothing is removed). Its reads run only once "More" is opened.
 */
function HomeMore(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const colors = useColors()
  const go = useGo()
  const { session } = useSession()
  const signedIn = session !== null
  const distributor = session?.tenant.displayName ?? ''
  const my = useMyShop()
  const retailerId = my.retailerId

  const dues = useQuery(
    ['outstanding', retailerId],
    () =>
      api.api.receivables.outstanding.get({ retailerId: retailerId ?? '', includeBills: false }),
    { enabled: signedIn && retailerId !== null },
  )
  /*
   * "YOUR LAST ORDERS" MEANS ORDERS THE SHOP ACTUALLY PLACED — never a draft (DOS-098); newest first
   * by the moment it was sent.
   */
  const orders = useQuery(
    ['orders', 'recent'],
    () => api.api.orders.list({ limit: 20, states: [...PLACED_STATES] }),
    { enabled: signedIn },
  )
  const recentOrders = [...(orders.data?.items ?? [])]
    .sort((a, b) => (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt))
    .slice(0, 5)
  /*
   * "LAST BILL" MEANS THE MOST RECENT BILL, WHICH IS NOT THE FIRST ROW OF PAGE ONE: the page is read
   * and the newest INVOICE DATE picked here, which is also right for a bill entered late.
   */
  const lastBill = useQuery(
    ['invoices', 'last'],
    () => api.api.billing.invoices.list({ limit: 50 }),
    { enabled: signedIn },
  )
  const bill = [...(lastBill.data?.items ?? [])].sort(
    (a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.id.localeCompare(a.id),
  )[0]
  /** DOS-103: no number set, no button — a Call button that dials nothing is worse than none. */
  const branding = useQuery(['tenancy', 'branding'], () => api.api.tenancy.branding.get(), {
    enabled: signedIn,
    staleTime: 300_000,
  })
  const officePhone = branding.data?.phone ?? null
  const summary = dues.data

  return (
    <Stack gap={6}>
      <Stack gap={3}>
        <KpiStrip
          testID="r2-kpis"
          items={[
            { label: t('r2.shop'), value: my.shop?.name ?? '—' },
            {
              label: t('r2.overdue'),
              value: <Money value={summary?.overduePaise ?? null} size="cell" />,
              tone: (summary?.overduePaise ?? 0) > 0 ? 'critical' : 'neutral',
            },
            { label: t('r2.openBills'), value: String(summary?.openBills ?? 0) },
            {
              label: t('r2.lastBill'),
              value:
                bill === undefined
                  ? '—'
                  : `${bill.invoiceNo ?? '—'} · ${shortDate(bill.invoiceDate)}`,
            },
          ]}
        />
        {summary?.lastReceiptAt === null || summary === undefined ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary} testID="r2-last-paid">
            {`${t('r2.lastPaid')}: ${formatMoney(summary.lastReceiptPaise ?? 0)} · ${instantWithClock(
              summary.lastReceiptAt,
            )}`}
          </Txt>
        )}
      </Stack>

      <Panel
        title={t('r2.lastOrders')}
        actions={
          <Button
            label={t('r2.seeAllOrders')}
            variant="ghost"
            onPress={() => {
              go.push('/orders')
            }}
            fullWidth={false}
            testID="r2-all-orders"
          />
        }
        testID="r2-orders"
      >
        <Async
          state={[orders]}
          rows={3}
          empty={recentOrders.length === 0}
          emptyMessage={t('r2.noOrders')}
        >
          <Group>
            {/* `<ListRow>` IS the tap target — never wrapped in a `<Pressable>` (a button inside a
                button is dead to the touch on the web). */}
            {recentOrders.map((order) => (
              <ListRow
                key={order.id}
                primary={
                  order.orderNo === null ? t('r8.draft') : t('r8.orderNo', { no: order.orderNo })
                }
                secondary={t('r8.placedOn', {
                  // DOS-143: an INSTANT reads its IST business date, never a UTC slice.
                  date: longInstant(order.submittedAt ?? order.createdAt),
                })}
                trailingMoney={order.totalPaise}
                trailing={
                  <StatusChip label={word(order.state)} family={orderFamily(order.state)} />
                }
                onPress={() => {
                  go.push(`/orders/${order.id}`)
                }}
                testID={`r2-order-${order.id}`}
              />
            ))}
          </Group>
        </Async>
      </Panel>

      {officePhone === null ? null : (
        <Panel title={t('r2.contact', { name: distributor })} testID="r2-contact">
          <Row gap={3} wrap>
            <Button
              label={t('r2.call')}
              variant="secondary"
              onPress={() => {
                void links.open(`tel:${dialable(officePhone)}`)
              }}
              testID="r2-call"
            />
            <Button
              label={t('rt.whatsapp')}
              variant="secondary"
              onPress={() => {
                void links.open(`https://wa.me/${digitsOnly(officePhone)}`)
              }}
              testID="r2-whatsapp"
            />
          </Row>
        </Panel>
      )}
    </Stack>
  )
}
