/**
 * R8 (detail) — one order: what was ordered, where it has got to, and where the van is (docs/23 §6.1).
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT SHOW. `orders.get` for the retailer role strips approvals —
 * whether the distributor's manager had to sign off a price is their business, not the shop's — and
 * carries no cost or margin at any tier. The `transitions` list IS shown, because "when did it get
 * packed" is exactly the question a shopkeeper rings up to ask.
 *
 * THE VAN IS NEVER A COORDINATE. `delivery.stops.list` for a shop answers its own stops with an ETA
 * and no latitude or longitude (docs/23 §6.1 R8, the DPDP line in docs/22 §9): the shop learns when,
 * never where the driver is standing.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Group,
  ListRow,
  Money,
  Row,
  Screen,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  billLineQty,
  formatMoney,
  useColors,
  useStrings,
} from '@dos/ui'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { instantWithClock, longDate } from '../../src/lib/dates'
import { useItemNames, useMyShop } from '../../src/lib/shop'
import { Async, Field, Panel, orderFamily } from '../../src/lib/ui'
import { useWord } from '../../src/lib/words'

/** The states a shop may still call off. Past `confirmed` the goods are reserved and it is a phone call. */
const CANCELLABLE = new Set(['draft', 'submitted'])

export default function OrderDetail(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null
  const params = useLocalSearchParams<{ id: string; placed?: string }>()
  const orderId = typeof params.id === 'string' ? params.id : null
  /** The order editor lands here with `?placed=1` — the confirmation belongs on this screen. */
  const justPlaced = params.placed === '1'
  const [confirmed, setConfirmed] = useState(justPlaced)
  const my = useMyShop()
  const names = useItemNames()

  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const order = useQuery(['order', orderId], () => api.api.orders.get({ id: orderId ?? '' }), {
    enabled: signedIn && orderId !== null,
  })
  const detail = order.data?.item

  const bills = useQuery(
    ['invoices', 'for-order', orderId],
    () => api.api.billing.invoices.list({ orderId: orderId ?? '', limit: 10 }),
    { enabled: signedIn && orderId !== null },
  )
  const stops = useQuery(
    ['stops', my.retailerId],
    () => api.api.delivery.stops.list({ retailerId: my.retailerId ?? '', limit: 50 }),
    { enabled: signedIn && my.retailerId !== null },
  )

  /** The stop that carries a delivery of THIS order — the only stop this screen may speak about. */
  const stop = (stops.data?.items ?? []).find((row) =>
    row.deliveries.some((delivery) => delivery.orderId === orderId),
  )

  const cancel = useMutation(
    (input: { orderId: string; reason: string }, meta) =>
      api.api.orders.cancel({
        id: input.orderId,
        idempotencyKey: meta.idempotencyKey,
        reason: input.reason,
      }),
    { invalidates: [['orders'], ['order']] },
  )
  const submit = useMutation(
    (input: { orderId: string }, meta) =>
      api.api.orders.submit({ id: input.orderId, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['orders'], ['order']] },
  )

  const canCancel = detail !== undefined && CANCELLABLE.has(detail.state)
  const isDraft = detail?.state === 'draft'

  return (
    <Screen
      title={
        detail?.orderNo === null || detail === undefined
          ? t('r8.draft')
          : t('r8.detailTitle', { no: detail.orderNo })
      }
      context={session?.tenant.displayName}
      chips={
        detail === undefined ? undefined : (
          <Row gap={2} wrap>
            <StatusChip label={word(detail.state)} family={orderFamily(detail.state)} />
            <StatusChip label={word(detail.paymentTerms)} family="neutral" />
          </Row>
        )
      }
      testID="r8-detail"
      bottomBar={
        detail === undefined ? undefined : (
          <Row gap={4} justify="between" align="center" wrap>
            <Stack gap={1}>
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {t('r7.net')}
              </Txt>
              <Money value={detail.totalPaise} size="moneyL" />
            </Stack>
            <Row gap={4} wrap>
              {canCancel ? (
                <Button
                  label={t('r8.cancel')}
                  variant="destructive"
                  onPress={() => {
                    setCancelling(true)
                  }}
                  testID="r8-cancel"
                />
              ) : null}
              {isDraft ? (
                <Button
                  label={t('r8.submit')}
                  variant="primary"
                  loading={submit.status === 'pending'}
                  onPress={() => {
                    if (orderId === null) return
                    setFailure(null)
                    void submit.mutateAsync({ orderId }).catch((error: unknown) => {
                      setFailure(error instanceof Error ? error.message : t('r7.failed'))
                    })
                  }}
                  testID="r8-submit"
                />
              ) : null}
            </Row>
          </Row>
        )
      }
    >
      <Stack gap={6}>
        <Async state={[order]} rows={5}>
          {detail === undefined ? null : (
            <Stack gap={6}>
              {failure === null ? null : (
                <Txt field="body" desk="body" color={colors.status.brick.fg} testID="r8-failure">
                  {failure}
                </Txt>
              )}

              {/* --- what was ordered --------------------------------------------------------- */}
              <Panel
                title={t('r8.lines')}
                meta={
                  detail.lines.length === 1
                    ? t('r8.itemsCountOne')
                    : t('r8.itemsCount', { count: detail.lines.length })
                }
                testID="r8-lines"
              >
                <Group>
                  {detail.lines.map((line) => (
                    <ListRow
                      key={line.id}
                      primary={names.nameOf(line.variantId) ?? t('r8.itemUnknown')}
                      secondary={`${billLineQty(line, t)} · ${formatMoney(line.ratePaise)}${
                        line.discountPaise > 0 ? ` · −${formatMoney(line.discountPaise)}` : ''
                      }${
                        line.taxPaise > 0
                          ? ` · ${t('r8.lineGst', { amount: formatMoney(line.taxPaise) })}`
                          : ''
                      }`}
                      trailingMoney={line.lineTotalPaise}
                    />
                  ))}
                </Group>
              </Panel>

              {/*
                A NOTE THE SHOP DID NOT WRITE IS NOT A NOTE.

                `orders.repeatLast` stores `Repeat of <the previous order's uuid>` on the new draft,
                so a two-tap reorder showed the shopkeeper "Your note: Repeat of
                fd62e4e0-f68c-7e07-bfa2-6478bed9282f". A database id is never a sentence a shop
                reads. (The server writing the order NUMBER there is recorded as a backend gap.)
              */}
              {noteOf(detail.note) === null ? null : (
                <Field label={t('r8.notes')}>
                  {noteOf(detail.note) === REPEAT ? t('r8.repeatNote') : noteOf(detail.note)}
                </Field>
              )}

              {/* --- where it has got to ------------------------------------------------------- */}
              <Panel title={t('r8.progress')} testID="r8-progress">
                <Group>
                  {detail.transitions.map((step) => (
                    <ListRow
                      key={step.id}
                      primary={word(step.toState)}
                      secondary={instantWithClock(step.occurredAt)}
                    />
                  ))}
                </Group>
              </Panel>

              {/* --- the van ------------------------------------------------------------------- */}
              <Panel title={t('r8.delivery')} testID="r8-delivery">
                <Async
                  state={[stops]}
                  rows={2}
                  empty={stop === undefined}
                  emptyMessage={t('r8.noDelivery')}
                >
                  {stop === undefined ? null : (
                    <Stack gap={3}>
                      <Row gap={4} wrap>
                        <StatusChip label={word(stop.state)} family="clay" />
                        <Txt field="body" desk="body">
                          {t('r8.stopSeq', { seq: String(stop.sequence) })}
                        </Txt>
                      </Row>
                      <Txt field="body" desk="body" color={colors.text.secondary}>
                        {stop.etaAt === null
                          ? t('r8.stopState', { state: word(stop.state) })
                          : t('r8.eta', { when: instantWithClock(stop.etaAt) })}
                      </Txt>
                      <Group>
                        {stop.deliveries.map((delivery) => (
                          <ListRow
                            key={delivery.id}
                            primary={t('r8.bill', { no: delivery.invoiceNo ?? '—' })}
                            secondary={
                              delivery.deliveredAt === null
                                ? word(delivery.outcome)
                                : `${word(delivery.outcome)} · ${instantWithClock(delivery.deliveredAt)}`
                            }
                            trailingMoney={delivery.invoiceTotalPaise}
                            onPress={
                              delivery.invoiceId === null
                                ? undefined
                                : () => {
                                    router.push(`/bills/${delivery.invoiceId}`)
                                  }
                            }
                          />
                        ))}
                      </Group>
                    </Stack>
                  )}
                </Async>
              </Panel>

              {/* --- the bill it became --------------------------------------------------------- */}
              {(bills.data?.items ?? []).length === 0 ? null : (
                <Panel title={t('r4.title')} testID="r8-bills">
                  <Group>
                    {(bills.data?.items ?? []).map((invoice) => (
                      <ListRow
                        key={invoice.id}
                        primary={t('r8.bill', { no: invoice.invoiceNo ?? '—' })}
                        secondary={longDate(invoice.invoiceDate)}
                        trailingMoney={invoice.totalPaise}
                        trailing={<StatusChip label={word(invoice.state)} family="neutral" />}
                        onPress={() => {
                          router.push(`/bills/${invoice.id}`)
                        }}
                      />
                    ))}
                  </Group>
                </Panel>
              )}
            </Stack>
          )}
        </Async>
      </Stack>

      <Dialog
        open={cancelling}
        onClose={() => {
          setCancelling(false)
        }}
        title={t('r8.cancelConfirm', { no: detail?.orderNo ?? '' })}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {t('r8.cancelBody')}
            </Txt>
            <TextInput
              label={t('r8.cancelReason')}
              value={reason}
              onChange={setReason}
              capitalize="sentences"
              maxLength={200}
              testID="r8-cancel-reason"
            />
          </Stack>
        }
        confirmLabel={t('r8.cancel')}
        destructive
        busy={cancel.status === 'pending'}
        onConfirm={() => {
          if (orderId === null || reason.trim() === '') return
          void cancel.mutateAsync({ orderId, reason: reason.trim() }).then(
            () => {
              setCancelling(false)
              setReason('')
            },
            (error: unknown) => {
              setCancelling(false)
              setFailure(error instanceof Error ? error.message : t('r8.cancelFailed'))
            },
          )
        }}
        testID="r8-cancel-dialog"
      />
      <Toast
        open={confirmed}
        message={t('r8.placedToast', {
          no: detail?.orderNo ?? '',
          name: session?.tenant.displayName ?? '',
        })}
        onDismiss={() => {
          setConfirmed(false)
        }}
        testID="r8-placed"
      />
    </Screen>
  )
}

/**
 * The note as the shop should read it, or null when there is nothing to show.
 *
 * `REPEAT` is the marker `orders.repeatLast` leaves behind; the screen prints its own sentence for
 * it rather than the uuid the server stored.
 */
const REPEAT = 'repeat'
function noteOf(note: string | null): string | null {
  const raw = (note ?? '').trim()
  if (raw === '') return null
  return /^Repeat of [0-9a-f-]{36}$/i.test(raw) ? REPEAT : raw
}
