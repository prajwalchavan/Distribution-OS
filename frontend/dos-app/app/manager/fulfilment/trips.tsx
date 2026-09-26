/**
 * M7 Trips — the desk plans the round and adds a late bill (QA DOS-131; docs/23 §2.1 M7 lists
 * `delivery.trips.create`).
 *
 * The register lists the trips still to leave: planned and loading. "Plan a trip" opens an inline form
 * built from the trip planning board (`delivery.trips.planning`): today or tomorrow, a vehicle, a driver
 * and a helper from the crew — a member already on a trip that day is listed, disabled, saying which —
 * the cash float, and the packed bills no open trip carries yet, stops in the order the bills are tapped.
 * A bill that came back undelivered is listed under those, disabled and not tappable: it rides its van
 * until that trip checks in, and no trip may plan it until then (QA DOS-172). The board answers those
 * apart, under `held`, with the trip that carries each one; the rule is the server's alone and this
 * screen only draws what it sends.
 * Selecting a trip opens "Add a bill to …" for a late bill (`delivery.stops.add`). Both forms are inline
 * panels whose confirm is a dialog on the page — iOS refuses a dialog over a sheet (DOS-164) — and a
 * refusal is printed in the dialog, where the manager pressed (DOS-029). The trip and stop ids are fixed
 * when the dialog opens, so pressing again after a lost reply is a replay, never a 409.
 *
 * ONE APP, TWO ROLES. The accountant reaches this tab (`delivery.trips.list` is STOCK_VIEWERS) and reads
 * the register. It plans nothing, and the board (owner, manager, warehouse) is never even asked for, so
 * no refusal is drawn where there is nothing to do.
 *
 * WHAT CAME BACK (QA DOS-196). Above the trips sits the **Undelivered** register: every bill whose last
 * stop failed or was refused, with the reason and the crew's note, the trip it is riding, and the one
 * thing the desk does about it — wait for that van to check in, then plan it again. The rows are the
 * server's own answer (`delivery.deliveries.list` with `undeliveredOnly`); nothing here re-derives what
 * "undelivered" means. The trips register also lists the vans that are OUT, not only the ones still to
 * leave, so a desk told "3 trips active" has three rows it can open — read-only: a trip that has left
 * takes no late bill (`delivery.stops.add` is refused for it anyway), so the panel is never offered.
 *
 * A VAN THAT SELLS (QA DOS-233). While the distributor's `van_sales` flag is on the plan asks whether the van
 * also carries stock to sell at shops with no order, and says so to the server (`vanSalesEnabled`); such a
 * trip may leave with no bill at all. The godown then picks the stock to sell on the trip's load sheet.
 */
import type { Delivery, PlanningBill, Trip } from '@dos/contracts'
import { newId } from '@dos/api-client'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  formatINR,
  Group,
  ListRow,
  paise,
  Register,
  RupeeInput,
  Screen,
  Segments,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  routeFor,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import { shiftDays, shortDate, today } from '../../../src/groups/manager/lib/dates'
import {
  addStopBody,
  addStopSnapshot,
  mergeBills,
  planProblem,
  snapshotPlan,
  toggleChosen,
  toggleWithinShop,
  tripCreateBody,
  type PlanForm,
  type StopPlan,
  type TripPlan,
} from '../../../src/groups/manager/lib/trip-plan'
import {
  TRIP_TAKES_A_LATE_BILL,
  tripReach,
  undeliveredNext,
} from '../../../src/groups/manager/lib/trip-reach'
import {
  Async,
  PageTabs,
  Panel,
  Refusal,
  moneyColumn,
  stayOpen,
  textColumn,
  useCan,
  useNames,
} from '../../../src/groups/manager/lib/ui'
import { useWord } from '../../../src/groups/manager/lib/words'

const TRIP_FAMILY: Readonly<Record<string, StatusFamily>> = {
  planned: 'ochre',
  loading: 'clay',
  active: 'moss',
}

/** One row of the desk's Undelivered register. */
type Undelivered = Delivery

