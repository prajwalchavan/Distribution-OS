/**
 * R2 — the shop's home: one card per linked distributor, and under it what the OPEN one owes,
 * what is on the way, and the two taps that reorder (docs/23 §6.1 R2 and R7).
 *
 * THE SWITCHER IS THE APP'S SPINE. One shopkeeper login can belong to several distributors on this
 * platform (`ramesh.gupta` buys from three in the pilot data), and every read below — catalog,
 * prices, orders, bills, ledger — is scoped to the distributor that is OPEN. So the cards sit at the
 * top, the open one names itself in words rather than by colour alone, and switching goes through
 * `auth.switchTenant`, which mints a token for the other tenant.
 *
 * WHAT EVERY CARD SHOWS (DOS-102). Each distributor's dues, its last bill and any van on the way, plus
 * the total owed across all of them — from ONE call, `auth.memberships.summary`. That read lives on
 * auth-service because it is cross-tenant by nature; it reads each tenant under this login's own
 * membership role inside `withTenant`, so nothing appears that a switch would not have shown, and the
 * session is never switched behind the reader's back. It carries no credit limit and no credit
 * available: ADR 0006 keeps both off this app.
 *
 * "REORDER IN 2 TAPS" (docs/23 §6). Tap one is "Order again", which opens the order screen on the basket
 * of the shop's most recently PLACED order — whoever placed it, never a draft — RE-PRICED today, so the
 * shop never carries yesterday's rate, and writes nothing (`orders.lastPlaced`, DOS-098). Tap two is
 * "Place order" on that screen.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  Box,
  Button,
  EmptyState,
  Group,
  KpiStrip,
  ListRow,
  Money,
  Row,
  Screen,
  Stack,
  StatusChip,
  TenantLogo,
  Txt,
  formatMoney,
  useColors,
  useStrings,
} from '@dos/ui'
import { uuidv7 } from '@dos/domain'
import { links } from '@dos/ui/platform'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { absoluteUrl } from '../src/config'
import { instantWithClock, longInstant, shortDate } from '../src/lib/dates'
import { rememberDistributor } from '../src/lib/last-distributor'
import { useMyShop } from '../src/lib/shop'
import { Async, Panel, duesFamily, orderFamily } from '../src/lib/ui'
import { useWord } from '../src/lib/words'

/** A stop the shop is still waiting for; `completed`, `failed` and `skipped` are behind it. */
const OPEN_STOPS = new Set(['pending', 'started', 'arrived'])

