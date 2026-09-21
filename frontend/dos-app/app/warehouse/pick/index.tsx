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
import { useSyncEngine } from '@dos/offline/react'
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
  useGo,
  useStrings,
} from '@dos/ui'
import { newId } from '@dos/api-client'
import { haptics } from '@dos/ui/platform'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { shortDate } from '../../../src/groups/warehouse/lib/dates'
import { pullAfterWrite } from '../../../src/groups/warehouse/lib/pull-after-write'
import { atLeastPl } from '../../../src/groups/warehouse/lib/queue-depth'
import { Async, Panel, workFamily } from '../../../src/groups/warehouse/lib/ui'
import { workFirst } from '../../../src/groups/warehouse/lib/work-first'

export default function PickQueue(): React.JSX.Element {
  const t = useStrings()
  const go = useGo()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null
  const engine = useSyncEngine()

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
  /*
   * THE WAVES THAT NEED A HAND ARE ASKED FOR BY NAME (DOS-047).
   *
   * One unfiltered page of 30 is what this panel used to be, and on the pilot's floor all 30 came
   * back `packed` or `picked` while the wave being picked and the wave nobody had started were not on
   * the page at all — so the only route to today's work was the Home queue. `PicklistsListInput.status`
   * takes ONE status, so the two live ones are two reads; the unfiltered page still follows them, for
   * the history. `workFirst` lists a wave that is on both pages once.
   */
  const picking = useQuery(
    ['picklists', 'picking'],
    () => api.api.warehouse.picklists.list({ status: 'picking', limit: 20 }),
    { enabled: signedIn },
  )
  const openWaves = useQuery(
    ['picklists', 'open'],
    () => api.api.warehouse.picklists.list({ status: 'open', limit: 20 }),
    { enabled: signedIn },
  )
  const waves = useQuery(
    ['picklists', 'live-and-open'],
    () => api.api.warehouse.picklists.list({ limit: 30 }),
    { enabled: signedIn },
  )
  /** Being picked, then not yet started, then the newest page whatever became of it. */
  const wavesShown = workFirst(
    picking.data?.items ?? [],
    openWaves.data?.items ?? [],
    waves.data?.items ?? [],
  )
  /*
   * AND THE FIGURE THAT COUNTS THEM SAYS HOW SURE IT IS (DOS-047, merge review).
   *
   * Both reads above are pages of twenty, so their lengths added together are a page size, not a
   * queue: "Waves open 40 against 315" is what `atLeast`'s own docblock measured on the pilot
   * database. W1 already prints these two reads honestly — `['picklists', 'open']` is the same cache
   * key this screen uses — so a raw sum here would have had two screens of one app disagreeing about
   * one number, and the picker's screen holding the false half. `atLeastPl` is `atLeast`'s rule said
   * in words: "20+ waves still to pick" while a page is capped, the true total once it is not, and
   * nothing at all while the answer is still unread.
   */
  const wavesToPick = atLeastPl(t, 'w4.wavesToPick', picking.data, openWaves.data)

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
        /*
         * THE PHONE IS TOLD THE WAVE EXISTS BEFORE THE PICKER IS SHOWN IT (DOS-119).
         *
         * W5 draws everything off this device's `picklists` and `pick_lines`, and a wave raised a
         * second ago is in neither, so the sheet read "Nothing here yet · 0 of 0 picked" for 57 s on
         * PICK-0083 and 33 s on PICK-0082 — with "Take it to packing" under it. The write itself is
         * the server's; the device only has to go and read it. NOT a local insert from the create
         * reply: a screen writing its own copy of what the office said is a second source of truth
         * on the device. `pullAfterWrite` is the ask that survives a poll already being in flight.
         */
        void pullAfterWrite(engine, 'wave raised')
        router.push(go.href(`/pick/${result.item.id}`))
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

        <Panel
          title={t('w4.waves')}
          {...(wavesToPick === undefined ? {} : { meta: wavesToPick })}
          testID="w4-waves"
        >
          <Async
            state={[picking, openWaves, waves]}
            empty={wavesShown.length === 0}
            emptyMessage={t('w4.wavesEmpty')}
          >
            <Group>
              {wavesShown.map((sheet) => (
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
                    router.push(go.href(`/pick/${sheet.id}`))
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
