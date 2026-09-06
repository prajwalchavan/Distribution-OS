/**
 * S2 · Shop card — and S12, the shop's pending bills, one tab away.
 *
 * UX-00 §9.3 fixes what is above the fold with zero taps: what the shop owes, how old it is, and when
 * it last ordered. All three are on the phone (`retailer_outstanding_summary` is in this role's
 * manifest), so they are there in the doorway with no signal.
 *
 * WHAT NEEDS SIGNAL, AND SAYS SO. A visit is written through `retailers.visits.record`: the
 * salesperson's sync manifest marks only `sales_orders` and `sales_order_lines` writable, so there is
 * no offline handler for a visit and the app must not pretend there is (docs/23 §3.4). The credit
 * verdict is `receivables.creditCheck` — one rule, on the server, never a second copy here; offline
 * the card shows the plain facts it holds (dues, limit, open bills) and says the check runs at
 * submit. The exact open amount of each bill is the same story.
 *
 * The geo-tag is an `ochre` chip with a distance and NEVER a gate (UX-01 S5): a shop in a basement
 * has no GPS and the visit still gets recorded.
 */
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import { haversineMetres } from '@dos/domain'
import {
  AgeingBuckets,
  Button,
  Chips,
  EmptyState,
  Group,
  ListRow,
  Money,
  Row,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  Tabs,
  TextInput,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { location } from '@dos/ui/platform'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { longDate, shortDate, shortInstant, today } from '../../src/lib/dates'
import {
  useBeats,
  useLastOrderOf,
  useLocalState,
  useOutstanding,
  useSchemes,
  useShop,
  useShopInvoices,
  useShopOrders,
} from '../../src/lib/local'
import {
  Async,
  Field,
  LocalAsync,
  Panel,
  TwoLine,
  orderFamily,
  useMyUserId,
} from '../../src/lib/ui'
import { useWord } from '../../src/lib/words'

const OUTCOMES = ['ordered', 'no_order', 'closed', 'not_found', 'payment_only'] as const

export default function ShopCard(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const word = useWord()
  const api = useApi()
  const params = useLocalSearchParams<{ id: string }>()
  const retailerId = typeof params.id === 'string' ? params.id : ''
  const local = useLocalState()
  const userId = useMyUserId()

  const shop = useShop(retailerId)
  const dues = useOutstanding(retailerId)
  const orders = useShopOrders(retailerId, 25)
  const lastOrder = useLastOrderOf(retailerId)
  const invoices = useShopInvoices(retailerId, 40)
  const beats = useBeats()
  const schemes = useSchemes()
  const [tab, setTab] = useState('overview')
  const [checkIn, setCheckIn] = useState(false)

  /* Online-only reads. Each one is a fact the device is not allowed to hold or cannot compute. */
  const behaviour = useQuery(
    ['retailers', 'behaviour', retailerId],
    () => api.api.reporting.retailers.behaviour({ id: retailerId }),
    { enabled: retailerId !== '', staleTime: 300_000 },
  )
  const outstanding = useQuery(
    ['receivables', 'outstanding', retailerId],
    () => api.api.receivables.outstanding.get({ retailerId }),
    { enabled: retailerId !== '' && tab === 'bills', staleTime: 60_000 },
  )

  const beatName = beats.find((beat) => beat.id === shop?.beat_id)?.name ?? null

  /**
   * The schemes this shop is inside today — the banner a rep opens the door with.
   *
   * The filter is the engine's own applicability rule (`@dos/domain`: an empty list means "no
   * restriction", every list that is set must match), read off the same rows the price is computed
   * from. Nothing here decides a discount; that is `priceOrder()` on the order screen.
   */
  const banners = useMemo(() => {
    if (shop === null) return []
    const day = today()
    return schemes
      .filter((row) => row.valid_from <= day && row.valid_to >= day)
      .filter((row) => {
        const rule = (row.applicability ?? {}) as {
          tiers?: string[]
          retailerIds?: string[]
          beatIds?: string[]
        }
        if (rule.tiers?.length && !rule.tiers.includes(shop.tier ?? '')) return false
        if (rule.retailerIds?.length && !rule.retailerIds.includes(shop.id)) return false
        if (rule.beatIds?.length && !rule.beatIds.includes(shop.beat_id ?? '')) return false
        return true
      })
      .slice(0, 6)
  }, [schemes, shop])

  if (shop === null) {
    return (
      <Screen title={t('s2.title')}>
        <LocalAsync
          loading={false}
          hydrated={local.hydrated}
          empty
          emptyMessage={t('s2.notOnDevice')}
        >
          <></>
        </LocalAsync>
      </Screen>
    )
  }

  return (
    <Screen
      title={shop.name}
      context={`${beatName ?? t('s1.noBeat')} · ${shop.code ?? ''}`}
      chips={
        <Row gap={2} wrap>
          <StatusChip
            testID="shop-owes"
            label={t('s2.owes', { amount: rupees(dues?.outstanding_paise ?? 0) })}
            family={
              (dues?.overdue_paise ?? 0) > 0
                ? 'brick'
                : (dues?.outstanding_paise ?? 0) > 0
                  ? 'ochre'
                  : 'moss'
            }
            figure
          />
          <StatusChip
            label={t('s2.limit', { amount: rupees(shop.credit_limit_paise ?? 0) })}
            family="neutral"
            figure
          />
          {(dues?.overdue_paise ?? 0) > 0 ? (
            <StatusChip
              label={t('s2.overdue', { amount: rupees(dues?.overdue_paise ?? 0) })}
              family="brick"
              solid
              figure
            />
          ) : null}
        </Row>
      }
      bottomBar={
        <Row gap={3} justify="between" align="center" padX={4} padY={2} wrap>
          <Stack gap={1}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {lastOrder === null
                ? t('s2.noLastOrder')
                : t('s2.lastOrder', { when: shortInstant(lastOrder.created_at) })}
            </Txt>
            <Money value={lastOrder?.total_paise ?? null} size="moneyM" />
          </Stack>
          <Button
            testID="take-order"
            variant="primary"
            label={t('s2.takeOrder')}
            onPress={() => {
              router.push(`/orders/new?retailerId=${shop.id}`)
            }}
          />
        </Row>
      }
    >
      <Stack gap={4}>
        <Tabs
          testID="shop-tabs"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'overview', label: t('s2.tabOverview') },
            { id: 'orders', label: t('s2.tabOrders'), count: orders.length },
            { id: 'bills', label: t('s2.tabBills'), count: dues?.open_bills ?? 0 },
          ]}
        />

        {tab === 'overview' ? (
          <Stack gap={6}>
            <Panel title={t('s2.ageing')} meta={t('s2.asOf', { when: shortDate(dues?.as_of) })}>
              <AgeingBuckets
                testID="shop-ageing"
                buckets={{
                  '0-7': dues?.bucket_0_7_paise ?? 0,
                  '8-15': dues?.bucket_8_15_paise ?? 0,
                  '16-30': dues?.bucket_16_30_paise ?? 0,
                  '31-60': dues?.bucket_31_60_paise ?? 0,
                  '61-90': dues?.bucket_61_90_paise ?? 0,
                  '90+': dues?.bucket_90_plus_paise ?? 0,
                }}
              />
            </Panel>

            <Panel title={t('s2.credit')}>
              <Stack gap={3}>
                <Row gap={4} wrap>
                  <Field label={t('s2.creditLimit')}>
                    <Money value={shop.credit_limit_paise} size="moneyM" />
                  </Field>
                  <Field label={t('s2.creditDays')}>{shop.credit_days ?? 0}</Field>
                  <Field label={t('s2.openBills')}>{dues?.open_bills ?? 0}</Field>
                  <Field label={t('s2.terms')}>{word(shop.payment_terms)}</Field>
                </Row>
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {t('s2.creditRunsAtSubmit', { mode: word(shop.credit_mode) })}
                </Txt>
              </Stack>
            </Panel>

            {banners.length === 0 ? null : (
              <Panel title={t('s2.schemes')} meta={t('s2.schemesMeta')}>
                <Group>
                  {banners.map((scheme) => (
                    <ListRow
                      key={scheme.id}
                      primary={scheme.name}
                      secondary={t('s2.schemeWindow', {
                        from: shortDate(scheme.valid_from),
                        to: shortDate(scheme.valid_to),
                      })}
                      trailing={<StatusChip label={word(scheme.reward_kind)} family="clay" />}
                    />
                  ))}
                </Group>
              </Panel>
            )}

            <Panel title={t('s2.habits')} meta={local.online ? undefined : t('s0.needsSignal')}>
              <Async state={[behaviour]} rows={3}>
                <Row gap={4} wrap>
                  <Field label={t('s2.ordersLast30')}>
                    {behaviour.data?.item.ordersLast30 ?? 0}
                  </Field>
                  <Field label={t('s2.valueLast30')}>
                    <Money value={behaviour.data?.item.valueLast30Paise ?? null} size="moneyM" />
                  </Field>
                  <Field label={t('s2.avgDaysToPay')}>
                    {behaviour.data?.item.avgDaysToPay ?? '—'}
                  </Field>
                  <Field label={t('s2.lapsedRisk')}>
                    <StatusChip
                      label={`${String(behaviour.data?.item.lapsedRisk ?? 0)}%`}
                      family={(behaviour.data?.item.lapsedRisk ?? 0) >= 50 ? 'brick' : 'moss'}
                      figure
                    />
                  </Field>
                </Row>
              </Async>
            </Panel>

            <Panel title={t('s2.contact')}>
              <Stack gap={3}>
                <Row gap={4} wrap>
                  <Field label={t('s2.owner')}>{shop.owner_name ?? '—'}</Field>
                  <Field label={t('s2.phone')}>{shop.phone ?? '—'}</Field>
                  <Field label={t('s2.gstin')}>{shop.gstin ?? word(shop.gst_reg_type)}</Field>
                  <Field label={t('s2.tier')}>{shop.tier ?? '—'}</Field>
                </Row>
                <Field label={t('s2.address')}>
                  {[
                    shop.address?.line1,
                    shop.address?.area,
                    shop.address?.city,
                    shop.address?.pincode,
                  ]
                    .filter((part) => typeof part === 'string' && part !== '')
                    .join(', ') || '—'}
                </Field>
              </Stack>
            </Panel>

            <Button
              testID="check-in"
              label={t('s2.checkIn')}
              variant="secondary"
              fullWidth
              onPress={() => {
                setCheckIn(true)
              }}
            />
          </Stack>
        ) : null}

        {tab === 'orders' ? (
          <LocalAsync
            loading={false}
            hydrated={local.hydrated}
            empty={orders.length === 0}
            emptyMessage={t('s2.noOrders')}
          >
            <Stack testID="shop-orders">
              {orders.map((order) => (
                <TwoLine
                  key={order.id}
                  primary={order.order_no ?? t('s6.unnumbered')}
                  secondary={`${shortInstant(order.created_at)} · ${word(order.state)}`}
                  trailing={
                    <Stack gap={1} align="end">
                      <Money value={order.total_paise} size="moneyM" />
                      <StatusChip
                        label={order._pending == null ? word(order.state) : t('s6.queued')}
                        family={order._pending == null ? orderFamily(order.state) : 'ochre'}
                      />
                    </Stack>
                  }
                  onPress={() => {
                    router.push(`/orders/${order.id}`)
                  }}
                />
              ))}
            </Stack>
          </LocalAsync>
        ) : null}

        {tab === 'bills' ? (
          <Stack gap={4}>
            {local.online ? (
              <Async
                state={[outstanding]}
                rows={4}
                empty={(outstanding.data?.bills.length ?? 0) === 0}
                emptyMessage={t('s12.noBills')}
              >
                <Stack testID="shop-bills">
                  {(outstanding.data?.bills ?? []).map((bill) => (
                    <TwoLine
                      key={bill.id}
                      primary={bill.invoiceNo}
                      secondary={t('s12.due', {
                        when: longDate(bill.dueDate),
                        age: bill.ageDays,
                      })}
                      trailing={
                        <Stack gap={1} align="end">
                          <Money value={bill.openPaise} size="moneyM" />
                          <StatusChip
                            label={t('s12.ofTotal', { total: rupees(bill.totalPaise) })}
                            family={bill.ageDays > 0 ? 'brick' : 'neutral'}
                            figure
                          />
                        </Stack>
                      }
                    />
                  ))}
                </Stack>
              </Async>
            ) : (
              <Stack gap={3}>
                <Txt field="label" desk="meta" color={colors.status.ochre.fg}>
                  {t('s12.offline')}
                </Txt>
                {invoices.length === 0 ? (
                  <EmptyState message={t('s12.noBills')} />
                ) : (
                  <Stack testID="shop-bills-local">
                    {invoices.map((bill) => (
                      <TwoLine
                        key={bill.id}
                        primary={bill.invoice_no ?? bill.id.slice(0, 8)}
                        secondary={t('s12.billed', { when: longDate(bill.invoice_date) })}
                        trailing={<Money value={bill.total_paise} size="moneyM" />}
                      />
                    ))}
                  </Stack>
                )}
              </Stack>
            )}
          </Stack>
        ) : null}
      </Stack>

      <CheckInSheet
        open={checkIn}
        onClose={() => {
          setCheckIn(false)
        }}
        retailerId={shop.id}
        beatId={shop.beat_id}
        shopPoint={shop.lat === null || shop.lng === null ? null : { lat: shop.lat, lng: shop.lng }}
        online={local.online}
        userId={userId}
      />
    </Screen>
  )
}

