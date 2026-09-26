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
 *
 * STOCK TO SELL (QA DOS-233). A trip planned to sell from the van gets a second list: the godown's sellable
 * lots, from which the loader picks what goes on the van beyond the bills — pieces keyed on the pad, never
 * pre-filled. They ride on the same sheet as `vanStock`, the crew counts them at check-out (W7 detail), and a
 * van-sales trip may load them with no bill at all. Every sheet used to be sent with `vanStock: []`.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  NumberPad,
  Row,
  Screen,
  Search,
  Sheet,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useGo,
  useStrings,
} from '@dos/ui'
import { haptics } from '@dos/ui/platform'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { instantWithClock, shortDate } from '../../../src/groups/warehouse/lib/dates'
import { loadSheetInput, packOnTrip } from '../../../src/groups/warehouse/lib/trip-plan'
import { atLeastPl } from '../../../src/groups/warehouse/lib/queue-depth'
import {
  Async,
  atLeast,
  Panel,
  PageTabs,
  useCan,
  workFamily,
} from '../../../src/groups/warehouse/lib/ui'
import { workFirst } from '../../../src/groups/warehouse/lib/work-first'

/** A lot picked to sell from the van, with what the godown holds of it (DOS-233). */
interface VanPick {
  lotId: string
  name: string
  batchNo: string
  available: number
  qtyPcs: number
}

/** W7 reads the newest 50 packed orders, then up to the contract's page cap — also create's cap per sheet. */
const PACKED_FIRST = 50
const PACKED_CAP = 200

