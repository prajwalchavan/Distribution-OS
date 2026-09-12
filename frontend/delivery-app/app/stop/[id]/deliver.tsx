/**
 * D4 — At the door (docs/23 §5.1): the bill, what is actually being dropped, what is coming back, and
 * the proof.
 *
 * THE OUTCOME IS NEVER SENT. `deliveries.record` derives it from the lines — every line full is
 * `delivered`, one short is `partial`, all zero is `failed` — so the three buttons at the top of this
 * screen are SHORTCUTS THAT FILL THE LINES IN, not a state the app decides. That is the whole reason
 * a shortfall and a return can never disagree with the credit note the server raises at the original
 * rate against an invoice it must never edit.
 *
 * One call, online or off. With a signal it is `delivery.deliveries.record` and the credit note comes
 * back with its number; with none it is one `deliveries` op in the outbox carrying its lines and its
 * proof INLINE (`delivery.sync.ts` reads them off the same op — a header without its lines has no
 * outcome), and the server applies the identical rules when it lands. The primary button says which
 * of the two is about to happen.
 *
 * NO COST, ANYWHERE. The lines show the pieces on the bill and the SELLING rate the shopkeeper is
 * charged; `tenant_product_costs` is invisible to this role by the database, and this screen never
 * asks for it.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import { useSyncStatus } from '@dos/offline/react'
import {
  Button,
  Money,
  QtyStepper,
  Row,
  Screen,
  Segments,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  useColors,
  wordFor,
  useStrings,
} from '@dos/ui'
import { haptics } from '@dos/ui/platform'
import { uuidv7 } from '@dos/domain'
import { isSaleableReturn, type DeliveryLineReason } from '@dos/contracts'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'

import { deviceId } from '../../../src/api'
import { longDate } from '../../../src/lib/dates'
import {
  useHydrated,
  useLocalDeliveries,
  useLocalInvoiceLines,
  useLocalInvoices,
  useLocalRetailers,
  useLocalStop,
  useLocalTrip,
  type LocalInvoiceLine,
} from '../../../src/lib/local'
import {
  captureProof,
  storeProof,
  MAX_INLINE_BASE64,
  type CapturedProof,
} from '../../../src/lib/proof'
import { useQueueDelivery, type QueuedPod } from '../../../src/lib/queue'
import { LocalAsync, Panel, Field } from '../../../src/lib/ui'

/** `DeliveryLineReasonSchema`, minus the ones only the desk sets. */
const LINE_REASONS: readonly DeliveryLineReason[] = [
  'refused',
  'damaged',
  'expired',
  'wrong_item',
  'short_loaded',
  'other',
]

/** Exactly `RecordDeliveryInput.lines[]`, so one array serves the online call and the outbox op. */
interface LinePayload {
  id: string
  invoiceLineId: string
  deliveredQtyPcs: number
  returnedQtyPcs: number
  returnedSaleable: boolean
  reason?: DeliveryLineReason
}

interface LineEntry {
  /** Client id of the `delivery_lines` row; stable so a retry writes the same row. */
  id: string
  deliveredQtyPcs: number
  returnedQtyPcs: number
  returnedSaleable: boolean
  reason: DeliveryLineReason | null
}

/** Free pieces are delivered and returned like any other piece (`RecordDeliveryInput`'s own rule). */
const billedPieces = (line: LocalInvoiceLine): number => line.qty_pcs + line.free_qty_pcs

