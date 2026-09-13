/**
 * W7 (list) — the load sheets, and building a new one (docs/23 §4.1).
 *
 * A sheet is built WITHOUT moving anything: pick the trip, pick the packed orders, and the sheet
 * exists as paper. Stock moves at check-out, and check-out waits for the manager (docs/22 decision
 * 2026-09-05) — which is why every draft row here says whose step is next rather than showing a
 * button that would 403.
 *
 * A SHEET IS BUILT FOR A TRIP, FROM THE SHOPS ON IT (QA DOS-137). The sheet names the trip and loads the
 * trip's own vehicle, so the crew finds its load on its trip. A packed order whose shop is not a stop of
 * the chosen trip — or whose bill the planning board still lists as on no trip — stays in the list,
 * disabled, saying why: its cartons would show the crew the wrong load, and check-out would dispatch an
 * order no trip carries. The server stores whatever `tripId` it is given (warehouse cannot read
 * delivery), so the narrowing is this screen's, from `delivery.trips.get` and `delivery.trips.planning`.
 * It only ever narrows the packed list below; which rows exist, and in what order, is `packs.list`'s.
 *
 * The orders are kept in the order they are chosen, because "last stop first" is a loading decision
 * the floor makes and the server deliberately does not: reading `trip_stops` would make the warehouse
 * module depend on delivery (coordination §4 item 3).
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
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
import { haptics } from '@dos/ui/platform'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { instantWithClock, shortDate } from '../../src/lib/dates'
import { loadSheetInput, packOnTrip } from '../../src/lib/trip-plan'
import { Async, atLeast, Panel, PageTabs, useCan, workFamily } from '../../src/lib/ui'

/** W7 reads the newest 50 packed orders, then up to the contract's page cap — also create's cap per sheet. */
const PACKED_FIRST = 50
const PACKED_CAP = 200

