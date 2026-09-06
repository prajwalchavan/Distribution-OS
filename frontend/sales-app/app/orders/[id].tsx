/**
 * S5 · Submit and status — one order, what is true about it, and the one thing the rep can still do.
 *
 * The lines and the header come off the phone, so an order opened in a doorway with no signal shows
 * everything the device knows. Two facts arrive only with signal and are asked for only then: the
 * approvals a submit raised (`orders.get`, which a rep may read) and whether the server has priced
 * the order the way the device did.
 *
 * SUBMIT IS ONLINE, ALWAYS. `orders.sync.ts` refuses any state past `draft` from a device in so many
 * words — the SO number, the credit check and the stock reservation are the server's to decide — so
 * a draft that arrived through the outbox waits here for its rep to submit it. That is not a
 * limitation this screen hides; it is the sentence at the top of it.
 *
 * The turn-around confirmation (UX-00 §8.2: "designed to be turned around and shown across a
 * counter") is this screen at a single column with every figure at `moneyM` or larger.
 */
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import { useSyncEngine } from '@dos/offline/react'
import type { OrderDetail as OrderDetailWire } from '@dos/contracts'
import { formatINR, formatQty, paise, pieces } from '@dos/domain'
import {
  Button,
  Dialog,
  EmptyState,
  Group,
  ListRow,
  Money,
  Row,
  Screen,
  Skeleton,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { deviceId } from '../../src/api'
import { instantWithClock, longDate, today } from '../../src/lib/dates'
import type { LocalOrder, LocalOrderLine } from '../../src/lib/local'
import {
  useBargains,
  useCatalogIndex,
  useLocalState,
  useOrder,
  useOrderLines,
  useOverrides,
  usePriceLists,
  useSchemes,
  useShop,
} from '../../src/lib/local'
import { piecesOfLine } from '../../src/lib/queue'
import { quoteOnDevice } from '../../src/lib/pricing'
import { Field, Panel, orderFamily } from '../../src/lib/ui'
import { useWord } from '../../src/lib/words'

export default function OrderDetail(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const word = useWord()
  const api = useApi()
  const params = useLocalSearchParams<{ id: string }>()
  const orderId = typeof params.id === 'string' ? params.id : ''
  const local = useLocalState()
  const engine = useSyncEngine()

  const localOrder = useOrder(orderId)
  const localLines = useOrderLines(orderId)
  const { byVariant } = useCatalogIndex()
  const { lists, items: listItems } = usePriceLists()
  const schemes = useSchemes()
  const overrides = useOverrides(localOrder?.retailer_id ?? null)
  const bargains = useBargains(localOrder?.retailer_id ?? null)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')

  /**
   * The server's own view, when there is signal: the approvals a submit raised and the state the
   * office sees. A rep may read `orders.get`; the approvals it carries are the rep's own order's.
   */
  const detail = useQuery(['orders', 'get', orderId], () => api.api.orders.get({ id: orderId }), {
    enabled: orderId !== '' && local.online,
    staleTime: 30_000,
  })

  /**
   * The device first, the service second — and the service is not a nicety.
   *
   * An order placed a moment ago exists on the SERVER before the next pull brings it back down, and
   * `<OfflineProvider>` falls to the memory store on any page that is not cross-origin isolated (a
   * plain `expo start --web`, docs/27 §2), where a reload empties the phone's copy entirely. Reading
   * only the local row printed "That order is not on this phone" over an order the rep had just
   * placed and could see in Postgres. So: the local row when there is one, `orders.get` when there
   * is not, and the honest empty state only when neither answers.
   */
  /*
   * WHICH COPY WINS. The device's, while it is the only one that knows something — a write this
   * phone is still holding (`_pending`), or no signal at all. The SERVICE's otherwise: it is the one
   * that gives an order its number, its state and its priced lines, and the pull that brings those
   * down is seconds behind. Preferring the local row unconditionally left this screen saying "Draft ·
   * Not numbered yet" for a minute after the rep had submitted it and the server had answered
   * `submitted` — the one screen whose entire job is to say where the order stands.
   */
  const server = detail.data?.item ?? null
  const pending = localOrder?._pending != null
  const order: OrderView | null =
    pending || server === null ? localOrder : viewOfServerOrder(server)
  const lines: LineView[] =
    pending || server === null ? localLines : server.lines.map(viewOfServerLine)
  const shop = useShop(order?.retailer_id ?? null)

  const queued = localOrder?._pending === 'queued' || localOrder?._pending === 'sending'
  const isDraft = order?.state === 'draft'

  /**
   * A draft the server has not priced yet has no totals of its own, so the screen prices it the way
   * the order screen did — the same engine, the same inputs, marked as the device's own figure.
   */
  const deviceQuote = useMemo(() => {
    if (shop === null || !isDraft) return null
    return quoteOnDevice(
      lines.map((line) => ({
        id: line.id,
        variantId: line.variant_id,
        qtyPcs: piecesOfLine(line, byVariant.get(line.variant_id)?.caseSize ?? 1),
        enteredQty: line.entered_qty,
        enteredUnit: line.entered_unit === 'case' ? 'case' : 'piece',
      })),
      {
        retailer: shop,
        catalog: byVariant,
        priceLists: lists,
        priceListItems: listItems,
        schemes,
        overrides,
        bargains,
        pricingDate: today(),
        orderId,
      },
    )
  }, [shop, isDraft, lines, byVariant, lists, listItems, schemes, overrides, bargains, orderId])

  const submit = useMutation(
    (_input: null) =>
      api.api.orders.submit({
        id: orderId,
        idempotencyKey: `${orderId}:submit`,
        deviceId: deviceId(),
      }),
    {
      invalidates: [['orders']],
      // The number and the new state are the server's; pull them down rather than wait out the tick.
      onSuccess: () => {
        void engine?.sync('order submitted')
      },
    },
  )

  const cancel = useMutation(
    (input: { reason: string }) =>
      api.api.orders.cancel({
        id: orderId,
        idempotencyKey: `${orderId}:cancel`,
        reason: input.reason,
        deviceId: deviceId(),
      }),
    {
      invalidates: [['orders']],
      onSuccess: () => {
        setCancelling(false)
        void engine?.sync('order cancelled')
      },
    },
  )

  if (order === null) {
    return (
      <Screen title={t('s5.title')}>
        {detail.isLoading ? <Skeleton rows={3} /> : <EmptyState message={t('s5.notOnDevice')} />}
      </Screen>
    )
  }

  const approvals = server?.approvals ?? []
  const cancellable = ['draft', 'submitted', 'confirmed'].includes(order.state)
  const totalPaise = isDraft ? (deviceQuote?.result?.totals.netPaise ?? null) : order.total_paise

  return (
    <Screen
      title={order.order_no ?? t('s6.unnumbered')}
      context={shop?.name ?? order.retailer_id.slice(0, 8)}
      chips={
        <Row gap={2} wrap>
          <StatusChip
            testID="order-state"
            label={queued ? t('s6.queued') : word(order.state)}
            family={queued ? 'ochre' : orderFamily(order.state)}
          />
          {(order.approval_flags ?? []).map((flag) => (
            <StatusChip key={flag} label={word(flag)} family="clay" />
          ))}
        </Row>
      }
      bottomBar={
        <Row gap={3} justify="between" align="center" padX={4} padY={2} wrap>
          <Stack gap={1}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {isDraft ? t('s5.deviceTotal') : t('s5.orderTotal')}
            </Txt>
            <Money value={totalPaise} size="moneyL" />
          </Stack>
          {isDraft ? (
            <Button
              testID="submit-order"
              variant="primary"
              label={submit.status === 'success' ? t('s5.submitted') : t('s5.submit')}
              disabled={!local.online || queued || submit.status === 'success'}
              disabledReason={
                queued
                  ? t('s5.waitingToLand')
                  : local.online
                    ? undefined
                    : t('s5.submitNeedsSignal')
              }
              loading={submit.status === 'pending'}
              onPress={() => {
                submit.mutate(null)
              }}
            />
          ) : (
            <Button
              label={t('s5.backToOrders')}
              variant="secondary"
              onPress={() => {
                router.push('/orders')
              }}
            />
          )}
        </Row>
      }
    >
      <Stack gap={5}>
        {queued ? (
          <Txt field="body" desk="body" color={colors.status.ochre.fg}>
            {t('s5.queuedExplain')}
          </Txt>
        ) : null}
        {isDraft && !queued ? (
          <Txt field="body" desk="body" color={colors.text.secondary}>
            {t('s5.draftExplain')}
          </Txt>
        ) : null}
        {submit.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg}>
            {submit.error.message}
          </Txt>
        )}

        <Panel title={t('s5.lines')} meta={t('s5.linesMeta', { count: lines.length })}>
          {lines.length === 0 ? (
            <EmptyState message={t('s5.noLines')} />
          ) : (
            <Group>
              {lines.map((line) => {
                const item = byVariant.get(line.variant_id)
                const caseSize = item?.caseSize ?? line.pack_size_at_entry ?? 1
                const qtyPcs = piecesOfLine(line, caseSize)
                const priced = deviceQuote?.result?.lines.find((one) => one.lineId === line.id)
                const rate = line.rate_paise ?? priced?.ratePaise ?? null
                const lineTotal = line.line_total_paise ?? priced?.lineNetPaise ?? null
                const free = line.free_qty_pcs ?? priced?.freeQtyPcs ?? 0
                return (
                  <ListRow
                    key={line.id}
                    primary={item?.name ?? line.variant_id.slice(0, 8)}
                    secondary={`${formatQty(pieces(qtyPcs), caseSize)}${
                      rate === null ? '' : ` · ${formatINR(paise(rate))}/pc`
                    }${free > 0 ? ` · ${t('qty.freeGoods', { pieces: free })}` : ''}`}
                    trailingMoney={lineTotal}
                    trailing={
                      line._pending == null ? undefined : (
                        <StatusChip label={t('s6.queued')} family="ochre" />
                      )
                    }
                  />
                )
              })}
            </Group>
          )}
        </Panel>

        {approvals.length === 0 ? null : (
          <Panel title={t('s5.approvals')}>
            <Group>
              {approvals.map((approval) => (
                <ListRow
                  key={approval.id}
                  primary={word(approval.kind)}
                  secondary={
                    approval.decidedAt === null
                      ? t('s5.approvalPending')
                      : t('s5.approvalDecided', { when: instantWithClock(approval.decidedAt) })
                  }
                  trailing={
                    <StatusChip
                      label={word(approval.status)}
                      family={
                        approval.status === 'approved'
                          ? 'moss'
                          : approval.status === 'rejected'
                            ? 'brick'
                            : 'ochre'
                      }
                    />
                  }
                />
              ))}
            </Group>
          </Panel>
        )}

        <Panel title={t('s5.details')}>
          <Row gap={4} wrap>
            <Field label={t('s5.placedAt')}>{instantWithClock(order.created_at)}</Field>
            <Field label={t('s5.submittedAt')}>
              {order.submitted_at === null
                ? t('s5.notSubmitted')
                : instantWithClock(order.submitted_at)}
            </Field>
            <Field label={t('s5.expected')}>
              {order.expected_delivery_date === null ? '—' : longDate(order.expected_delivery_date)}
            </Field>
            <Field label={t('s5.note')}>{order.note ?? '—'}</Field>
          </Row>
        </Panel>

        {cancellable ? (
          <Button
            testID="cancel-order"
            label={t('s5.cancel')}
            variant="destructive"
            disabled={!local.online}
            disabledReason={local.online ? undefined : t('s5.cancelNeedsSignal')}
            onPress={() => {
              setCancelling(true)
            }}
          />
        ) : null}
      </Stack>

      <Dialog
        open={cancelling}
        onClose={() => {
          setCancelling(false)
        }}
        title={t('s5.cancelTitle')}
        testID="cancel-dialog"
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {t('s5.cancelBody', {
                order: order.order_no ?? t('s6.unnumbered'),
                shop: shop?.name ?? '',
              })}
            </Txt>
            <TextInput
              label={t('s5.cancelReason')}
              value={reason}
              onChange={setReason}
              capitalize="sentences"
            />
            {cancel.error === undefined ? null : (
              <Txt field="label" desk="meta" color={colors.status.brick.fg}>
                {cancel.error.message}
              </Txt>
            )}
          </Stack>
        }
        confirmLabel={t('s5.cancelConfirm')}
        destructive
        busy={cancel.status === 'pending'}
        onConfirm={() => {
          if (reason.trim().length > 0) cancel.mutate({ reason: reason.trim() })
        }}
      />
    </Screen>
  )
}