/** Paise as a plain rupee figure for a chip label — the chip itself is not a `<Money>` slot. */
function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

interface CheckInProps {
  open: boolean
  onClose: () => void
  retailerId: string
  beatId: string | null
  shopPoint: { lat: number; lng: number } | null
  online: boolean
  userId: string | null
}

/**
 * The check-in, with its no-order reason — docs/23 §3.1 S2 and the "visits and no-order reasons"
 * screen in one place, because a rep records the outcome where they are standing.
 *
 * The GPS read is asked for at the moment of the tap and never on mount (UX-00 §12: no modal blocks
 * for permissions). A refusal, a basement or a browser with no geolocation all answer the same way —
 * the visit is recorded without a position, and the chip says the distance is unknown.
 */
function CheckInSheet({
  open,
  onClose,
  retailerId,
  beatId,
  shopPoint,
  online,
  userId,
}: CheckInProps): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const [outcome, setOutcome] = useState<string>('no_order')
  const [reason, setReason] = useState('')
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [done, setDone] = useState(false)

  const record = useMutation(
    (input: { outcome: string; reason: string }, meta) =>
      api.api.retailers.visits.record({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        retailerId,
        beatId,
        startedAt: new Date().toISOString(),
        outcome: input.outcome as 'ordered' | 'no_order' | 'closed' | 'not_found' | 'payment_only',
        reason: input.reason.trim() === '' ? null : input.reason.trim(),
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
      }),
    {
      invalidates: [['visits']],
      onSuccess: () => {
        setDone(true)
      },
    },
  )

  const metres =
    point === null || shopPoint === null
      ? null
      : Math.round(haversineMetres({ lat: point.lat, lng: point.lng }, shopPoint))

  return (
    <Sheet open={open} onClose={onClose} title={t('s2.checkIn')} testID="check-in-sheet">
      <Stack gap={4}>
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('s2.checkInBody')}
        </Txt>

        <Chips
          testID="visit-outcome"
          items={OUTCOMES.map((id) => ({
            id,
            label: word(id),
            selected: id === outcome,
          }))}
          onToggle={setOutcome}
        />

        <TextInput
          label={t('s2.visitReason')}
          value={reason}
          onChange={setReason}
          capitalize="sentences"
          helper={t('s2.visitReasonHelp')}
        />

        <Row gap={2} align="center" wrap>
          <Button
            label={locating ? t('s2.locating') : t('s2.tagPosition')}
            variant="ghost"
            loading={locating}
            onPress={() => {
              setLocating(true)
              void location
                .current()
                .then((found) => {
                  if (found !== null) setPoint({ lat: found.latitude, lng: found.longitude })
                })
                .finally(() => {
                  setLocating(false)
                })
            }}
          />
          <StatusChip
            label={
              point === null
                ? t('s2.noPosition')
                : metres === null
                  ? t('s2.positionTagged')
                  : t('s2.metresAway', { metres })
            }
            family={point === null ? 'neutral' : 'ochre'}
            figure={metres !== null}
          />
        </Row>

        {online ? null : (
          <Txt field="label" desk="meta" color={colors.status.ochre.fg}>
            {t('s2.visitNeedsSignal')}
          </Txt>
        )}
        {record.error === undefined ? null : (
          <Txt field="label" desk="meta" color={colors.status.brick.fg}>
            {record.error.message}
          </Txt>
        )}

        <Button
          testID="record-visit"
          variant="primary"
          label={done ? t('s2.visitRecorded') : t('s2.recordVisit')}
          fullWidth
          disabled={!online || userId === null || done}
          disabledReason={online ? undefined : t('s2.visitNeedsSignal')}
          loading={record.status === 'pending'}
          onPress={() => {
            record.mutate({ outcome, reason })
          }}
        />
      </Stack>
    </Sheet>
  )
}
