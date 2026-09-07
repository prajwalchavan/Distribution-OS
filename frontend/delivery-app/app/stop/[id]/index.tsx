/**
 * D3 — The stop (docs/23 §5.1, drawn in UX-00 §9.5): where the shop is, who to call, the bills that
 * ride on this door and what the crew is meant to come away with.
 *
 * Read entirely from the DEVICE. Every write on this screen goes through the outbox: "I am at the
 * shop" is a `trip_stops` PATCH, "nothing delivered" is the same table with a reason, and both are
 * accepted out of order by the server — a stop already past `started` whose incoming `occurredAt` is
 * older than what is stored answers the stored row unchanged rather than a 409 (docs/07 §7.3).
 *
 * Two things are deliberately absent. There is no cost, margin or landed price anywhere on this
 * screen or in this bundle — the crew sees the SELLING rate on the bill, which is what the shopkeeper
 * is charged. And there is no credit LIMIT: docs/23 §5.3 says the crew needs the payment mode and the
 * dues, never the limit, so `retailers.credit_limit_paise` is on the device and is never drawn.
 */
import {
  Button,
  Group,
  ListRow,
  Money,
  Row,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  formatINR,
  useColors,
  wordFor,
  useStrings,
} from '@dos/ui'
import { paise } from '@dos/domain'
import { haptics, links, location as platformLocation } from '@dos/ui/platform'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { deviceId } from '../../../src/api'
import { instantWithClock, longDate } from '../../../src/lib/dates'
import {
  addressLine,
  isStopTerminal,
  useHydrated,
  useLocalDeliveries,
  useLocalInvoices,
  useLocalOutstanding,
  useLocalRetailers,
  useLocalStop,
  useLocalStops,
  useLocalTrip,
} from '../../../src/lib/local'
import { useMoveStop } from '../../../src/lib/queue'
import { Field, LocalAsync, Panel, StopChip, pl } from '../../../src/lib/ui'

/** `StopFailureReasonSchema`, as the crew taps it. `other` needs a note (the server refuses without). */
const FAILURE_REASONS = [
  'shop_closed',
  'refused',
  'no_cash',
  'wrong_address',
  'damaged_goods',
  'other',
] as const