/**
 * The two shapes this screen reads, and the one adapter between them.
 *
 * The device rows are snake_case columns straight out of the manifest; `orders.get` answers the wire
 * type from `@dos/contracts`. Rather than write every panel twice, the SERVER row is mapped into the
 * device's own column names — one direction, in one place, and no wire type is re-declared here.
 */
type OrderView = Pick<
  LocalOrder,
  | 'id'
  | 'order_no'
  | 'retailer_id'
  | 'state'
  | 'total_paise'
  | 'approval_flags'
  | 'expected_delivery_date'
  | 'note'
  | 'submitted_at'
  | 'created_at'
> & { _pending?: LocalOrder['_pending'] }

type LineView = Pick<
  LocalOrderLine,
  | 'id'
  | 'variant_id'
  | 'entered_qty'
  | 'entered_unit'
  | 'pack_size_at_entry'
  | 'qty_pcs'
  | 'free_qty_pcs'
  | 'rate_paise'
  | 'line_total_paise'
> & { _pending?: LocalOrderLine['_pending'] }

function viewOfServerOrder(item: OrderDetailWire): OrderView {
  return {
    id: item.id,
    order_no: item.orderNo,
    retailer_id: item.retailerId,
    state: item.state,
    total_paise: item.totalPaise,
    approval_flags: item.approvalFlags,
    expected_delivery_date: item.expectedDeliveryDate,
    note: item.note,
    submitted_at: item.submittedAt,
    created_at: item.createdAt,
  }
}

function viewOfServerLine(line: OrderDetailWire['lines'][number]): LineView {
  return {
    id: line.id,
    variant_id: line.variantId,
    entered_qty: line.enteredQty,
    entered_unit: line.enteredUnit,
    pack_size_at_entry: line.packSizeAtEntry,
    qty_pcs: line.qtyPcs,
    free_qty_pcs: line.freeQtyPcs,
    rate_paise: line.ratePaise,
    line_total_paise: line.lineTotalPaise,
  }
}