/** The inline panel that is open: a new trip, or a late bill for one trip. Never both. */
type OpenPanel = { kind: 'plan' } | { kind: 'add'; tripId: string } | null

export default function DeskTrips(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()
  const mayPlan = can('delivery.trips.create')
  const mayAdd = can('delivery.stops.add')
  const mayReadBoard = can('delivery.trips.planning')
  const mayReadUndelivered = can('delivery.deliveries.list')

  const [panel, setPanel] = useState<OpenPanel>(null)
  const [date, setDate] = useState(today)
  const [vehicleId, setVehicleId] = useState<string | null>(null)
  const [driverId, setDriverId] = useState<string | null>(null)
  const [helperId, setHelperId] = useState<string | null>(null)
  const [floatPaise, setFloatPaise] = useState<number | null>(null)
  const [vanSales, setVanSales] = useState(false)
  /** Invoice ids in tap order. */
  const [chosen, setChosen] = useState<readonly string[]>([])
  /** The board is read a page at a time; "More bills" keeps the pages already read, whose bills may be chosen. */
  const [cursor, setCursor] = useState<string | null>(null)
  const [earlier, setEarlier] = useState<readonly PlanningBill[]>([])
  /** What the open dialog confirms, its ids fixed until the form changes. */
  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [stopPlan, setStopPlan] = useState<StopPlan | null>(null)
  const [confirming, setConfirming] = useState<'plan' | 'add' | null>(null)

  const trips = useQuery(['trips', 'desk-open'], () =>
    api.api.delivery.trips.list({ states: ['planned', 'loading', 'active'], limit: 50 }),
  )
  /** What came back on a van and is waiting to go out again (QA DOS-196). */
  const undelivered = useQuery(
    ['deliveries', 'undelivered'],
    () => api.api.delivery.deliveries.list({ undeliveredOnly: true, limit: 50 }),
    { enabled: mayReadUndelivered },
  )
  const vehicles = useQuery(['vehicles', 'all'], () => api.api.delivery.vehicles.list({}))
  /** DOS-233: the van-sales choice exists only while the distributor has van sales switched on. */
  const flags = useQuery(['tenancy', 'flags'], () => api.api.tenancy.featureFlags.list(), {
    enabled: mayPlan,
  })
  const vanSalesOn =
    flags.data?.items.some((flag) => flag.flag === 'van_sales' && flag.enabled) ?? false
  const openTrips = trips.data?.items ?? []
  const undeliveredBills = undelivered.data?.items ?? []
  const addTrip =
    panel?.kind === 'add' ? openTrips.find((trip) => trip.id === panel.tripId) : undefined
  /** A late bill goes only on a trip that has not left (QA DOS-196); a van on the road is read-only. */
  const mayAddTo = (trip: Trip): boolean => mayAdd && TRIP_TAKES_A_LATE_BILL.has(trip.state)
  /** Who is busy depends on the date; the bills do not. A late bill is read for its trip's own date. */
  const boardDate = addTrip?.tripDate ?? date
  /** Asked only by a role that may read it: the accountant's tab draws no refusal it cannot act on. */
  const board = useQuery(
    ['trips', 'planning', boardDate, cursor ?? 'first'],
    () =>
      api.api.delivery.trips.planning({
        date: boardDate,
        limit: 200,
        ...(cursor === null ? {} : { cursor }),
      }),
    { enabled: mayReadBoard && panel !== null },
  )

  const createTrip = useMutation(
    (input: TripPlan, meta) =>
      api.api.delivery.trips.create(tripCreateBody(input, meta.idempotencyKey)),
    { invalidates: [['trips']] },
  )
  const addStop = useMutation(
    (input: StopPlan, meta) => api.api.delivery.stops.add(addStopBody(input, meta.idempotencyKey)),
    { invalidates: [['trips']] },
  )

  const crew = board.data?.crew ?? []
  const bills = mergeBills(earlier, board.data?.bills ?? [])
  /** This page's bills still riding a van that has not checked in: shown, never plannable (QA DOS-172). */
  const held = board.data?.held ?? []
  const nextCursor = board.data?.nextCursor ?? null
  const onBoard = chosen.filter((invoiceId) => bills.some((bill) => bill.invoiceId === invoiceId))
  const form: PlanForm = {
    tripDate: date,
    vehicleId,
    driverId,
    helperId,
    openingCashPaise: floatPaise,
    chosen: onBoard,
    vanSales: vanSalesOn && vanSales,
  }
  const problem = planProblem(form)
  const activeVehicles = (vehicles.data?.items ?? []).filter((vehicle) => vehicle.active)
  const tripName = (trip: { tripNo: string | null; id: string } | undefined): string =>
    trip === undefined ? '' : (trip.tripNo ?? trip.id.slice(0, 8))
  const totalOf = (invoiceIds: readonly string[]): string =>
    formatINR(
      paise(
        bills
          .filter((bill) => invoiceIds.includes(bill.invoiceId))
          .reduce((sum, bill) => sum + bill.invoiceTotalPaise, 0),
      ),
    )

  /** Any change to what is being planned is a new intent: the snapshot, and its ids, go. */
  const changed = (): void => {
    setPlan(null)
    setStopPlan(null)
  }
  const openPanel = (next: OpenPanel): void => {
    setPanel(next)
    setChosen([])
    setCursor(null)
    setEarlier([])
    changed()
    createTrip.reset()
    addStop.reset()
  }
  const planned = (): void => {
    setConfirming(null)
    setPanel(null)
    setVehicleId(null)
    setDriverId(null)
    setHelperId(null)
    setFloatPaise(null)
    setVanSales(false)
    setChosen([])
    setPlan(null)
    setStopPlan(null)
    setCursor(null)
    setEarlier([])
  }

  const columns: readonly RegisterColumn<Trip>[] = [
    textColumn('trip', t('m7t.trip'), (row) => row.tripNo ?? row.id.slice(0, 8), {
      priority: 'identity',
    }),
    textColumn('date', t('m7t.date'), (row) => shortDate(row.tripDate)),
    textColumn('vehicle', t('m7t.vehicle'), (row) => row.vehicleRegNo),
    textColumn('driver', t('m7t.driver'), (row) => names.staff(row.driverId)),
    textColumn('stops', t('m7t.stops'), (row) => row.plannedStops, { align: 'right' }),
    {
      key: 'state',
      head: t('m7.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.state)} family={TRIP_FAMILY[row.state] ?? 'neutral'} />
      ),
    },
    /*
     * A van that has left says so in words, because the row does not open anything (QA DOS-196). A
     * fact about the trip, never about the reader: the accountant, who may add no bill, reads nothing.
     */
    textColumn('reach', t('m7u.next'), (row) =>
      tripReach(row.state, mayAdd) === 'onTheRoad' ? t('m7t.onTheRoad') : null,
    ),
  ]

  /**
   * WHAT CAME BACK, and what the desk does about it (QA DOS-196). The last column is the only action
   * there is, and it is read off the trip's own state (`undeliveredNext`, src/groups/manager/lib/trip-reach.ts): while
   * that van is out the bill cannot be planned (the server refuses it, QA DOS-172); from the moment it
   * checks in — `closing`, before any settlement — the bill is back on the planning board.
   */
  const undeliveredColumns: readonly RegisterColumn<Undelivered>[] = [
    textColumn('bill', t('m7u.bill'), (row) => row.invoiceNo ?? row.invoiceId.slice(0, 8), {
      priority: 'identity',
    }),
    textColumn('shop', t('m7u.shop'), (row) => row.retailerName),
    moneyColumn('value', t('m7u.value'), (row) => row.invoiceTotalPaise),
    textColumn('reason', t('m7u.reason'), (row) =>
      row.stopFailureReason === null ? null : word(row.stopFailureReason),
    ),
    textColumn('note', t('m7u.note'), (row) => row.stopFailureNote),
    textColumn('trip', t('m7u.trip'), (row) => row.tripNo ?? row.tripId.slice(0, 8)),
    textColumn('next', t('m7u.next'), (row) =>
      undeliveredNext(row.tripState) === 'plan'
        ? t('m7u.backAtTheGodown')
        : t('m7u.onTheRoad', { trip: row.tripNo ?? row.tripId.slice(0, 8) }),
    ),
  ]

  const label = (text: string): React.JSX.Element => (
    <Txt field="label" desk="meta" color={colors.text.secondary}>
      {text}
    </Txt>
  )

  /**
   * The bills of the board, tapped for a new trip (tap order) or for one late stop, and under them the
   * bills held on the road: a page of nothing but those still draws them (QA DOS-172).
   */
  const billList = (onTap: (invoiceId: string) => void): React.JSX.Element => (
    <Async
      state={[board]}
      rows={3}
      empty={bills.length === 0 && held.length === 0 && nextCursor === null}
      emptyMessage={t('m7t.billsEmpty')}
    >
      <Stack gap={3}>
        <Group>
          {bills.map((bill) => (
            <ListRow
              key={bill.invoiceId}
              testID={`trip-bill-${bill.invoiceId}`}
              primary={bill.retailerName}
              secondary={[bill.invoiceNo ?? bill.orderNo ?? bill.orderId.slice(0, 8), bill.beatName]
                .filter((part): part is string => part !== null)
                .join(' · ')}
              trailingMoney={bill.invoiceTotalPaise}
              state={chosen.includes(bill.invoiceId) ? 'selected' : 'default'}
              onPress={() => {
                onTap(bill.invoiceId)
              }}
            />
          ))}
          {held.map((bill) => (
            <ListRow
              key={bill.invoiceId}
              testID={`trip-held-${bill.invoiceId}`}
              primary={bill.retailerName}
              secondary={t('m7t.heldOnTrip', {
                trip: bill.onTripNo ?? bill.onTripId.slice(0, 8),
              })}
              trailingMoney={bill.invoiceTotalPaise}
              state="disabled"
            />
          ))}
        </Group>
        {nextCursor === null ? null : (
          <Button
            label={t('m7t.more')}
            variant="ghost"
            fullWidth={false}
            onPress={() => {
              setEarlier(bills)
              setCursor(nextCursor)
            }}
            testID="trip-bills-more"
          />
        )}
      </Stack>
    </Async>
  )

  /** A crew member as a choice: one already on a trip that day is disabled and says which. */
  const crewRow = (
    member: (typeof crew)[number],
    role: 'driver' | 'helper',
    selectedId: string | null,
    select: (userId: string | null) => void,
  ): React.JSX.Element => {
    const busy = member.onTripId !== null
    return (
      <ListRow
        key={member.userId}
        testID={`trip-${role}-${member.userId}`}
        primary={member.name}
        {...(busy
          ? {
              secondary: t('m7t.onTrip', {
                trip: member.onTripNo ?? member.onTripId?.slice(0, 8) ?? '',
              }),
            }
          : {})}
        state={busy ? 'disabled' : member.userId === selectedId ? 'selected' : 'default'}
        onPress={() => {
          select(member.userId === selectedId ? null : member.userId)
          changed()
        }}
      />
    )
  }

  return (
    <Screen
      title={t('m7t.title')}
      chips={
        <PageTabs
          group={routeFor('manager', '/fulfilment')}
          active={routeFor('manager', '/fulfilment/trips')}
        />
      }
    >
      <Stack gap={6}>
        {mayReadUndelivered ? (
          <Panel
            title={t('m7u.title')}
            meta={t('m7u.count', { count: undeliveredBills.length })}
            testID="desk-undelivered"
          >
            <Async
              state={[undelivered]}
              rows={3}
              empty={undeliveredBills.length === 0}
              emptyMessage={t('m7u.empty')}
            >
              <Register
                testID="desk-undelivered-register"
                columns={undeliveredColumns}
                rows={undeliveredBills}
                rowKey={(row) => row.id}
                frozen="bill"
                state="ready"
              />
            </Async>
          </Panel>
        ) : null}

        <Panel
          title={t('m7t.open')}
          actions={
            mayPlan ? (
              <Button
                label={panel?.kind === 'plan' ? t('app.close') : t('m7t.plan')}
                variant={panel?.kind === 'plan' ? 'ghost' : 'secondary'}
                fullWidth={false}
                onPress={() => {
                  openPanel(panel?.kind === 'plan' ? null : { kind: 'plan' })
                }}
                testID="trip-plan-open"
              />
            ) : undefined
          }
          testID="desk-trips"
        >
          <Async
            state={[trips]}
            rows={4}
            empty={openTrips.length === 0}
            emptyMessage={t('m7t.empty')}
          >
            <Register
              testID="desk-trips-register"
              columns={columns}
              rows={openTrips}
              rowKey={(row) => row.id}
              frozen="trip"
              selectedKey={panel?.kind === 'add' ? panel.tripId : null}
              onSelect={
                mayAdd
                  ? (row) => {
                      if (!mayAddTo(row)) return
                      openPanel(
                        panel?.kind === 'add' && panel.tripId === row.id
                          ? null
                          : { kind: 'add', tripId: row.id },
                      )
                    }
                  : undefined
              }
              state="ready"
            />
          </Async>
        </Panel>

        {panel?.kind === 'plan' ? (
          <Panel title={t('m7t.plan')} testID="trip-plan-panel">
            <Stack gap={4}>
              <Stack gap={2}>
                {label(t('m7t.date'))}
                <Segments
                  testID="trip-plan-date"
                  value={date === today() ? 'today' : 'tomorrow'}
                  onChange={(id) => {
                    setDate(id === 'today' ? today() : shiftDays(today(), 1))
                    // Who is free depends on the day.
                    setDriverId(null)
                    setHelperId(null)
                    setCursor(null)
                    setEarlier([])
                    changed()
                  }}
                  items={[
                    { id: 'today', label: t('m7t.today') },
                    { id: 'tomorrow', label: t('m7t.tomorrow') },
                  ]}
                />
              </Stack>

              <Stack gap={2}>
                {label(t('m7t.vehicle'))}
                <Async state={[vehicles]} rows={2} empty={activeVehicles.length === 0}>
                  <Group>
                    {activeVehicles.map((vehicle) => (
                      <ListRow
                        key={vehicle.id}
                        testID={`trip-vehicle-${vehicle.id}`}
                        primary={vehicle.regNo}
                        {...(vehicle.name === null ? {} : { secondary: vehicle.name })}
                        state={vehicle.id === vehicleId ? 'selected' : 'default'}
                        onPress={() => {
                          setVehicleId(vehicle.id === vehicleId ? null : vehicle.id)
                          changed()
                        }}
                      />
                    ))}
                  </Group>
                </Async>
              </Stack>

              <Stack gap={2}>
                {label(t('m7t.driver'))}
                <Async state={[board]} rows={3} empty={crew.length === 0}>
                  <Group>
                    {crew.map((member) => crewRow(member, 'driver', driverId, setDriverId))}
                  </Group>
                </Async>
              </Stack>

              <Stack gap={2}>
                {label(t('m7t.helper'))}
                <Group>
                  <ListRow
                    testID="trip-helper-none"
                    primary={t('m7t.noHelper')}
                    state={helperId === null ? 'selected' : 'default'}
                    onPress={() => {
                      setHelperId(null)
                      changed()
                    }}
                  />
                  {crew.map((member) => crewRow(member, 'helper', helperId, setHelperId))}
                </Group>
              </Stack>

              <RupeeInput
                label={t('m7t.float')}
                value={floatPaise}
                onChange={(value) => {
                  setFloatPaise(value)
                  changed()
                }}
                testID="trip-plan-float"
              />

              {vanSalesOn ? (
                <Stack gap={2}>
                  {label(t('m7t.vanSales'))}
                  <Segments
                    testID="trip-plan-van-sales"
                    value={vanSales ? 'sell' : 'bills'}
                    onChange={(id) => {
                      setVanSales(id === 'sell')
                      changed()
                    }}
                    items={[
                      { id: 'bills', label: t('m7t.billsOnly') },
                      { id: 'sell', label: t('m7t.alsoSell') },
                    ]}
                  />
                  {vanSales ? (
                    <Txt field="label" desk="meta" color={colors.text.secondary}>
                      {t('m7t.vanSalesHint')}
                    </Txt>
                  ) : null}
                </Stack>
              ) : null}

              <Stack gap={2}>
                {label(t('m7t.bills'))}
                {billList((invoiceId) => {
                  setChosen((chosen) => toggleChosen(chosen, invoiceId))
                  changed()
                })}
              </Stack>

              <Button
                label={t('m7t.confirmTitle')}
                variant="primary"
                fullWidth={false}
                disabled={problem !== null}
                {...(problem === null ? {} : { disabledReason: t(`m7t.${problem}`) })}
                onPress={() => {
                  const next = plan ?? snapshotPlan(form, bills, newId)
                  if (next === null) return
                  setPlan(next)
                  setConfirming('plan')
                }}
                testID="trip-plan-confirm"
              />
            </Stack>
          </Panel>
        ) : null}

        {panel?.kind === 'add' ? (
          <Panel title={t('m7t.addBillTitle', { trip: tripName(addTrip) })} testID="trip-add-panel">
            <Stack gap={4}>
              {billList((invoiceId) => {
                setChosen((chosen) => toggleWithinShop(chosen, bills, invoiceId))
                changed()
              })}
              <Button
                label={t('m7t.addBill')}
                variant="primary"
                fullWidth={false}
                disabled={onBoard.length === 0}
                {...(onBoard.length === 0 ? { disabledReason: t('m7t.needBill') } : {})}
                onPress={() => {
                  const next = stopPlan ?? addStopSnapshot(panel.tripId, bills, onBoard, newId)
                  if (next === null) return
                  setStopPlan(next)
                  setConfirming('add')
                }}
                testID="trip-add-confirm"
              />
            </Stack>
          </Panel>
        ) : null}
      </Stack>

      <Dialog
        open={confirming === 'plan' && plan !== null}
        onClose={() => {
          setConfirming(null)
        }}
        title={t('m7t.confirmTitle')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {t('m7t.confirmBody', {
                vehicle:
                  activeVehicles.find((vehicle) => vehicle.id === plan?.vehicleId)?.regNo ?? '',
                date: shortDate(plan?.tripDate),
                driver: crew.find((member) => member.userId === plan?.driverId)?.name ?? '',
                stops: plan?.stops.length ?? 0,
                total: totalOf((plan?.stops ?? []).flatMap((stop) => stop.invoiceIds)),
              })}
            </Txt>
            {plan?.vanSales === true ? (
              <Txt field="body" desk="body" testID="trip-plan-dialog-van-sales">
                {t('m7t.confirmVanSales')}
              </Txt>
            ) : null}
            <Refusal of={[createTrip]} scope={plan?.id ?? null} testID="trip-plan-refusal" />
          </Stack>
        }
        confirmLabel={t('m7t.confirmTitle')}
        busy={createTrip.status === 'pending'}
        onConfirm={() => {
          if (plan !== null) void createTrip.mutateAsync(plan).then(planned, stayOpen)
        }}
        testID="trip-plan-dialog"
      />

      <Dialog
        open={confirming === 'add' && stopPlan !== null}
        onClose={() => {
          setConfirming(null)
        }}
        title={t('m7t.addBillTitle', { trip: tripName(addTrip) })}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {t('m7t.addBillBody', {
                shop:
                  bills.find((bill) => bill.retailerId === stopPlan?.stop.retailerId)
                    ?.retailerName ?? '',
                bills: stopPlan?.stop.invoiceIds.length ?? 0,
                total: totalOf(stopPlan?.stop.invoiceIds ?? []),
              })}
            </Txt>
            <Refusal of={[addStop]} scope={stopPlan?.stop.id ?? null} testID="trip-add-refusal" />
          </Stack>
        }
        confirmLabel={t('m7t.addBill')}
        busy={addStop.status === 'pending'}
        onConfirm={() => {
          if (stopPlan !== null) void addStop.mutateAsync(stopPlan).then(planned, stayOpen)
        }}
        testID="trip-add-dialog"
      />
    </Screen>
  )
}