export default function LoadSheets(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const can = useCan()
  const { session } = useSession()
  const signedIn = session !== null

  const [tripId, setTripId] = useState<string | null>(null)
  const [chosen, setChosen] = useState<readonly string[]>([])

  const sheets = useQuery(
    ['loadSheets', 'all'],
    () => api.api.warehouse.loadSheets.list({ limit: 30 }),
    { enabled: signedIn },
  )
  /**
   * The trips a load can be built for (DOS-137): planned, or already loading. Its own key — W10 caches
   * `['trips', 'open']` with the active trips in it — and both refresh on the `[['trips']]` invalidation.
   */
  const trips = useQuery(
    ['trips', 'loadable'],
    () => api.api.delivery.trips.list({ states: ['planned', 'loading'], limit: 30 }),
    { enabled: signedIn },
  )
  /** The chosen trip's stops: the shops this load may carry. */
  const tripDetail = useQuery(
    ['trips', 'detail', tripId ?? 'none'],
    () => api.api.delivery.trips.get({ id: tripId ?? '' }),
    { enabled: signedIn && tripId !== null },
  )
  /**
   * The bills no open trip carries yet: a second packed bill of a shop on the trip that the board still
   * lists is not this trip's load. Beyond the board's page the shop alone decides.
   */
  const board = useQuery(
    ['trips', 'planning', 'w7'],
    () => api.api.delivery.trips.planning({ limit: 200 }),
    { enabled: signedIn && tripId !== null && can('delivery.trips.planning') },
  )
  /**
   * Packed and waiting for a vehicle. The server applies loadSheets.create's own rule (DOS-133): the
   * order is packed and on no draft or confirmed sheet, newest pack first. "Show older packs" refetches
   * up to the cap; the key keeps the `['packs']` prefix, so Build's invalidation still refreshes it.
   */
  const [packedLimit, setPackedLimit] = useState(PACKED_FIRST)
  const packed = useQuery(
    ['packs', 'awaitingLoad', packedLimit],
    () => api.api.warehouse.packs.list({ status: 'awaiting_load', limit: packedLimit }),
    { enabled: signedIn },
  )

  const detail = tripDetail.data?.item
  const trip = tripId !== null && detail !== undefined && detail.id === tripId ? detail : null
  const tripLabel = trip === null ? '' : (trip.tripNo ?? trip.id.slice(0, 8))
  const unplanned: ReadonlySet<string> = new Set(
    (board.data?.bills ?? []).map((bill) => bill.invoiceId),
  )
  const packs = packed.data?.items ?? []
  /** Until a trip is chosen any row may be picked; once it is, only that trip's load counts. */
  const loadable = (pack: (typeof packs)[number]): boolean =>
    trip === null || packOnTrip(pack, trip, unplanned)
  /** The chosen orders this load would carry: a choice that is not on the chosen trip is dropped. */
  const picked = chosen.filter((orderId) => {
    const pack = packs.find((one) => one.orderId === orderId)
    return pack !== undefined && loadable(pack)
  })

  const create = useMutation(
    (
      input: { trip: { id: string; vehicleLocationId: string }; orderIds: readonly string[] },
      meta,
    ) =>
      api.api.warehouse.loadSheets.create({
        ...loadSheetInput(input.trip, input.orderIds),
        // The intent's own id: a retry after a lost reply replays the sheet instead of answering 409.
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
      }),
    {
      invalidates: [['loadSheets'], ['packs']],
      onSuccess: (result) => {
        haptics.success()
        setChosen([])
        router.push(`/load/${result.item.id}`)
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

  const ready = picked.length > 0 && trip !== null

  return (
    <Screen
      title={t('w7.title')}
      context={session?.tenant.displayName}
      testID="w7-screen"
      bottomBar={
        picked.length === 0 ? undefined : (
          <Row justify="between" align="center" gap={4} wrap>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('w4.selected', { count: picked.length, pieces: 0 })}
            </Txt>
            <Button
              label={t('w7.build')}
              variant="primary"
              loading={create.status === 'pending'}
              disabled={!ready}
              {...(ready ? {} : { disabledReason: t('w7.chooseTrip') })}
              onPress={() => {
                if (trip === null) return
                create.mutate({
                  trip: { id: trip.id, vehicleLocationId: trip.vehicleLocationId },
                  orderIds: picked,
                })
              }}
              testID="w7-build"
            />
          </Row>
        )
      }
    >
      <Stack gap={6}>
        <PageTabs group="/load" active="/load" />

        <Panel title={t('w7.sheets')} testID="w7-sheets">
          <Async
            state={sheets}
            empty={(sheets.data?.items.length ?? 0) === 0}
            emptyMessage={t('w7.sheetsEmpty')}
          >
            <Group>
              {(sheets.data?.items ?? []).map((sheet) => (
                <ListRow
                  key={sheet.id}
                  testID={`w7-sheet-${sheet.id}`}
                  primary={sheet.vehicleRegNo ?? t('w7.vehicle')}
                  secondary={`${shortDate(sheet.sheetDate)} · ${t('w7.expected', {
                    count: sheet.expectedPackages,
                  })}`}
                  trailing={
                    <StatusChip
                      label={
                        sheet.status === 'draft' && sheet.approvedBy === null
                          ? t('w7.waitingApproval')
                          : sheet.status
                      }
                      family={
                        sheet.status === 'draft' && sheet.approvedBy === null
                          ? 'ochre'
                          : workFamily(sheet.status)
                      }
                    />
                  }
                  {...(sheet.challanNo === null
                    ? {}
                    : { reason: t('w7.challan', { no: sheet.challanNo }) })}
                  onPress={() => {
                    router.push(`/load/${sheet.id}`)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('w7.trip')} testID="w7-trips">
          <Async
            state={trips}
            empty={(trips.data?.items.length ?? 0) === 0}
            emptyMessage={t('w7.tripsEmpty')}
          >
            <Group>
              {(trips.data?.items ?? []).map((row) => (
                <ListRow
                  key={row.id}
                  testID={`w7-trip-${row.id}`}
                  primary={`${row.tripNo ?? row.id.slice(0, 8)} · ${row.vehicleRegNo}`}
                  secondary={`${shortDate(row.tripDate)} · ${row.state}`}
                  state={row.id === tripId ? 'selected' : 'default'}
                  onPress={() => {
                    setTripId(row.id === tripId ? null : row.id)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel
          title={t('w7.packedOrders')}
          meta={
            packedLimit >= PACKED_CAP && (packed.data?.nextCursor ?? null) !== null
              ? t('w7.packedCapped', { count: PACKED_CAP })
              : atLeast(t, packed.data)
          }
          actions={
            (packed.data?.nextCursor ?? null) === null || packedLimit >= PACKED_CAP ? undefined : (
              /* `fullWidth={false}`: an inline word in a panel head, as on W4 (pick/index.tsx). */
              <Button
                label={t('w7.packedMore')}
                variant="ghost"
                fullWidth={false}
                onPress={() => {
                  setPackedLimit(PACKED_CAP)
                }}
                testID="w7-packed-more"
              />
            )
          }
          testID="w7-packed"
        >
          <Async
            state={packed}
            empty={(packed.data?.items.length ?? 0) === 0}
            emptyMessage={t('w7.packedEmpty')}
          >
            <Group>
              {packs.map((pack) => {
                const onTrip = loadable(pack)
                const line = `${pack.orderNo ?? pack.orderId.slice(0, 8)} · ${t('w6.packages')} ${String(
                  pack.packages,
                )} · ${t('w7.packedAt', { when: instantWithClock(pack.packedAt) })}`
                return (
                  <ListRow
                    key={pack.id}
                    testID={`w7-packed-${pack.orderId}`}
                    primary={pack.retailerName}
                    // A disabled row says why FIRST, so the sentence survives truncation on a phone.
                    secondary={
                      onTrip ? line : `${t('w7.notOnTrip', { trip: tripLabel })} · ${line}`
                    }
                    state={
                      !onTrip ? 'disabled' : chosen.includes(pack.orderId) ? 'selected' : 'default'
                    }
                    trailing={
                      pack.invoiceNo === null ? (
                        <StatusChip label={t('w6.noBill')} family="ochre" />
                      ) : (
                        <StatusChip label={pack.invoiceNo} family="moss" />
                      )
                    }
                    onPress={() => {
                      toggle(pack.orderId)
                    }}
                  />
                )
              })}
            </Group>
          </Async>
        </Panel>

        {create.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg}>
            {create.error.message}
          </Txt>
        )}
      </Stack>
    </Screen>
  )
}