export default function Home(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session, switchDistributor } = useSession()
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
   * "YOUR LAST ORDERS" MEANS ORDERS THE SHOP ACTUALLY PLACED.
   *
   * `orders.list` unfiltered returns DRAFTS too — an unsent basket, and on the founder's own data the
   * rows `pnpm smoke` leaves behind — and each printed as "Not sent yet · Placed —" under a heading
   * that says these are the shop's last orders. A draft is reachable and finishable on My orders,
   * where the row says so; it does not belong in this list. `orders.list` pages by id, which for
   * seeded rows is not chronological, so the page is sorted here (an API gap: no `orderBy`).
   */
  const orders = useQuery(
    ['orders', 'recent'],
    () =>
      api.api.orders.list({
        limit: 20,
        states: [
          'submitted',
          'confirmed',
          'picking',
          'packed',
          'dispatched',
          'partially_delivered',
          'delivered',
          'closed',
        ],
      }),
    { enabled: signedIn },
  )
  const recentOrders = [...(orders.data?.items ?? [])]
    .sort((a, b) => (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt))
    .slice(0, 5)
  /*
   * "LAST BILL" MEANS THE MOST RECENT BILL, WHICH IS NOT THE FIRST ROW OF PAGE ONE.
   *
   * `billing.invoices.list` pages by `id DESC` and carries no `orderBy` (an API gap, docs/23 §10):
   * for seeded and imported rows an id is not a date, so `limit: 1` answered whichever bill happened
   * to sort highest. Measured on the founder's data: the home screen named INV/0031 of 27 Aug as
   * this shop's last bill while its actual last bill was INV/9125 of 5 Sep. The page is read and the
   * newest INVOICE DATE picked here, which is also right for a bill entered late or back-dated.
   */
  const lastBill = useQuery(
    ['invoices', 'last'],
    () => api.api.billing.invoices.list({ limit: 50 }),
    { enabled: signedIn },
  )
  const stops = useQuery(
    ['stops', retailerId],
    () => api.api.delivery.stops.list({ retailerId: retailerId ?? '', limit: 20 }),
    { enabled: signedIn && retailerId !== null },
  )

  /**
   * DOS-102: every distributor's dues, last bill and van, in one call. `auth.*` is routed to the auth
   * service by the client, so this does not need the open tenant's own service.
   */
  const across = useQuery(['memberships', 'summary'], () => api.api.auth.memberships.summary(), {
    enabled: signedIn,
    staleTime: 60_000,
  })
  const acrossBy = new Map((across.data?.items ?? []).map((item) => [item.tenantId, item]))

  /**
   * DOS-103: the office number, so the shop can call or WhatsApp the distributor it is looking at.
   * ABSENT means the owner has set none, and then there is no button at all — a Call button that
   * dials nothing is worse than no button.
   */
  const branding = useQuery(['tenancy', 'branding'], () => api.api.tenancy.branding.get(), {
    enabled: signedIn,
    staleTime: 300_000,
  })
  const officePhone = branding.data?.phone ?? null

  const [switching, setSwitching] = useState<string | null>(null)

  const summary = dues.data
  const bill = [...(lastBill.data?.items ?? [])].sort(
    (a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.id.localeCompare(a.id),
  )[0]
  const coming = (stops.data?.items ?? []).filter((stop) => OPEN_STOPS.has(stop.state))
  const memberships = session?.memberships ?? []
  const openTenantId = session?.tenant.id ?? ''

  /**
   * Tap one of the two-tap reorder (DOS-098). It opens the order screen on the basket of the shop's most
   * recently placed order and writes nothing; tap two, "Place order", sends it. Every tap carries its own
   * `repeat` id, so it is a fresh read of the last placed order whether expo-router remounts the order
   * screen or only changes its params, and no tap can leave a draft behind.
   */
  const orderAgain = (): void => {
    if (retailerId === null) return
    router.push(`/order?repeat=${uuidv7()}`)
  }

  return (
    <Screen
      title={t('r2.title')}
      context={distributor}
      testID="r2-screen"
      bottomBar={
        my.unlinked ? undefined : (
          <Row gap={4} justify="between" align="center" wrap>
            <Stack gap={1}>
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {t('r2.owes')}
              </Txt>
              <Money value={summary?.outstandingPaise ?? null} size="moneyL" />
            </Stack>
            <Row gap={4} wrap>
              <Button
                label={t('r2.payNow')}
                variant="secondary"
                onPress={() => {
                  router.push('/pay')
                }}
                testID="r2-pay"
              />
              <Button
                label={t('r2.orderAgain')}
                variant="primary"
                onPress={orderAgain}
                testID="r2-order-again"
              />
            </Row>
          </Row>
        )
      }
    >
      <Stack gap={6}>
        {/* --- the distributor cards ------------------------------------------------------- */}
        <Panel
          title={t('r2.distributors')}
          meta={memberships.length > 1 ? undefined : t('r2.oneOnly')}
          testID="r2-distributors"
        >
          <Stack gap={3}>
            {memberships.length > 1 ? (
              <Txt field="label" desk="meta" color={colors.text.secondary} testID="r2-total">
                {t('r2.owedAcross', {
                  total: formatMoney(across.data?.totalOutstandingPaise ?? 0),
                  count: String(memberships.length),
                })}
              </Txt>
            ) : null}
            {memberships.map((membership) => {
              const open = membership.tenantId === openTenantId
              const card = acrossBy.get(membership.tenantId)
              return (
                <Box
                  key={membership.tenantId}
                  border="all"
                  borderTone={open ? 'strong' : 'faint'}
                  radius="md"
                  pad={4}
                  background={open ? 'raised' : 'surface'}
                  testID={`r2-card-${membership.tenantSlug}`}
                >
                  <Stack gap={3}>
                    <TenantLogo
                      size="card"
                      name={membership.displayName}
                      logoUrl={absoluteUrl(membership.logoUrl)}
                      withName
                      subtitle={
                        open ? t('r2.openHere', { name: membership.displayName }) : undefined
                      }
                    />
                    {/*
                      DOS-102: the dues line is on EVERY card now, open or not — that is the whole
                      point of one home for a shop that buys from three distributors. The open card
                      prefers its own `receivables.outstanding.get` (the same figure the KPI strip and
                      the bottom bar show, refreshed with them); the others read the summary.
                    */}
                    <Row gap={3} wrap>
                      <StatusChip
                        label={t('r2.owes')}
                        family={duesFamily(
                          (open ? summary?.overduePaise : card?.overduePaise) ?? 0,
                          (open ? summary?.outstandingPaise : card?.outstandingPaise) ?? 0,
                        )}
                      />
                      <Money
                        value={(open ? summary?.outstandingPaise : card?.outstandingPaise) ?? null}
                        size="moneyM"
                      />
                    </Row>
                    <Txt
                      field="label"
                      desk="meta"
                      color={colors.text.secondary}
                      testID={`r2-card-${membership.tenantSlug}-bills`}
                    >
                      {card?.lastBill === undefined || card.lastBill === null
                        ? t('r2.noBillsYet')
                        : t('r2.cardLastBill', {
                            no: card.lastBill.invoiceNo ?? t('app.none'),
                            date: shortDate(card.lastBill.invoiceDate),
                            amount: formatMoney(card.lastBill.totalPaise),
                          })}
                    </Txt>
                    {card?.onTheWay === undefined || card.onTheWay === null ? null : (
                      <Txt
                        field="label"
                        desk="meta"
                        color={colors.text.primary}
                        testID={`r2-card-${membership.tenantSlug}-coming`}
                      >
                        {card.onTheWay.state === 'arrived'
                          ? t('r2.vanHere')
                          : card.onTheWay.etaAt !== null
                            ? t('r2.vanEta', { when: instantWithClock(card.onTheWay.etaAt) })
                            : t('r2.vanComing', { count: String(card.onTheWay.stops) })}
                      </Txt>
                    )}
                    {/* DOS-103: only on the distributor that is OPEN — `tenancy.branding.get` is
                        scoped by the token, so the other cards' numbers are simply not known here. */}
                    {open && officePhone !== null ? (
                      <Row gap={3} wrap>
                        <Button
                          label={t('rt.call', { name: membership.displayName })}
                          variant="secondary"
                          onPress={() => {
                            void links.open(`tel:${dialable(officePhone)}`)
                          }}
                          testID={`r2-card-${membership.tenantSlug}-call`}
                        />
                        <Button
                          label={t('rt.whatsapp')}
                          variant="secondary"
                          onPress={() => {
                            void links.open(`https://wa.me/${digitsOnly(officePhone)}`)
                          }}
                          testID={`r2-card-${membership.tenantSlug}-whatsapp`}
                        />
                      </Row>
                    ) : null}
                    {open ? null : (
                      <Button
                        label={t('r2.switch', { name: membership.displayName })}
                        variant="secondary"
                        loading={switching === membership.tenantId}
                        onPress={() => {
                          setSwitching(membership.tenantId)
                          void switchDistributor(membership.tenantId)
                            .then((next) => {
                              rememberDistributor(next.tenant.id)
                            })
                            .finally(() => {
                              setSwitching(null)
                            })
                        }}
                        testID={`r2-switch-${membership.tenantSlug}`}
                      />
                    )}
                  </Stack>
                </Box>
              )
            })}
          </Stack>
        </Panel>

        {/* --- this distributor's shop ------------------------------------------------------ */}
        <Async state={[my, dues]} rows={3}>
          {my.unlinked ? (
            <EmptyState
              testID="r2-unlinked"
              message={`${t('r2.noShop')} — ${t('r2.noShopBody', { name: distributor })}`}
            />
          ) : (
            <Stack gap={6}>
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

              {/* --- on the way ------------------------------------------------------------- */}
              <Panel title={t('r2.nextDelivery')} testID="r2-coming">
                <Async
                  state={[stops]}
                  rows={2}
                  empty={coming.length === 0}
                  emptyMessage={t('r2.noDelivery')}
                >
                  <Group>
                    {coming.slice(0, 3).map((stop) => (
                      <ListRow
                        key={stop.id}
                        primary={
                          stop.deliveries.length === 0
                            ? word(stop.state)
                            : t('r8.bill', {
                                no:
                                  stop.deliveries
                                    .map((row) => row.invoiceNo ?? '')
                                    .filter((no) => no !== '')
                                    .join(', ') || '—',
                              })
                        }
                        secondary={
                          stop.etaAt === null
                            ? t('r8.stopState', { state: word(stop.state) })
                            : t('r8.eta', { when: instantWithClock(stop.etaAt) })
                        }
                        trailingMoney={stop.deliveries.reduce(
                          (sum, row) => sum + row.invoiceTotalPaise,
                          0,
                        )}
                        trailing={<StatusChip label={word(stop.state)} family="clay" />}
                      />
                    ))}
                  </Group>
                </Async>
              </Panel>

              {/* --- last orders ------------------------------------------------------------- */}
              <Panel
                title={t('r2.recentOrders')}
                actions={
                  <Button
                    label={t('r2.newOrder')}
                    variant="ghost"
                    onPress={() => {
                      router.push('/order')
                    }}
                    testID="r2-new-order"
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
                    {/*
                     * `<ListRow>` IS the tap target — never wrapped in a `<Pressable>`.
                     *
                     * The web renderer draws a row as a real `<button>` and DISABLES it when it has
                     * no `onPress` of its own. A `<Pressable>` around one therefore nests a button
                     * inside a button (invalid HTML, a React hydration error) and, worse, a disabled
                     * inner button swallows the pointer over the whole row, so the outer handler
                     * never fires: measured here on the home screen and on My orders, where every
                     * row was dead to the touch.
                     */}
                    {recentOrders.map((order) => (
                      <ListRow
                        key={order.id}
                        primary={
                          order.orderNo === null
                            ? t('r8.draft')
                            : t('r8.orderNo', { no: order.orderNo })
                        }
                        secondary={t('r8.placedOn', {
                          // DOS-143: an INSTANT reads its IST business date, never a UTC slice.
                          date: longInstant(order.submittedAt ?? order.createdAt),
                        })}
                        trailingMoney={order.totalPaise}
                        trailing={
                          <StatusChip
                            // DOS-100: `submitted` with approval flags is an order the office still
                            // has to sign off, not one already on its way — "With the distributor"
                            // told the shop nothing was wrong while it waited for a decision.
                            label={
                              order.state === 'submitted' && order.approvalFlags.length > 0
                                ? t('word.submittedHeld')
                                : word(order.state)
                            }
                            family={orderFamily(order.state)}
                          />
                        }
                        onPress={() => {
                          router.push(`/orders/${order.id}`)
                        }}
                        testID={`r2-order-${order.id}`}
                      />
                    ))}
                  </Group>
                </Async>
              </Panel>

              <Txt
                field="label"
                desk="meta"
                color={colors.text.secondary}
                testID="r2-order-again-body"
              >
                {t('r2.orderAgainBody')}
              </Txt>
            </Stack>
          )}
        </Async>
      </Stack>
    </Screen>
  )
}

/**
 * DOS-103: the office number as a phone will accept it. The owner types whatever they like in
 * Settings ("0251 234 5678", "+91 251 234 5678"); a `tel:` URI wants digits and at most a leading
 * plus, and `wa.me` wants digits alone with the country code. A bare ten-digit Indian number gets
 * `91` in front — the shop and the distributor are in the same country, and a number that is already
 * international is left exactly as it is.
 */
function digitsOnly(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.length === 10 ? `91${digits}` : digits
}

function dialable(phone: string): string {
  const digits = digitsOnly(phone)
  return `+${digits}`
}