export default function AtTheDoor(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const params = useLocalSearchParams<{ id: string; deliveryId?: string }>()
  const stopId = typeof params.id === 'string' ? params.id : null
  const deliveryId = typeof params.deliveryId === 'string' ? params.deliveryId : null
  const hydrated = useHydrated()
  const status = useSyncStatus()

  const { stop } = useLocalStop(stopId)
  const { trip } = useLocalTrip(stop?.trip_id ?? null)
  const deliveries = useLocalDeliveries(stopId)
  const row = deliveries.rows.find((one) => one.id === deliveryId) ?? null
  const { byId: invoices } = useLocalInvoices(
    useMemo(() => (row === null ? [] : [row.invoice_id]), [row]),
  )
  const invoice = row === null ? undefined : invoices.get(row.invoice_id)
  const lines = useLocalInvoiceLines(row?.invoice_id ?? null)
  const { byId: shops } = useLocalRetailers(
    useMemo(() => (stop === null ? [] : [stop.retailer_id]), [stop]),
  )
  const shop = stop === null ? undefined : shops.get(stop.retailer_id)

  /** The tenant's POD policy rides on `TripDetail` so the device carries it (docs/23 §8.4). */
  const tripDetail = useQuery(
    ['trip', trip?.id ?? null],
    () => api.api.delivery.trips.get({ id: trip?.id ?? '' }),
    { enabled: session !== null && trip !== null, staleTime: 300_000 },
  )
  const podPolicy = tripDetail.data?.item.policy.podRequired ?? 'credit_only'

  const [entries, setEntries] = useState<Record<string, LineEntry>>({})
  const [receiver, setReceiver] = useState('')
  const [note, setNote] = useState('')
  const [proof, setProof] = useState<CapturedProof | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Open on the likeliest outcome: the whole bill goes in. Every tap after that is a correction. */
  useEffect(() => {
    if (lines.rows.length === 0) return
    setEntries((held) => {
      if (Object.keys(held).length === lines.rows.length) return held
      const next: Record<string, LineEntry> = {}
      for (const line of lines.rows) {
        next[line.id] = held[line.id] ?? {
          id: uuidv7(),
          deliveredQtyPcs: billedPieces(line),
          returnedQtyPcs: 0,
          returnedSaleable: true,
          reason: null,
        }
      }
      return next
    })
  }, [lines.rows])

  const queueDelivery = useQueueDelivery()

  const record = useMutation(
    (input: { lines: LinePayload[]; pod: QueuedPod[] }, meta) =>
      api.api.delivery.deliveries.record({
        idempotencyKey: meta.idempotencyKey,
        id: row?.id ?? meta.id,
        tripId: row?.trip_id ?? '',
        stopId: row?.stop_id ?? '',
        invoiceId: row?.invoice_id ?? '',
        ...(receiver.trim() === '' ? {} : { receiverName: receiver.trim() }),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
        deliveredAt: new Date().toISOString(),
        deviceId: deviceId(),
        lines: input.lines,
        pod: input.pod.map((one) => ({
          id: one.id,
          kind: one.kind,
          /*
           * `PodEvidenceInput` refines to "a photo or signature carries EXACTLY ONE of objectKey /
           * inline". `storeProof` answers whichever the SERVER asked for, and dropping the
           * `objectKey` half of that answer sent a photo evidence row carrying neither — a 400 on
           * the one write a driver cannot skip, reading "Input validation failed" at a shop door.
           */
          ...(one.objectKey === undefined ? {} : { objectKey: one.objectKey }),
          ...(one.contentBase64 === undefined
            ? {}
            : {
                inline: {
                  mimeType: one.mimeType ?? 'image/jpeg',
                  contentBase64: one.contentBase64,
                },
              }),
          ...(one.payload === undefined ? {} : { payload: one.payload }),
          ...(one.lat === undefined ? {} : { lat: one.lat }),
          ...(one.lng === undefined ? {} : { lng: one.lng }),
        })),
      }),
    {
      invalidates: [['trip'], ['stops']],
      onSuccess: (result) => {
        haptics.success()
        setToast(
          result.creditNoteId === null
            ? t('d4.recorded')
            : t('d4.creditNote', { no: result.creditNoteId.slice(0, 8) }),
        )
        router.replace(`/stop/${String(stopId ?? '')}`)
      },
      onError: (failed) => {
        haptics.error()
        setError(failed.message)
      },
    },
  )

  if (row === null || invoice === undefined) {
    return (
      <Screen title={t('d4.title')} testID="d4-screen">
        <LocalAsync
          loading={deliveries.loading}
          hydrated={hydrated}
          empty={!deliveries.loading}
          emptyMessage={t('d.nothingHere')}
          waitingMessage={t('d.filling')}
        >
          <Stack gap={4} />
        </LocalAsync>
      </Screen>
    )
  }

  const totals = lines.rows.reduce(
    (acc, line) => {
      const entry = entries[line.id]
      const billed = billedPieces(line)
      const delivered = entry?.deliveredQtyPcs ?? billed
      const returned = entry?.returnedQtyPcs ?? 0
      return {
        billed: acc.billed + billed,
        delivered: acc.delivered + delivered,
        returned: acc.returned + returned,
        balanced: acc.balanced && delivered + returned === billed,
      }
    },
    { billed: 0, delivered: 0, returned: 0, balanced: true },
  )
  const shortPcs = totals.billed - totals.delivered
  const outcome =
    totals.delivered === 0 ? 'failed' : totals.delivered === totals.billed ? 'delivered' : 'partial'

  /** `credit_only` means a shop on credit terms; `ON_DELIVERY` and `ADVANCE` pay at the door. */
  const onCredit = shop?.payment_terms === 'POST_FULFILLMENT'
  const podRequired =
    podPolicy === 'always' || (podPolicy === 'credit_only' && onCredit && outcome !== 'failed')
  const proofTooBig = proof !== null && proof.contentBase64.length > MAX_INLINE_BASE64

  const setAll = (mode: 'full' | 'none'): void => {
    setEntries((held) => {
      const next: Record<string, LineEntry> = {}
      for (const line of lines.rows) {
        const existing = held[line.id]
        const billed = billedPieces(line)
        const reason: DeliveryLineReason | null =
          mode === 'full' ? null : (existing?.reason ?? 'refused')
        next[line.id] = {
          id: existing?.id ?? uuidv7(),
          deliveredQtyPcs: mode === 'full' ? billed : 0,
          returnedQtyPcs: mode === 'full' ? 0 : billed,
          // where the pieces go follows the reason; nothing comes back on a full drop
          returnedSaleable: isSaleableReturn(reason),
          reason,
        }
      }
      return next
    })
  }

  const commit = (): void => {
    setError(null)
    if (!totals.balanced) {
      setError(t('d4.mismatch'))
      return
    }
    if (podRequired && proof === null) {
      setError(t('d4.podRequired'))
      return
    }
    setBusy(true)
    void (async () => {
      try {
        const pod: QueuedPod[] = []
        if (proof !== null) {
          if (status.online) {
            /*
             * With a signal, ask the server where the bytes go: a bucket (PUT, then only the key
             * travels) or inline (the local driver, which has nowhere to PUT). Never guess.
             */
            const stored = await storeProof(proof, async ({ mimeType, bytes }) => {
              const answer = await api.api.files.uploadUrl({
                idempotencyKey: `pod:${proof.uploadId}`,
                id: proof.uploadId,
                domain: 'pod',
                entityId: row.id,
                mimeType,
                bytes,
              })
              return {
                objectKey: answer.objectKey,
                url: answer.url,
                method: answer.method,
                headers: answer.headers,
                inline: answer.inline,
              }
            })
            pod.push({
              id: uuidv7(),
              kind: 'photo',
              ...(stored.objectKey === undefined ? {} : { objectKey: stored.objectKey }),
              ...(stored.inline === undefined
                ? {}
                : {
                    mimeType: stored.inline.mimeType,
                    contentBase64: stored.inline.contentBase64,
                  }),
            })
          } else {
            pod.push({
              id: uuidv7(),
              kind: 'photo',
              mimeType: proof.mimeType,
              contentBase64: proof.contentBase64,
            })
          }
        }
        /* Where the driver stood, as evidence — never a block (the geofence is amber, not a gate). */
        if (
          stop?.arrived_lat !== null &&
          stop?.arrived_lat !== undefined &&
          stop.arrived_lng !== null
        ) {
          pod.push({
            id: uuidv7(),
            kind: 'geo',
            lat: stop.arrived_lat,
            lng: stop.arrived_lng ?? undefined,
          })
        }

        const payload: LinePayload[] = lines.rows.map((line) => {
          const entry = entries[line.id]
          const billed = billedPieces(line)
          return {
            id: entry?.id ?? uuidv7(),
            invoiceLineId: line.id,
            deliveredQtyPcs: entry?.deliveredQtyPcs ?? billed,
            returnedQtyPcs: entry?.returnedQtyPcs ?? 0,
            returnedSaleable: entry?.returnedSaleable ?? true,
            ...(entry?.reason === null || entry?.reason === undefined
              ? {}
              : { reason: entry.reason }),
          }
        })

        if (status.online) {
          await record.mutateAsync({ lines: payload, pod })
        } else {
          await queueDelivery({
            id: row.id,
            tripId: row.trip_id,
            stopId: row.stop_id,
            invoiceId: row.invoice_id,
            retailerId: row.retailer_id,
            orderId: row.order_id,
            receiverName: receiver.trim(),
            note: note.trim(),
            lines: payload.map((line) => ({
              id: line.id,
              invoiceLineId: line.invoiceLineId,
              deliveredQtyPcs: line.deliveredQtyPcs,
              returnedQtyPcs: line.returnedQtyPcs,
              returnedSaleable: line.returnedSaleable,
              reason: line.reason,
            })),
            pod,
            deviceId: deviceId(),
            existing: row,
          })
          haptics.success()
          setToast(t('d.savedOnPhone'))
          router.replace(`/stop/${String(stopId ?? '')}`)
        }
      } catch (thrown) {
        haptics.error()
        setError(thrown instanceof Error ? thrown.message : t('d4.failedRecord'))
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <Screen
      title={invoice.invoice_no ?? t('d.bill')}
      context={`${shop?.name ?? t('d3.title')} · ${longDate(invoice.invoice_date)}`}
      chips={
        <Row gap={2} wrap>
          {/*
            THE OUTCOME OF THE TAP, NOT A STATE ALREADY RECORDED. A bare moss "Delivered" at the top
            of a bill nobody has recorded yet reads as done — on the screen whose whole purpose is to
            record it. The chip names the tense; `d4-already` below still carries the recorded one.
          */}
          <StatusChip
            testID="d4-outcome"
            label={t('d4.willRecord', { outcome: wordFor(t, outcome) })}
            family={outcome === 'delivered' ? 'moss' : outcome === 'partial' ? 'ochre' : 'brick'}
            solid={outcome === 'failed'}
          />
          {shortPcs === 0 ? null : (
            <StatusChip
              testID="d4-short"
              label={t('d4.short', { pieces: shortPcs })}
              family="ochre"
              figure
            />
          )}
          {row.outcome === null ? null : (
            <StatusChip
              testID="d4-already"
              label={t('d4.alreadyDone', { outcome: wordFor(t, row.outcome) })}
              family="neutral"
            />
          )}
        </Row>
      }
      bottomBar={
        <Stack gap={2}>
          <Row justify="between" align="center" gap={3}>
            <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
              {`${t('d4.dropping')} ${String(totals.delivered)} / ${String(totals.billed)}`}
            </Txt>
            <Money value={invoice.total_paise} size="moneyM" />
          </Row>
          <Button
            testID="d4-record"
            label={status.online ? t('d4.record') : t('d4.recordOffline')}
            variant="primary"
            size="floor"
            fullWidth
            loading={busy || record.status === 'pending'}
            disabled={!totals.balanced || row.outcome !== null || proofTooBig}
            disabledReason={
              row.outcome !== null
                ? t('d4.alreadyDone', { outcome: wordFor(t, row.outcome) })
                : proofTooBig
                  ? t('d4.podRetake')
                  : t('d4.mismatch')
            }
            onPress={commit}
          />
        </Stack>
      }
      testID="d4-screen"
    >
      <Stack gap={6}>
        <Row gap={8} wrap>
          <Button
            testID="d4-all-full"
            label={t('d4.delivered')}
            variant="secondary"
            size="floor"
            onPress={() => {
              setAll('full')
            }}
          />
          <Button
            testID="d4-all-none"
            label={t('d4.failedLine')}
            variant="destructive"
            size="floor"
            onPress={() => {
              setAll('none')
            }}
          />
        </Row>

        <Panel title={t('d4.lines')} meta={t('d4.billed')} testID="d4-lines">
          <LocalAsync
            loading={lines.loading}
            hydrated={hydrated}
            empty={lines.rows.length === 0}
            emptyMessage={t('d.nothingHere')}
            waitingMessage={t('d.filling')}
          >
            <Stack gap={5}>
              {lines.rows.map((line) => {
                const entry = entries[line.id]
                const billed = billedPieces(line)
                const delivered = entry?.deliveredQtyPcs ?? billed
                const returned = entry?.returnedQtyPcs ?? 0
                const caseSize = line.case_size ?? 1
                const set = (patch: Partial<LineEntry>): void => {
                  setEntries((held) => ({
                    ...held,
                    [line.id]: {
                      id: held[line.id]?.id ?? uuidv7(),
                      deliveredQtyPcs: held[line.id]?.deliveredQtyPcs ?? billed,
                      returnedQtyPcs: held[line.id]?.returnedQtyPcs ?? 0,
                      returnedSaleable: held[line.id]?.returnedSaleable ?? true,
                      reason: held[line.id]?.reason ?? null,
                      ...patch,
                    },
                  }))
                }
                return (
                  <Stack
                    key={line.id}
                    gap={3}
                    pad={4}
                    background="surface"
                    radius="md"
                    border="all"
                    borderTone="hairline"
                    testID={`d4-line-${line.id}`}
                  >
                    <Row justify="between" gap={3} wrap>
                      <Txt field="bodyStrong" desk="cell">
                        {line.description}
                      </Txt>
                      <Money value={line.line_total_paise} size="cell" />
                    </Row>
                    <Row gap={4} wrap>
                      <Field label={t('d4.billed')}>{t('d.pieces', { pieces: billed })}</Field>
                      {line.batch_no === null ? null : (
                        <Field label={t('d4.batch')}>{line.batch_no}</Field>
                      )}
                    </Row>
                    <Txt field="label" desk="meta" color={colors.text.secondary}>
                      {t('d4.dropping')}
                    </Txt>
                    <QtyStepper
                      testID={`d4-drop-${line.id}`}
                      pieces={delivered}
                      caseSize={caseSize > 0 ? caseSize : 1}
                      onChange={(pieces) => {
                        const capped = Math.max(0, Math.min(pieces, billed))
                        set({ deliveredQtyPcs: capped, returnedQtyPcs: billed - capped })
                      }}
                    />
                    {returned === 0 ? null : (
                      <Stack gap={3}>
                        <Txt field="label" desk="meta" color={colors.text.secondary}>
                          {`${t('d4.takingBack')} · ${t('d.pieces', { pieces: returned })}`}
                        </Txt>
                        {/* ONE decision (DOS-058): the reason decides where the pieces go. "Shop refused it"
                            puts them back on the van; "Damaged" and "Past its date" send them to the damaged /
                            expiry bin, and the server refuses a damaged or expired line marked saleable. */}
                        <Segments
                          testID={`d4-reason-${line.id}`}
                          items={LINE_REASONS.slice(0, 3).map((code) => ({
                            id: code,
                            label: wordFor(t, code),
                          }))}
                          value={entry?.reason ?? 'refused'}
                          onChange={(id) => {
                            const code = id as DeliveryLineReason
                            set({ reason: code, returnedSaleable: isSaleableReturn(code) })
                          }}
                        />
                        <Txt
                          field="label"
                          desk="meta"
                          color={colors.text.secondary}
                          testID={`d4-disposition-${line.id}`}
                        >
                          {entry?.returnedSaleable === false ? t('d4.damaged') : t('d4.saleable')}
                        </Txt>
                      </Stack>
                    )}
                  </Stack>
                )
              })}
            </Stack>
          </LocalAsync>
        </Panel>

        <Panel
          title={t('d4.pod')}
          meta={podRequired ? t('d4.podRequired') : t('d4.podNotRequired')}
          testID="d4-pod"
        >
          <Stack gap={3}>
            <Row gap={8} wrap align="center">
              <Button
                testID="d4-photo"
                label={proof === null ? t('d4.podPhoto') : t('d4.podRetake')}
                variant={proof === null && podRequired ? 'primary' : 'secondary'}
                onPress={() => {
                  void (async () => {
                    try {
                      const taken = await captureProof()
                      if (taken !== null) {
                        setProof(taken)
                        haptics.tap()
                      }
                    } catch {
                      // A camera that cannot hand back a usable file is a SENTENCE, never silence:
                      // this button is the one thing standing between a driver and a recorded
                      // delivery, and a tap that does nothing is indistinguishable from a dead app.
                      haptics.error()
                      setError(t('d4.podFailed'))
                    }
                  })()
                }}
              />
              {proof === null ? null : (
                <StatusChip
                  testID="d4-photo-attached"
                  label={t('d4.podAttached')}
                  family={proofTooBig ? 'brick' : 'moss'}
                  solid={proofTooBig}
                />
              )}
            </Row>
            {stop?.arrived_lat === null || stop?.arrived_lat === undefined ? null : (
              <Txt field="label" desk="meta" color={colors.text.secondary} testID="d4-geo">
                {t('d4.podGeo')}
              </Txt>
            )}
            <TextInput
              testID="d4-receiver"
              label={t('d4.receiver')}
              value={receiver}
              onChange={setReceiver}
              capitalize="words"
              maxLength={80}
            />
            <TextInput
              testID="d4-note"
              label={t('d4.note')}
              value={note}
              onChange={setNote}
              capitalize="sentences"
              maxLength={300}
            />
          </Stack>
        </Panel>

        {status.online ? null : (
          <Txt field="body" desk="body" color={colors.text.secondary} testID="d4-offline">
            {`${t('d.offlineWrite')} ${t('d4.creditNoteQueued')}`}
          </Txt>
        )}

        {error === null ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg} testID="d4-error">
            {error}
          </Txt>
        )}
      </Stack>

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
