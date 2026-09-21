/**
 * S6 · My orders — ninety days of this rep's own orders, off the phone.
 *
 * The pull scopes `sales_orders` to `salesperson_id = me` and the last ninety days, so this list is
 * the same list with or without signal. Three things a rep looks for here, and each has its own chip:
 * what is still waiting to be sent, what has not been submitted yet, and what has been rejected.
 *
 * A row this device wrote and the server has not yet acknowledged says **Waiting to send** — never
 * "Placed". That distinction is the whole honesty contract of an offline app (UX-00 §6.11).
 *
 * FOUR VIEWS, ON A CHIP ROW (QA DOS-191). An order the office refused is `cancelled`, so it fell off
 * Travelling and lived only under All, one tap the rep had to think to take, about the one order a
 * shopkeeper is waiting to hear about. It now has its own filter — and a fourth option is why the
 * control is `<Chips>` and not `<Segments>`, which renders `items.slice(0, 3)` and drops the fourth
 * without a word; `PageTabs` makes the same switch at five destinations for the same reason.
 */
import { Chips, Money, Row, Screen, Stack, StatusChip, Txt, useColors, useStrings } from '@dos/ui'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { shortInstant } from '../../src/lib/dates'
import { useCatalogIndex, useLocalState, useMyOrders } from '../../src/lib/local'
import { useSubmitAcceptedDrafts } from '../../src/lib/queue'
import { LocalAsync, PageTabs, TwoLine, orderFamily } from '../../src/lib/ui'
import { useWord } from '../../src/lib/words'

type View = 'open' | 'refused' | 'draft' | 'all'

const PAGE = 100

const OPEN_STATES = new Set(['submitted', 'confirmed', 'picking', 'packed', 'dispatched'])

export default function MyOrders(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const word = useWord()
  const local = useLocalState()
  const { orders, loading } = useMyOrders(500)
  const { byVariant } = useCatalogIndex()
  const [view, setView] = useState<View>('open')
  /* DOS-086: a draft that lands while this list is open submits itself, the same as anywhere else. */
  useSubmitAcceptedDrafts()

  const refusedOrders = useMemo(() => orders.filter((order) => order.refused_at !== null), [orders])

  const matching = useMemo(() => {
    if (view === 'all') return orders
    if (view === 'draft') return orders.filter((order) => order.state === 'draft')
    if (view === 'refused') return refusedOrders
    return orders.filter((order) => OPEN_STATES.has(order.state))
  }, [orders, refusedOrders, view])

  /*
   * A cheap Android phone does not want 500 rows in the DOM, and a rep does not want to scroll them:
   * ninety days of a busy beat is hundreds of orders and the useful ones are at the top. So the page
   * is capped and SAYS it is capped — a list that silently stops is a list that has lost an order.
   */
  const rows = matching.slice(0, PAGE)
  const capped = matching.length > PAGE

  const waiting = orders.filter(
    (order) => order._pending === 'queued' || order._pending === 'sending',
  )
  const drafts = orders.filter((order) => order.state === 'draft')

  return (
    <Screen
      title={t('s6.title')}
      chips={
        <Row gap={2} wrap>
          <StatusChip
            label={t('s6.waitingCount', { count: waiting.length })}
            family={waiting.length === 0 ? 'neutral' : 'ochre'}
            figure
          />
          <StatusChip
            label={t('s6.draftCount', { count: drafts.length })}
            family={drafts.length === 0 ? 'neutral' : 'clay'}
            figure
          />
          {local.rejected === 0 ? null : (
            <StatusChip
              label={t('s5.rejectedCount', { count: local.rejected })}
              family="brick"
              solid
              figure
            />
          )}
        </Row>
      }
    >
      <Stack gap={4}>
        <PageTabs group="/orders" active="/orders" />

        <Chips
          testID="order-view"
          onToggle={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'open', label: t('s6.viewOpen'), selected: view === 'open' },
            {
              id: 'refused',
              label: t('s6.viewRefused'),
              selected: view === 'refused',
            },
            { id: 'draft', label: t('s6.viewDraft'), selected: view === 'draft' },
            { id: 'all', label: t('s6.viewAll'), selected: view === 'all' },
          ]}
        />

        <LocalAsync
          loading={loading}
          hydrated={local.hydrated}
          empty={rows.length === 0}
          emptyMessage={t('s6.empty')}
          rows={6}
        >
          <Stack testID="orders-list">
            {rows.map((order) => {
              const queued = order._pending === 'queued' || order._pending === 'sending'
              const rejected = order._pending === 'rejected'
              return (
                <TwoLine
                  key={order.id}
                  testID={`order-row-${order.id}`}
                  primary={order.order_no ?? t('s6.unnumbered')}
                  secondary={`${shortInstant(order.created_at)}${
                    order.note === null || order.note === '' ? '' : ` · ${order.note}`
                  }`}
                  trailing={
                    <Stack gap={1} align="end">
                      <Money value={order.total_paise} size="moneyM" />
                      <StatusChip
                        label={
                          rejected ? t('s5.rejected') : queued ? t('s6.queued') : word(order.state)
                        }
                        family={rejected ? 'brick' : queued ? 'ochre' : orderFamily(order.state)}
                        solid={rejected}
                      />
                    </Stack>
                  }
                  onPress={() => {
                    router.push(`/orders/${order.id}`)
                  }}
                />
              )
            })}
          </Stack>
        </LocalAsync>

        {capped ? (
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('s6.capped', { shown: rows.length, total: matching.length })}
          </Txt>
        ) : null}

        {byVariant.size === 0 && local.hydrated ? (
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('s0.catalogMissing')}
          </Txt>
        ) : null}
      </Stack>
    </Screen>
  )
}
