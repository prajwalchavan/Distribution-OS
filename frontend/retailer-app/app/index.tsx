/**
 * R2 — the shop's home: one card per linked distributor, and under it what the OPEN one owes,
 * what is on the way, and the two taps that reorder (docs/23 §6.1 R2 and R7).
 *
 * THE SWITCHER IS THE APP'S SPINE. One shopkeeper login can belong to several distributors on this
 * platform (`ramesh.gupta` buys from three in the pilot data), and every read below — catalog,
 * prices, orders, bills, ledger — is scoped to the distributor that is OPEN. So the cards sit at the
 * top, the open one names itself in words rather than by colour alone, and switching goes through
 * `auth.switchTenant`, which mints a token for the other tenant. The dues on a card that is not open
 * are deliberately NOT fetched: reading them would mean switching the session behind the reader's
 * back, three times, on the screen that opens the app.
 *
 * "REORDER IN 2 TAPS" (docs/23 §6). Tap one is "Order again", which calls `orders.repeatLast` — the
 * server copies the shop's last non-cancelled order and RE-PRICES it today, so the shop never carries
 * yesterday's rate. Tap two is "Place order" on the editor it opens.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
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
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { absoluteUrl } from '../src/config'
import { instantWithClock, longDate, shortDate } from '../src/lib/dates'
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

  const [switching, setSwitching] = useState<string | null>(null)
  const [repeatError, setRepeatError] = useState<string | null>(null)

  /**
   * Tap one of the two-tap reorder. `repeatLast` needs a client-generated id for the NEW draft, and
   * `useMutation` hands both that id and the idempotency key: a double tap on a slow connection
   * reuses them and cannot leave two drafts behind.
   */
  const repeat = useMutation(
    (_input: { retailerId: string }, meta) =>
      api.api.orders.repeatLast({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        retailerId: _input.retailerId,
        source: 'retailer_app',
      }),
    { invalidates: [['orders']] },
  )

  const summary = dues.data
  const bill = [...(lastBill.data?.items ?? [])].sort(
    (a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.id.localeCompare(a.id),
  )[0]
  const coming = (stops.data?.items ?? []).filter((stop) => OPEN_STOPS.has(stop.state))
  const memberships = session?.memberships ?? []
  const openTenantId = session?.tenant.id ?? ''

  const orderAgain = (): void => {
    if (retailerId === null) return
    setRepeatError(null)
    void repeat.mutateAsync({ retailerId }).then(
      (result) => {
        router.push(`/order?orderId=${result.item.id}`)
      },
      (error: unknown) => {
        setRepeatError(
          error instanceof Error && error.message !== '' ? error.message : t('r7.repeatFailed'),
        )
      },
    )
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
                loading={repeat.status === 'pending'}
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
          meta={memberships.length > 1 ? t('r2.duesElsewhere') : t('r2.oneOnly')}
          testID="r2-distributors"
        >
          <Stack gap={3}>
            {memberships.map((membership) => {
              const open = membership.tenantId === openTenantId
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
                    {open ? (
                      <Row gap={3} wrap>
                        <StatusChip
                          label={t('r2.owes')}
                          family={duesFamily(
                            summary?.overduePaise ?? 0,
                            summary?.outstandingPaise ?? 0,
                          )}
                        />
                        <Money value={summary?.outstandingPaise ?? null} size="moneyM" />
                      </Row>
                    ) : (
                      <Button
                        label={t('r2.switch', { name: membership.displayName })}
                        variant="secondary"
                        loading={switching === membership.tenantId}
                        onPress={() => {
                          setSwitching(membership.tenantId)
                          void switchDistributor(membership.tenantId).finally(() => {
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
              {repeatError === null ? null : (
                <Txt
                  field="body"
                  desk="body"
                  color={colors.status.brick.fg}
                  testID="r2-repeat-error"
                >
                  {repeatError}
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
                          date: longDate((order.submittedAt ?? order.createdAt).slice(0, 10)),
                        })}
                        trailingMoney={order.totalPaise}
                        trailing={
                          <StatusChip label={word(order.state)} family={orderFamily(order.state)} />
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
