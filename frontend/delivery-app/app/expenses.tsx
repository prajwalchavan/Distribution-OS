/**
 * D7 — Expenses (docs/23 §5.1): diesel, toll, parking, with the bill photographed at the pump.
 *
 * ONLINE, and it says so. `trip_expenses` has a sync handler on the server but is absent from
 * `SYNC_PULL_TABLES`, so the manifest can never publish it as writable and the outbox refuses it by
 * name — the honest thing is to tell a driver at the pump that this one waits for a signal, rather
 * than to accept a tap that goes nowhere.
 *
 * No journal row is written here: expenses hit the books once, at settlement, so the trip's cash story
 * is a single entry (`RecordExpenseInput`'s own note). What this screen changes immediately is the
 * cash the office expects at check-in, which is why the running total is on the screen.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import { useSyncStatus } from '@dos/offline/react'
import {
  Button,
  Chips,
  Group,
  ListRow,
  Money,
  Row,
  RupeeInput,
  Screen,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  formatINR,
  useColors,
  useStrings,
} from '@dos/ui'
import { paise } from '@dos/domain'
import { haptics } from '@dos/ui/platform'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { deviceId } from '../src/api'
import { instantWithClock } from '../src/lib/dates'
import { pickCurrentTrip, useLocalTrips } from '../src/lib/local'
import { captureProof, storeProof, type CapturedProof } from '../src/lib/proof'
import { Async, Panel } from '../src/lib/ui'

/** `TripExpenseKindSchema`. `other` needs a note — the server refuses it without one. */
const KINDS = ['diesel', 'toll', 'parking', 'loading', 'food', 'repair', 'other'] as const