export default function StopScreen(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const params = useLocalSearchParams<{ id: string }>()
  const stopId = typeof params.id === 'string' ? params.id : null
  const hydrated = useHydrated()

  const { stop, loading } = useLocalStop(stopId)
  const { trip } = useLocalTrip(stop?.trip_id ?? null)
  const siblings = useLocalStops(stop?.trip_id ?? null)
  const { byId: shops } = useLocalRetailers(
    useMemo(() => (stop === null ? [] : [stop.retailer_id]), [stop]),
  )
  const deliveries = useLocalDeliveries(stopId)
  const { byId: invoices } = useLocalInvoices(
    useMemo(() => deliveries.rows.map((row) => row.invoice_id), [deliveries.rows]),
  )
  const { row: dues } = useLocalOutstanding(stop?.retailer_id ?? null)

  const moveStop = useMoveStop()
  const [failing, setFailing] = useState(false)
  const [reason, setReason] = useState<string>('shop_closed')
  const [note, setNote] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const shop = stop === null ? undefined : shops.get(stop.retailer_id)
  const open = deliveries.rows.filter((row) => row.outcome === null)
  const terminal = stop !== null && isStopTerminal(stop.state)
  const arrived = stop?.state === 'arrived'

  if (stop === null) {
    return (
      <Screen title={t('d3.title')} testID="d3-screen">
        <LocalAsync
          loading={loading}
          hydrated={hydrated}
          empty={!loading}
          emptyMessage={t('d.nothingHere')}
          waitingMessage={t('d.filling')}
        >
          <Stack gap={4} />
        </LocalAsync>
      </Screen>
    )
  }

  const move = (
    state: 'started' | 'arrived' | 'failed',
    extra?: { lat?: number; lng?: number; failureReason?: string; failureNote?: string },
  ): void => {
    setBusy(true)
    void (async () => {
      try {
        await moveStop({
          stop,
          state,
          deviceId: deviceId(),
          ...(extra ?? {}),
        })
        haptics.success()
        setToast(state === 'failed' ? t('d3.failed') : t('d.savedOnPhone'))
      } catch (error) {
        haptics.error()
        setToast(error instanceof Error ? error.message : t('d.unknown'))
      } finally {
        setBusy(false)
      }
    })()
  }

  /**
   * "I am at the shop" takes ONE fix and attaches it — evidence for the geofence, never a block
   * (`ArriveStopOutput.distanceM` is amber beyond the tenant's `geofenceMetres`, and a missing fix is
   * fine). It is not asked for on mount: UX-00 §12 has no permission prompts in front of a task.
   */
  const arrive = (): void => {
    setBusy(true)
    void (async () => {
      const fix = await platformLocation.current().catch(() => null)
      setBusy(false)
      move('arrived', {
        ...(fix === null ? {} : { lat: fix.latitude, lng: fix.longitude }),
      })
    })()
  }

  const address = addressLine(shop?.address)
  const phone = shop?.phone ?? null

  return (
    <Screen
      title={shop?.name ?? t('d3.title')}
      /*
       * "Stop 3 of 6", never "Stop 3 of 3": how many stops the trip has is the TRIP's own figure.
       * Counting the sibling rows counts what has landed on the phone so far, which during the first
       * pull is a smaller number — and "of 3" on a six-stop day is a driver being told they are
       * nearly finished.
       */
      context={`${t('d.stopOf', { index: stop.sequence, total: Math.max(trip?.planned_stops ?? 0, siblings.rows.length) })}${
        trip?.trip_no === null || trip?.trip_no === undefined ? '' : ` · ${trip.trip_no}`
      }`}
      chips={
        <Row gap={2} wrap>
          <StopChip state={stop.state} testID="d3-state" />
          {dues === null || dues.outstanding_paise === 0 ? null : (
            <StatusChip
              testID="d3-dues"
              label={t('d.owes', { amount: formatINR(paise(dues.outstanding_paise)) })}
              family={dues.overdue_paise > 0 ? 'brick' : 'ochre'}
              solid={dues.overdue_paise > 0}
              figure
            />
          )}
          {shop?.payment_terms === undefined ? null : (
            <StatusChip testID="d3-terms" label={wordFor(t, shop.payment_terms)} family="neutral" />
          )}
        </Row>
      }
      bottomBar={
        terminal ? (
          /*
           * A FINISHED STOP STILL TAKES MONEY. The goods go in first and the shopkeeper counts the
           * cash after; `collections.record` accepts it for as long as the trip is out. A screen
           * whose only button was "back" sent a driver to the trip list to find a way back to the
           * door they were standing at.
           */
          <Stack gap={3}>
            <Button
              testID="d3-collect-after"
              label={t('d3.collect')}
              variant="primary"
              size="floor"
              fullWidth
              onPress={() => {
                router.push(`/stop/${stop.id}/collect`)
              }}
            />
            <Button
              testID="d3-back"
              label={t('d.back')}
              variant="secondary"
              fullWidth
              onPress={() => {
                router.replace('/')
              }}
            />
          </Stack>
        ) : arrived ? (
          <Stack gap={3}>
            {open.length === 1 && open[0] !== undefined ? (
              <Button
                testID="d3-deliver"
                label={t('d3.deliver')}
                variant="primary"
                size="floor"
                fullWidth
                onPress={() => {
                  router.push(`/stop/${stop.id}/deliver?deliveryId=${open[0]?.id ?? ''}`)
                }}
              />
            ) : null}
            <Button
              testID="d3-collect"
              label={t('d3.collect')}
              variant="secondary"
              size="floor"
              fullWidth
              onPress={() => {
                router.push(`/stop/${stop.id}/collect`)
              }}
            />
          </Stack>
        ) : (
          <Button
            testID="d3-arrive"
            label={t('d3.arrived')}
            variant="primary"
            size="floor"
            fullWidth
            loading={busy}
            onPress={arrive}
          />
        )
      }
      testID="d3-screen"
    >
      <Stack gap={6}>
        <Panel testID="d3-shop">
          <Stack gap={4}>
            {address === null ? null : (
              <Txt field="body" desk="body" testID="d3-address">
                {address}
              </Txt>
            )}
            <Row gap={8} wrap>
              <Button
                testID="d3-call"
                label={t('d.call')}
                variant="secondary"
                disabled={phone === null}
                disabledReason={t('d.noPhone')}
                onPress={() => {
                  if (phone !== null) void links.open(`tel:${phone}`)
                }}
              />
              <Button
                testID="d3-navigate"
                label={t('d.navigate')}
                variant="secondary"
                disabled={shop?.lat === null || shop?.lat === undefined || shop.lng === null}
                disabledReason={t('d.noPin')}
                onPress={() => {
                  if (
                    shop?.lat !== null &&
                    shop?.lat !== undefined &&
                    shop.lng !== null &&
                    shop.lng !== undefined
                  ) {
                    void links.open(links.mapsUrl(shop.lat, shop.lng, shop.name))
                  }
                }}
              />
            </Row>
            <Row gap={4} wrap>
              {stop.eta_at === null ? null : (
                <Field label={t('d3.eta')}>{instantWithClock(stop.eta_at)}</Field>
              )}
              {stop.arrived_at === null ? null : (
                <Field label={t('d3.arrivedLabel')}>{instantWithClock(stop.arrived_at)}</Field>
              )}
              {dues === null ? null : (
                <Field label={t('d.due')}>
                  <Money value={dues.outstanding_paise} size="moneyM" />
                </Field>
              )}
            </Row>
            {dues === null || dues.open_bills === 0 ? null : (
              <Txt field="label" desk="meta" color={colors.text.secondary} testID="d3-open-bills">
                {pl(t, 'd3.openBills', dues.open_bills)}
              </Txt>
            )}
          </Stack>
        </Panel>

        <Panel
          title={t('d.bills')}
          meta={<Money value={stop.planned_collection_paise} size="moneyM" />}
          testID="d3-bills"
        >
          <LocalAsync
            loading={deliveries.loading}
            hydrated={hydrated}
            empty={deliveries.rows.length === 0}
            emptyMessage={t('d3.noBills')}
            waitingMessage={t('d.filling')}
          >
            <Group>
              {deliveries.rows.map((row) => {
                const invoice = invoices.get(row.invoice_id)
                return (
                  <ListRow
                    key={row.id}
                    testID={`d3-bill-${row.id}`}
                    primary={invoice?.invoice_no ?? t('d.billNotHere')}
                    secondary={invoice === undefined ? undefined : longDate(invoice.invoice_date)}
                    trailingMoney={invoice?.total_paise ?? null}
                    trailingSize="moneyM"
                    trailing={
                      row.outcome === null ? (
                        <StatusChip label={t('word.pending')} family="neutral" />
                      ) : (
                        <StopChip state={row.outcome} />
                      )
                    }
                    /*
                     * AN OPEN BILL IS WORK; A FINISHED ONE IS PAPERWORK. Nothing in the app reached
                     * D9 (`/share/…`) at all until this row did: a driver who had just handed the
                     * goods over had no way to put the bill, its credit note or the receipt on the
                     * shopkeeper's WhatsApp, which is how a bill actually travels in this trade.
                     */
                    onPress={() => {
                      router.push(
                        row.outcome === null
                          ? `/stop/${stop.id}/deliver?deliveryId=${row.id}`
                          : `/share/${row.invoice_id}`,
                      )
                    }}
                  />
                )
              })}
            </Group>
          </LocalAsync>
        </Panel>

        {terminal ? (
          <Txt field="body" desk="body" color={colors.text.secondary} testID="d3-done">
            {stop.failure_reason === null
              ? t('d3.done')
              : `${wordFor(t, stop.failure_reason)}${
                  stop.failure_note === null ? '' : ` — ${stop.failure_note}`
                }`}
          </Txt>
        ) : (
          <Row gap={8} wrap>
            <Button
              testID="d3-van-sale"
              label={t('d3.vanSale')}
              variant="secondary"
              onPress={() => {
                router.push(`/stop/${stop.id}/van-sale`)
              }}
            />
            {/* Destructive is an OUTLINE, never a solid red button (UX-00 §6.1), and it sits its own
                50 dp away from the primary above (§5.2). */}
            <Button
              testID="d3-fail"
              label={t('d3.failStop')}
              variant="destructive"
              onPress={() => {
                setFailing(true)
              }}
            />
          </Row>
        )}
      </Stack>

      <Sheet
        testID="d3-fail-sheet"
        open={failing}
        onClose={() => {
          setFailing(false)
        }}
        title={t('d3.failTitle')}
      >
        <Stack gap={4}>
          <Txt field="body" desk="body">
            {t('d3.failBody')}
          </Txt>
          <Group>
            {FAILURE_REASONS.map((code) => (
              <ListRow
                key={code}
                testID={`d3-reason-${code}`}
                primary={wordFor(t, code)}
                state={reason === code ? 'selected' : 'default'}
                onPress={() => {
                  setReason(code)
                }}
              />
            ))}
          </Group>
          <TextInput
            testID="d3-fail-note"
            label={t('d3.failNote')}
            value={note}
            onChange={setNote}
            capitalize="sentences"
            maxLength={200}
            {...(reason === 'other' && note.trim() === '' ? { error: t('d3.failNote') } : {})}
          />
          <Button
            testID="d3-fail-confirm"
            label={t('d3.failConfirm')}
            variant="destructive"
            size="floor"
            fullWidth
            loading={busy}
            disabled={reason === 'other' && note.trim() === ''}
            disabledReason={t('d3.failNote')}
            onPress={() => {
              setFailing(false)
              move('failed', {
                failureReason: reason,
                ...(note.trim() === '' ? {} : { failureNote: note.trim() }),
              })
            }}
          />
        </Stack>
      </Sheet>

      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
      />
    </Screen>
  )
}
