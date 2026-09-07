/**
 * W4 — the fulfilment queue, and the wave raised from it (docs/23 §4.1).
 *
 * Confirmed orders waiting to be picked, grouped the way the floor groups them (by beat, because the
 * beat is the round the vehicle will drive), selected, and turned into one picking sheet. There is
 * not a rupee on this screen: `FulfilmentQueueItemSchema` carries quantities and names and no rate,
 * which is the contract agreeing with UX-00 that a picker is never shown what a carton is worth.
 *
 * `picklists.create` refuses a wave whose orders are fulfilled from two different godowns (409), so
 * the selection is narrowed to one location before the ask rather than after the refusal.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Group,
  ListRow,
  Row,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { newId } from '@dos/api-client'
import { haptics } from '@dos/ui/platform'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { shortDate } from '../../src/lib/dates'
import { Async, Panel, workFamily } from '../../src/lib/ui'

export default function PickQueue(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null

  const [beatId, setBeatId] = useState<string | null>(null)
  const [chosen, setChosen] = useState<readonly string[]>([])

  const queue = useQuery(
    ['queue', beatId ?? 'all'],
    () =>
      /*
       * `state: 'confirmed'` is not a nicety. `unpicklistedOnly` hides orders on a LIVE picklist, and
       * an order that was picked, packed and billed carries no live picklist any more — so a packed
       * order came back in "ORDERS WAITING" (SO-0073, measured), and selecting it would have been a
       * 409 from `picklists.create`, which refuses anything that is not `confirmed`. The queue asks
       * for exactly what a wave can be built from.
       */
      api.api.warehouse.queue.list({
        state: 'confirmed',
        unpicklistedOnly: true,
        limit: 100,
        ...(beatId === null ? {} : { beatId }),
      }),
    { enabled: signedIn },
  )
  const waves = useQuery(
    ['picklists', 'live-and-open'],
    () => api.api.warehouse.picklists.list({ limit: 30 }),
    { enabled: signedIn },
  )

  const items = queue.data?.items ?? []

  /** The beats present in the queue itself — no second read for a filter the rows already carry. */
  const beats = useMemo(() => {
    const seen = new Map<string, string>()
    for (const item of items)
      if (item.beatId !== null && item.beatName !== null) seen.set(item.beatId, item.beatName)
    return [...seen].map(([id, label]) => ({ id, label }))
  }, [items])

  const selected = items.filter((item) => chosen.includes(item.orderId))
  const locations = new Set(selected.map((item) => item.fulfilFromLocationId))
  const mixed = locations.size > 1
  const pieces = selected.reduce((sum, item) => sum + item.totalQtyPcs, 0)

  const create = useMutation(
    (input: { orderIds: readonly string[] }, meta) =>
      api.api.warehouse.picklists.create({
        id: newId(),
        idempotencyKey: meta.idempotencyKey,
        orderIds: [...input.orderIds],
        ...(beatId === null ? {} : { beatId }),
      }),
    {
      invalidates: [['queue'], ['picklists']],
      onSuccess: (result) => {
        haptics.success()
        setChosen([])
        router.push(`/pick/${result.item.id}`)
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  const toggle = (orderId: string): void => {
    setChosen((held) =>
      held.includes(orderId) ? held.filter((one) => one !== orderId) : [...held, orderId],
    )
  }

  return (
    <Screen
      title={t('w4.title')}
      context={session?.tenant.displayName}
      testID="w4-screen"
      bottomBar={
        chosen.length === 0 ? undefined : (
          <Row justify="between" align="center" gap={4} wrap>
            <Txt field="moneyM" desk="cell" numeric>
              {t('w4.selected', { count: selected.length, pieces })}
            </Txt>
            <Button
              label={t('w4.makeWave')}
              variant="primary"
              loading={create.status === 'pending'}
              disabled={mixed}
              {...(mixed ? { disabledReason: t('w4.mixedLocation') } : {})}
              onPress={() => {
                create.mutate({ orderIds: chosen })
              }}
              testID="w4-create"
            />
          </Row>
        )
      }
    >
      <Stack gap={6}>
        {beats.length === 0 ? null : (
          <Chips
            testID="w4-beats"
            items={[
              { id: 'all', label: t('w4.everyBeat'), selected: beatId === null },
              ...beats.map((beat) => ({ ...beat, selected: beat.id === beatId })),
            ]}
            onToggle={(id) => {
              setBeatId(id === 'all' ? null : id)
              setChosen([])
            }}
            {...(beatId === null
              ? {}
              : {
                  onClear: () => {
                    setBeatId(null)
                  },
                })}
          />
        )}

        <Panel
          title={t('w4.queue')}
          meta={
            items.length === 0 ? undefined : t('w4.selected', { count: selected.length, pieces })
          }
          actions={
            items.length === 0 ? undefined : (
              /*
               * `fullWidth={false}` on purpose. A kit `<Button>` fills its parent by default (right
               * for a bottom bar, wrong for two ghost words in a panel head): on the iPhone the pair
               * measured 200% of the row and "Clear" was off the screen entirely. These are inline
               * text actions and size to their labels on both renderers.
               */
              <Row gap={8}>
                <Button
                  label={t('w4.selectAll')}
                  variant="ghost"
                  fullWidth={false}
                  onPress={() => {
                    const first = items[0]?.fulfilFromLocationId ?? null
                    setChosen(
                      items
                        .filter((item) => item.fulfilFromLocationId === first)
                        .map((item) => item.orderId),
                    )
                  }}
                  testID="w4-all"
                />
                <Button
                  label={t('w4.clear')}
                  variant="ghost"
                  fullWidth={false}
                  onPress={() => {
                    setChosen([])
                  }}
                  testID="w4-none"
                />
              </Row>
            )
          }
          testID="w4-queue"
        >
          <Async state={queue} empty={items.length === 0} emptyMessage={t('w4.queueEmpty')}>
            {mixed ? (
              <Txt field="body" desk="body" color={colors.status.ochre.fg}>
                {t('w4.mixedLocation')}
              </Txt>
            ) : null}
            <Group>
              {items.map((item) => (
                <ListRow
                  key={item.orderId}
                  testID={`w4-order-${item.orderId}`}
                  primary={item.retailerName}
                  secondary={`${item.orderNo ?? item.orderId.slice(0, 8)} · ${item.beatName ?? '—'} · ${t(
                    'w.pieces',
                    { pieces: item.totalQtyPcs },
                  )}`}
                  state={chosen.includes(item.orderId) ? 'selected' : 'default'}
                  trailing={
                    item.picklistId === null ? (
                      <StatusChip label={item.state} family={workFamily(item.state)} />
                    ) : (
                      <StatusChip label={t('w4.onWave')} family="clay" />
                    )
                  }
                  reason={
                    item.expectedDeliveryDate === null
                      ? undefined
                      : shortDate(item.expectedDeliveryDate)
                  }
                  onPress={() => {
                    toggle(item.orderId)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('w4.waves')} testID="w4-waves">
          <Async
            state={waves}
            empty={(waves.data?.items.length ?? 0) === 0}
            emptyMessage={t('w4.wavesEmpty')}
          >
            <Group>
              {(waves.data?.items ?? []).map((sheet) => (
                <ListRow
                  key={sheet.id}
                  testID={`w4-wave-${sheet.id}`}
                  primary={sheet.picklistNo ?? sheet.id.slice(0, 8)}
                  secondary={t('w4.wavePicked', {
                    picked: sheet.pickedQtyPcs,
                    requested: sheet.requestedQtyPcs,
                  })}
                  trailing={<StatusChip label={sheet.status} family={workFamily(sheet.status)} />}
                  reason={shortDate(sheet.pickDate)}
                  onPress={() => {
                    router.push(`/pick/${sheet.id}`)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>
      </Stack>
    </Screen>
  )
}