export default function Expenses(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null
  const status = useSyncStatus()

  const local = useLocalTrips()
  const trip = pickCurrentTrip(local.rows)
  const tripId = trip?.id ?? null

  const list = useQuery(
    ['expenses', tripId],
    () => api.api.delivery.expenses.list({ tripId: tripId ?? '', limit: 50 }),
    { enabled: signedIn && tripId !== null },
  )

  const [kind, setKind] = useState<string>('diesel')
  const [amountPaise, setAmountPaise] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [proof, setProof] = useState<CapturedProof | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const record = useMutation(
    (
      input: { proofObjectKey?: string; inline?: { mimeType: string; contentBase64: string } },
      meta,
    ) =>
      api.api.delivery.expenses.record({
        idempotencyKey: meta.idempotencyKey,
        id: meta.id,
        tripId: tripId ?? '',
        kind: kind as (typeof KINDS)[number],
        amountPaise: amountPaise ?? 0,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
        ...(input.proofObjectKey === undefined ? {} : { proofObjectKey: input.proofObjectKey }),
        ...(input.inline === undefined
          ? {}
          : {
              inline: {
                mimeType: input.inline.mimeType as 'image/jpeg',
                contentBase64: input.inline.contentBase64,
              },
            }),
        incurredAt: new Date().toISOString(),
        deviceId: deviceId(),
      }),
    {
      invalidates: [['expenses'], ['settlement'], ['trip']],
      onSuccess: () => {
        haptics.success()
        setToast(t('d7.recorded'))
        setAmountPaise(null)
        setNote('')
        setProof(null)
      },
      onError: (failed) => {
        haptics.error()
        setError(failed.message)
      },
    },
  )

  const needsNote = kind === 'other' && note.trim() === ''
  const amountBad = amountPaise === null || amountPaise <= 0

  const commit = (): void => {
    setError(null)
    if (amountBad) return
    if (needsNote) {
      setError(t('d7.needsNote'))
      return
    }
    setBusy(true)
    void (async () => {
      try {
        if (proof === null) {
          await record.mutateAsync({})
        } else {
          const stored = await storeProof(proof, async ({ mimeType, bytes }) => {
            const answer = await api.api.files.uploadUrl({
              idempotencyKey: `expense:${proof.uploadId}`,
              id: proof.uploadId,
              domain: 'expense',
              entityId: tripId ?? '',
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
          /*
           * `StoredProof` names the key `objectKey`; `RecordExpenseInput` names it
           * `proofObjectKey`. Spreading one into the other dropped it silently — the photo uploaded,
           * the expense recorded, and `trip_expenses.proof_object_key` stayed null, with nothing on
           * screen to say the proof had gone missing. An expense with no proof is an expense the
           * office may refuse to reimburse.
           */
          await record.mutateAsync({
            ...(stored.objectKey === undefined ? {} : { proofObjectKey: stored.objectKey }),
            ...(stored.inline === undefined ? {} : { inline: stored.inline }),
          })
        }
      } catch (thrown) {
        setError(thrown instanceof Error ? thrown.message : t('d7.failed'))
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <Screen
      title={t('d7.title')}
      context={trip?.trip_no ?? undefined}
      /*
       * The chip carried the WORDS "Spent on this trip" and no figure, one line above a bottom bar
       * that says the same words WITH the figure. A chip that repeats a label and withholds its
       * number is not information (UX-00 §6.9: a chip carrying a figure is set in `moneyM`).
       */
      chips={
        list.data === undefined ? undefined : (
          <StatusChip
            testID="d7-total"
            label={formatINR(paise(list.data.totalPaise))}
            family={list.data.totalPaise > 0 ? 'ochre' : 'neutral'}
            figure
          />
        )
      }
      bottomBar={
        <Stack gap={2}>
          <Row justify="between" align="center" gap={3}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('d7.total')}
            </Txt>
            <Money value={list.data?.totalPaise ?? null} size="moneyM" testID="d7-total-money" />
          </Row>
          <Button
            testID="d7-record"
            label={t('d7.record')}
            variant="primary"
            size="floor"
            fullWidth
            loading={busy || record.status === 'pending'}
            disabled={amountBad || needsNote || tripId === null || !status.online}
            disabledReason={
              !status.online
                ? t('d7.online')
                : tripId === null
                  ? t('d1.noTrip')
                  : needsNote
                    ? t('d7.needsNote')
                    : t('d7.amount')
            }
            onPress={commit}
          />
        </Stack>
      }
      testID="d7-screen"
    >
      <Stack gap={6}>
        {status.online ? null : (
          <Txt field="body" desk="body" color={colors.status.ochre.fg} testID="d7-offline">
            {t('d7.online')}
          </Txt>
        )}

        <Panel title={t('d7.kind')} testID="d7-form">
          <Stack gap={4}>
            <Chips
              testID="d7-kinds"
              items={KINDS.map((code) => ({
                id: code,
                label: t(code === 'loading' ? 'word.loading_expense' : `word.${code}`),
                selected: kind === code,
              }))}
              onToggle={(id) => {
                setKind(id)
                setError(null)
              }}
            />
            <RupeeInput
              testID="d7-amount"
              label={t('d7.amount')}
              value={amountPaise}
              onChange={setAmountPaise}
            />
            <TextInput
              testID="d7-note"
              label={t('d7.note')}
              value={note}
              onChange={setNote}
              capitalize="sentences"
              maxLength={200}
              {...(needsNote ? { error: t('d7.needsNote') } : {})}
            />
            <Row gap={8} wrap align="center">
              <Button
                testID="d7-photo"
                label={proof === null ? t('d7.proof') : t('d4.podRetake')}
                variant="secondary"
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
                <StatusChip testID="d7-photo-attached" label={t('d4.podAttached')} family="moss" />
              )}
            </Row>
          </Stack>
        </Panel>

        <Panel title={t('d7.today')} testID="d7-list">
          <Async
            state={list}
            empty={(list.data?.items.length ?? 0) === 0}
            emptyMessage={t('d7.empty')}
          >
            <Group>
              {(list.data?.items ?? []).map((row) => (
                <ListRow
                  key={row.id}
                  testID={`d7-expense-${row.id}`}
                  primary={t(row.kind === 'loading' ? 'word.loading_expense' : `word.${row.kind}`)}
                  secondary={`${instantWithClock(row.recordedAt)}${row.note === null ? '' : ` · ${row.note}`}`}
                  trailingMoney={row.amountPaise}
                  trailingSize="moneyM"
                  {...(row.proofObjectKey === null
                    ? {}
                    : { trailing: <StatusChip label={t('word.photo')} family="neutral" /> })}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        {error === null ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg} testID="d7-error">
            {error}
          </Txt>
        )}

        <Button
          testID="d7-back"
          label={t('d1.title')}
          variant="ghost"
          onPress={() => {
            router.push('/')
          }}
        />
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