export default function LoadSheets(): React.JSX.Element {
  const t = useStrings()
  const go = useGo()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const can = useCan()
  const { session } = useSession()
  const signedIn = session !== null

  const [tripId, setTripId] = useState<string | null>(null)
  const [chosen, setChosen] = useState<readonly string[]>([])
  /** DOS-233: the stock picked to sell from the van, by lot. */
  const [vanPicks, setVanPicks] = useState<Readonly<Record<string, VanPick>>>({})
  const [picking, setPicking] = useState<VanPick | null>(null)
  const [pickPieces, setPickPieces] = useState<number | null>(null)
  const [stockQuery, setStockQuery] = useState('')

  /*
   * THE SHEETS STILL WAITING ARE ASKED FOR BY NAME (DOS-047).
   *
   * One unfiltered page of 30 came back entirely `confirmed` on the pilot's floor, and the one draft
   * sheet waiting for its carton count was not on it — the work this screen exists for, missing from
   * the screen. `LoadSheetsListInput.status` takes ONE status, so the drafts are their own read and
   * the newest page follows them; `workFirst` lists a sheet on both pages once.
   */
  const drafts = useQuery(
    ['loadSheets', 'draft'],
    () => api.api.warehouse.loadSheets.list({ status: 'draft', limit: 20 }),
    { enabled: signedIn },
  )
  const sheets = useQuery(
    ['loadSheets', 'all'],
    () => api.api.warehouse.loadSheets.list({ limit: 30 }),
    { enabled: signedIn },
  )
  const sheetsShown = workFirst(drafts.data?.items ?? [], sheets.data?.items ?? [])
  /*
   * A PAGE OF TWENTY IS NOT A TOTAL (DOS-047, merge review). `atLeast`'s own docblock measured
   * "Sheets waiting 20 against 166" on the pilot database, and this read is that same page of twenty;
   * W1 prints it through `atLeast` already. `atLeastPl` is that rule inside the sentence this panel
   * says: "20+ sheets not sent out yet" while there is more behind the cursor, the true figure once
   * the page reached the end, and no meta line at all while the answer is unread.
   */
  const sheetsWaiting = atLeastPl(t, 'w7.sheetsWaiting', drafts.data)
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
  /** DOS-233: a trip planned to sell from the van (the trip's own switch AND the distributor's flag). */
  const sellsFromVan = trip?.vanSalesAllowed === true
  const locations = useQuery(
    ['locations', 'all'],
    () => api.api.inventory.locations.list({ activeOnly: true }),
    { enabled: signedIn && sellsFromVan },
  )
  const godownId = (locations.data?.items ?? []).find((one) => one.kind === 'warehouse')?.id ?? null
  const godownStock = useQuery(
    ['stock', 'sellable', godownId ?? 'none', stockQuery.trim()],
    () =>
      api.api.inventory.stock.sellable({
        locationId: godownId ?? '',
        limit: 40,
        ...(stockQuery.trim() === '' ? {} : { q: stockQuery.trim() }),
      }),
    { enabled: signedIn && sellsFromVan && godownId !== null },
  )
  const picks = sellsFromVan ? Object.values(vanPicks).filter((pick) => pick.qtyPcs > 0) : []
  const pickedPieces = picks.reduce((n, pick) => n + pick.qtyPcs, 0)
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
      input: {
        trip: { id: string; vehicleLocationId: string }
        orderIds: readonly string[]
        vanStock: readonly { lotId: string; qtyPcs: number }[]
      },
      meta,
    ) =>
      api.api.warehouse.loadSheets.create({
        ...loadSheetInput(input.trip, input.orderIds, input.vanStock),
        // The intent's own id: a retry after a lost reply replays the sheet instead of answering 409.
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
      }),
    {
      invalidates: [['loadSheets'], ['packs']],
      onSuccess: (result) => {
        haptics.success()
        setChosen([])
        setVanPicks({})
        router.push(go.href(`/load/${result.item.id}`))
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

  const ready = (picked.length > 0 || picks.length > 0) && trip !== null

  return (
    <Screen
      title={t('w7.title')}
      context={session?.tenant.displayName}
      testID="w7-screen"
      bottomBar={
        picked.length === 0 && picks.length === 0 ? undefined : (
          <Row justify="between" align="center" gap={4} wrap>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {[
                picked.length === 0 ? null : t('w4.selected', { count: picked.length, pieces: 0 }),
                picks.length === 0
                  ? null
                  : t('w7.vanPickedN', { lots: picks.length, pieces: pickedPieces }),
              ]
                .filter((part): part is string => part !== null)
                .join(' · ')}
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
                  vanStock: picks.map((pick) => ({ lotId: pick.lotId, qtyPcs: pick.qtyPcs })),
                })
              }}
              testID="w7-build"
            />
          </Row>
        )
      }
    >
      <Stack gap={6}>
        <PageTabs group={go.href('/load')} active={go.href('/load')} />

        <Panel
          title={t('w7.sheets')}
          {...(sheetsWaiting === undefined ? {} : { meta: sheetsWaiting })}
          testID="w7-sheets"
        >
          <Async
            state={[drafts, sheets]}
            empty={sheetsShown.length === 0}
            emptyMessage={t('w7.sheetsEmpty')}
          >
            <Group>
              {sheetsShown.map((sheet) => (
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
                    router.push(go.href(`/load/${sheet.id}`))
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
                    setVanPicks({})
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

        {sellsFromVan ? (
          <Panel
            title={t('w7.vanStock')}
            meta={
              picks.length === 0
                ? t('w7.vanStockHint', { trip: tripLabel })
                : t('w7.vanPickedN', { lots: picks.length, pieces: pickedPieces })
            }
            testID="w7-van-stock"
          >
            <Stack gap={4}>
              {picks.length === 0 ? null : (
                <Group>
                  {picks.map((pick) => (
                    <ListRow
                      key={`picked-${pick.lotId}`}
                      testID={`w7-van-picked-${pick.lotId}`}
                      primary={pick.name}
                      secondary={t('w7.vanPicked', { count: pick.qtyPcs })}
                      {...(pick.batchNo === ''
                        ? {}
                        : { reason: t('w.batch', { batch: pick.batchNo }) })}
                      state="selected"
                      onPress={() => {
                        setPicking(pick)
                        setPickPieces(pick.qtyPcs)
                      }}
                    />
                  ))}
                </Group>
              )}
              <Search
                testID="w7-van-search"
                value={stockQuery}
                onChange={setStockQuery}
                state={
                  (godownStock.data?.items.length ?? 0) === 0 && stockQuery.trim() !== ''
                    ? 'noResults'
                    : 'results'
                }
              />
              <Async
                state={[locations, godownStock]}
                empty={(godownStock.data?.items.length ?? 0) === 0}
                emptyMessage={t('w7.vanStockEmpty')}
              >
                <Group>
                  {(godownStock.data?.items ?? []).map((row) => (
                    <ListRow
                      key={`godown-${row.lotId}`}
                      testID={`w7-van-lot-${row.lotId}`}
                      primary={row.variantName}
                      secondary={t('w7.vanAvailable', { count: row.available })}
                      {...(row.batchNo === ''
                        ? {}
                        : { reason: t('w.batch', { batch: row.batchNo }) })}
                      state={(vanPicks[row.lotId]?.qtyPcs ?? 0) > 0 ? 'selected' : 'default'}
                      onPress={() => {
                        const held = vanPicks[row.lotId]
                        setPicking({
                          lotId: row.lotId,
                          name: row.variantName,
                          batchNo: row.batchNo,
                          available: row.available,
                          qtyPcs: held?.qtyPcs ?? 0,
                        })
                        setPickPieces(held === undefined ? null : held.qtyPcs)
                      }}
                    />
                  ))}
                </Group>
              </Async>
            </Stack>
          </Panel>
        ) : null}

        {create.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg}>
            {create.error.message}
          </Txt>
        )}
      </Stack>

      <Sheet
        open={picking !== null}
        onClose={() => {
          setPicking(null)
        }}
        title={picking?.name ?? ''}
        testID="w7-van-pick-sheet"
      >
        <Stack gap={4}>
          <NumberPad
            testID="w7-van-pick-pad"
            mode="count"
            label={t('w7.vanPick')}
            value={pickPieces}
            onChange={setPickPieces}
            doneLabel={t('action.done')}
            onDone={() => {
              if (picking === null || pickPieces === null) return
              if (pickPieces > picking.available) return
              const lotId = picking.lotId
              setVanPicks((was) => ({ ...was, [lotId]: { ...picking, qtyPcs: pickPieces } }))
              haptics.tap()
              setPicking(null)
            }}
          />
          {picking !== null && pickPieces !== null && pickPieces > picking.available ? (
            <Txt field="body" desk="body" color={colors.status.brick.fg} testID="w7-van-pick-over">
              {t('w7.vanPickOver', { count: picking.available })}
            </Txt>
          ) : (
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('w7.vanAvailable', { count: picking?.available ?? 0 })}
            </Txt>
          )}
          <Button
            label={t('w.close')}
            variant="ghost"
            onPress={() => {
              setPicking(null)
            }}
            testID="w7-van-pick-cancel"
          />
        </Stack>
      </Sheet>
    </Screen>
  )
}
