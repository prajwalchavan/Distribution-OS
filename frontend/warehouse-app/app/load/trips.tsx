/**
 * W10 — trips, from the godown's side (docs/23 §4.1).
 *
 * THE GODOWN PLANS THE ROUND (QA DOS-131; docs/22 §8, 2026-09-12: the warehouse role keeps creating
 * trips, adding stops and starting loading). "Plan a trip" opens a form built from the trip planning
 * board (`delivery.trips.planning`): the date, a vehicle, a driver and a helper from the crew — a member
 * already on a trip that day is listed, disabled, saying which — the cash float, and the packed bills no
 * open trip carries yet, stops in the order the bills are tapped. "Add a bill" puts a late bill on a
 * planned or loading trip. Both forms are inline panels and both confirm in a dialog on the page, never
 * over a sheet (DOS-164). The trip and stop ids are fixed when the dialog opens, so pressing again after
 * a lost reply sends the same request and gets the same trip back. A refusal keeps the form and prints
 * the service's sentence under it. The godown has no staff read, so a trip's driver is named from the
 * board's crew.
 *
 * "Start loading" asks first; the load sheet is then built FOR the trip, from its shops, and counted
 * out on W7 (DOS-137).
 *
 * The godown never sends the vehicle off (QA DOS-043): `trips.depart` is DOORSTEP, the crew's step on D2
 * in the delivery app (consent, odometer, opening cash), and the server refuses it while any load sheet
 * of the trip is still a draft. Nor does the godown cancel or settle a trip, or see a rupee of its
 * collections — `settlementPreview` and `collections.*` are MONEY_COLLECTORS, and a loader is not one.
 */
import type { PlanningBill } from '@dos/contracts'
import { newId } from '@dos/api-client'
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Group,
  ListRow,
  Row,
  RupeeInput,
  Screen,
  Segments,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { haptics } from '@dos/ui/platform'
import { useState } from 'react'

import { shiftDays, shortDate, today } from '../../src/lib/dates'
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
} from '../../src/lib/trip-plan'
import { Async, Panel, PageTabs, useCan, workFamily } from '../../src/lib/ui'

/** The inline panel that is open: a new trip, or a late bill for one trip. Never both. */
type OpenPanel = { kind: 'plan' } | { kind: 'add'; tripId: string } | null

export default function Trips(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const can = useCan()
  const { session } = useSession()
  const signedIn = session !== null
  const mayPlan = can('delivery.trips.create')
  const mayAdd = can('delivery.stops.add')
  const mayReadBoard = can('delivery.trips.planning')

  /** The trip whose "Start loading" is waiting for the loader's yes. */
  const [asking, setAsking] = useState<string | null>(null)
  const [panel, setPanel] = useState<OpenPanel>(null)
  const [date, setDate] = useState(today)
  const [vehicleId, setVehicleId] = useState<string | null>(null)
  const [driverId, setDriverId] = useState<string | null>(null)
  const [helperId, setHelperId] = useState<string | null>(null)
  const [floatPaise, setFloatPaise] = useState<number | null>(null)
  /** Invoice ids in tap order. */
  const [chosen, setChosen] = useState<readonly string[]>([])
  /** The board is read a page at a time; "More bills" keeps the pages already read, whose bills may be chosen. */
  const [cursor, setCursor] = useState<string | null>(null)
  const [earlier, setEarlier] = useState<readonly PlanningBill[]>([])
  /** What the open dialog confirms, its ids fixed until the form changes. */
  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [stopPlan, setStopPlan] = useState<StopPlan | null>(null)
  const [confirming, setConfirming] = useState<'plan' | 'add' | null>(null)

  const trips = useQuery(
    ['trips', 'open'],
    () => api.api.delivery.trips.list({ states: ['planned', 'loading', 'active'], limit: 30 }),
    { enabled: signedIn },
  )
  const openTrips = trips.data?.items ?? []
  const addTrip =
    panel?.kind === 'add' ? openTrips.find((trip) => trip.id === panel.tripId) : undefined
  /** Who is busy depends on the date; the bills do not. A late bill is read for its trip's own date. */
  const boardDate = addTrip?.tripDate ?? date
  const board = useQuery(
    ['trips', 'planning', boardDate, cursor ?? 'first'],
    () =>
      api.api.delivery.trips.planning({
        date: boardDate,
        limit: 200,
        ...(cursor === null ? {} : { cursor }),
      }),
    { enabled: signedIn && mayReadBoard },
  )
  const vehicles = useQuery(['vehicles', 'active'], () => api.api.delivery.vehicles.list({}), {
    enabled: signedIn && panel?.kind === 'plan',
  })

  const startLoading = useMutation(
    (input: { id: string }, meta) =>
      api.api.delivery.trips.startLoading({ id: input.id, idempotencyKey: meta.idempotencyKey }),
    {
      invalidates: [['trips']],
      onSuccess: () => {
        setAsking(null)
        haptics.success()
      },
      onError: () => {
        // A refusal closes the dialog, so the server's sentence under the list is what the loader reads.
        setAsking(null)
        haptics.error()
      },
    },
  )
  const createTrip = useMutation(
    (input: TripPlan, meta) =>
      api.api.delivery.trips.create(tripCreateBody(input, meta.idempotencyKey)),
    {
      invalidates: [['trips']],
      onSuccess: () => {
        setConfirming(null)
        setPanel(null)
        setVehicleId(null)
        setDriverId(null)
        setHelperId(null)
        setFloatPaise(null)
        setChosen([])
        setPlan(null)
        setCursor(null)
        setEarlier([])
        haptics.success()
      },
      onError: () => {
        // The form and its snapshot stay: pressed again, the same trip goes again (a replay, never a 409).
        setConfirming(null)
        haptics.error()
      },
    },
  )
  const addStop = useMutation(
    (input: StopPlan, meta) => api.api.delivery.stops.add(addStopBody(input, meta.idempotencyKey)),
    {
      invalidates: [['trips']],
      onSuccess: () => {
        setConfirming(null)
        setPanel(null)
        setChosen([])
        setStopPlan(null)
        setCursor(null)
        setEarlier([])
        haptics.success()
      },
      onError: () => {
        setConfirming(null)
        haptics.error()
      },
    },
  )

  const crew = board.data?.crew ?? []
  const nameOf = (userId: string | null): string | null =>
    userId === null ? null : (crew.find((member) => member.userId === userId)?.name ?? null)
  const bills = mergeBills(earlier, board.data?.bills ?? [])
  const nextCursor = board.data?.nextCursor ?? null
  const onBoard = chosen.filter((invoiceId) => bills.some((bill) => bill.invoiceId === invoiceId))
  const form: PlanForm = {
    tripDate: date,
    vehicleId,
    driverId,
    helperId,
    openingCashPaise: floatPaise,
    chosen: onBoard,
  }
  const problem = planProblem(form)
  const tripName = (trip: { tripNo: string | null; id: string } | undefined): string =>
    trip === undefined ? '' : (trip.tripNo ?? trip.id.slice(0, 8))

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

  const askingTrip = asking === null ? undefined : openTrips.find((trip) => trip.id === asking)
  const planVehicle = (vehicles.data?.items ?? []).find((vehicle) => vehicle.id === plan?.vehicleId)

  /** The bills of the board, tapped for a new trip (`onTap` = tap order) or for one late stop. */
  const billList = (onTap: (invoiceId: string) => void): React.JSX.Element => (
    <Async
      state={board}
      rows={3}
      empty={bills.length === 0 && nextCursor === null}
      emptyMessage={t('w10.billsEmpty')}
    >
      <Stack gap={3}>
        <Group>
          {bills.map((bill) => (
            <ListRow
              key={bill.invoiceId}
              testID={`w10-bill-${bill.invoiceId}`}
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
        </Group>
        {nextCursor === null ? null : (
          <Button
            label={t('w10.more')}
            variant="ghost"
            onPress={() => {
              setEarlier(bills)
              setCursor(nextCursor)
            }}
            testID="w10-bills-more"
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
        testID={`w10-${role}-${member.userId}`}
        primary={member.name}
        {...(busy
          ? {
              secondary: t('w10.onTrip', {
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

  const bottomBar =
    panel?.kind === 'plan' ? (
      <Button
        label={t('w10.planConfirm')}
        variant="primary"
        loading={createTrip.status === 'pending'}
        disabled={problem !== null}
        {...(problem === null ? {} : { disabledReason: t(`w10.${problem}`) })}
        onPress={() => {
          const next = plan ?? snapshotPlan(form, bills, newId)
          if (next === null) return
          setPlan(next)
          setConfirming('plan')
        }}
        testID="w10-plan-confirm"
      />
    ) : panel?.kind === 'add' ? (
      <Button
        label={t('w10.addBill')}
        variant="primary"
        loading={addStop.status === 'pending'}
        disabled={onBoard.length === 0}
        {...(onBoard.length === 0 ? { disabledReason: t('w10.needBill') } : {})}
        onPress={() => {
          const next = stopPlan ?? addStopSnapshot(panel.tripId, bills, onBoard, newId)
          if (next === null) return
          setStopPlan(next)
          setConfirming('add')
        }}
        testID="w10-add-confirm"
      />
    ) : undefined

  return (
    <Screen
      title={t('w10.title')}
      context={session?.tenant.displayName}
      testID="w10-screen"
      bottomBar={bottomBar}
    >
      <Stack gap={6}>
        <PageTabs group="/load" active="/load/trips" />

        {panel?.kind === 'plan' ? (
          <Panel title={t('w10.planTitle')} testID="w10-plan-panel">
            <Stack gap={4}>
              <Stack gap={2}>
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {t('w10.date')}
                </Txt>
                <Segments
                  testID="w10-plan-date"
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
                    { id: 'today', label: t('w10.today') },
                    { id: 'tomorrow', label: t('w10.tomorrow') },
                  ]}
                />
              </Stack>

              <Stack gap={2}>
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {t('w7.vehicle')}
                </Txt>
                <Async state={vehicles} rows={2} empty={(vehicles.data?.items.length ?? 0) === 0}>
                  <Group>
                    {(vehicles.data?.items ?? []).map((vehicle) => (
                      <ListRow
                        key={vehicle.id}
                        testID={`w10-vehicle-${vehicle.id}`}
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
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {t('w10.driver')}
                </Txt>
                <Async state={board} rows={3} empty={crew.length === 0}>
                  <Group>
                    {crew.map((member) => crewRow(member, 'driver', driverId, setDriverId))}
                  </Group>
                </Async>
              </Stack>

              <Stack gap={2}>
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {t('w10.helper')}
                </Txt>
                <Group>
                  <ListRow
                    testID="w10-helper-none"
                    primary={t('w10.noHelper')}
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
                label={t('w10.float')}
                value={floatPaise}
                onChange={(paise) => {
                  setFloatPaise(paise)
                  changed()
                }}
                testID="w10-float"
              />

              <Stack gap={2}>
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {t('w10.bills')}
                </Txt>
                {billList((invoiceId) => {
                  setChosen((held) => toggleChosen(held, invoiceId))
                  changed()
                })}
              </Stack>

              {createTrip.error === undefined ? null : (
                <Txt
                  field="body"
                  desk="body"
                  color={colors.status.brick.fg}
                  testID="w10-plan-refusal"
                >
                  {createTrip.error.message}
                </Txt>
              )}
            </Stack>
          </Panel>
        ) : null}

        {panel?.kind === 'add' ? (
          <Panel title={t('w10.addBillTitle', { trip: tripName(addTrip) })} testID="w10-add-panel">
            <Stack gap={4}>
              {billList((invoiceId) => {
                setChosen((held) => toggleWithinShop(held, bills, invoiceId))
                changed()
              })}
              {addStop.error === undefined ? null : (
                <Txt
                  field="body"
                  desk="body"
                  color={colors.status.brick.fg}
                  testID="w10-add-refusal"
                >
                  {addStop.error.message}
                </Txt>
              )}
            </Stack>
          </Panel>
        ) : null}

        <Panel
          title={t('w10.trips')}
          actions={
            mayPlan ? (
              <Button
                label={panel?.kind === 'plan' ? t('action.close') : t('w10.plan')}
                variant={panel?.kind === 'plan' ? 'ghost' : 'secondary'}
                fullWidth={false}
                onPress={() => {
                  openPanel(panel?.kind === 'plan' ? null : { kind: 'plan' })
                }}
                testID="w10-plan"
              />
            ) : undefined
          }
          testID="w10-trips"
        >
          <Async state={trips} empty={openTrips.length === 0} emptyMessage={t('w10.tripsEmpty')}>
            <Stack gap={4}>
              {openTrips.map((trip) => (
                <Stack
                  key={trip.id}
                  gap={3}
                  pad={4}
                  background="surface"
                  radius="md"
                  border="all"
                  borderTone="faint"
                  testID={`w10-trip-${trip.id}`}
                >
                  <Row justify="between" align="center" gap={3} wrap>
                    <Txt field="bodyStrong" desk="cell">
                      {trip.tripNo ?? trip.id.slice(0, 8)}
                    </Txt>
                    <StatusChip label={trip.state} family={workFamily(trip.state)} />
                  </Row>
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {[
                      trip.vehicleRegNo,
                      shortDate(trip.tripDate),
                      t('w10.stops', {
                        done: trip.stopsCompleted,
                        planned: trip.plannedStops,
                      }),
                      nameOf(trip.driverId),
                    ]
                      .filter((part): part is string => part !== null)
                      .join(' · ')}
                  </Txt>
                  <Row gap={8} wrap>
                    {trip.state === 'planned' ? (
                      <Button
                        label={t('w10.startLoading')}
                        variant="primary"
                        loading={startLoading.status === 'pending'}
                        onPress={() => {
                          setAsking(trip.id)
                        }}
                        testID={`w10-load-${trip.id}`}
                      />
                    ) : null}
                    {mayAdd && (trip.state === 'planned' || trip.state === 'loading') ? (
                      <Button
                        label={
                          panel?.kind === 'add' && panel.tripId === trip.id
                            ? t('action.close')
                            : t('w10.addBill')
                        }
                        variant="secondary"
                        onPress={() => {
                          openPanel(
                            panel?.kind === 'add' && panel.tripId === trip.id
                              ? null
                              : { kind: 'add', tripId: trip.id },
                          )
                        }}
                        testID={`w10-add-${trip.id}`}
                      />
                    ) : null}
                    {trip.state === 'loading' ? (
                      <Txt
                        field="label"
                        desk="meta"
                        color={colors.text.secondary}
                        testID={`w10-driver-departs-${trip.id}`}
                      >
                        {t('w10.driverDeparts')}
                      </Txt>
                    ) : null}
                  </Row>
                </Stack>
              ))}
            </Stack>
          </Async>
        </Panel>

        {startLoading.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg}>
            {startLoading.error.message}
          </Txt>
        )}

        <Group>
          <ListRow primary={t('w9.settlementIsDesk')} state="disabled" />
        </Group>
      </Stack>

      <Dialog
        open={askingTrip !== undefined}
        onClose={() => {
          setAsking(null)
        }}
        title={t('w10.confirmTitle', { trip: tripName(askingTrip) })}
        body={t('w10.confirmBody', {
          vehicle: askingTrip?.vehicleRegNo ?? '',
          date: shortDate(askingTrip?.tripDate),
          stops: askingTrip?.plannedStops ?? 0,
        })}
        confirmLabel={t('w10.startLoading')}
        busy={startLoading.status === 'pending'}
        onConfirm={() => {
          if (askingTrip !== undefined) startLoading.mutate({ id: askingTrip.id })
        }}
        testID="w10-dialog"
      />

      <Dialog
        open={confirming === 'plan' && plan !== null}
        onClose={() => {
          setConfirming(null)
        }}
        title={t('w10.planConfirmTitle', {
          vehicle: planVehicle?.regNo ?? '',
          date: shortDate(plan?.tripDate),
        })}
        body={t('w10.planConfirmBody', {
          driver: nameOf(plan?.driverId ?? null) ?? '',
          stops: plan?.stops.length ?? 0,
          bills: (plan?.stops ?? []).reduce((n, stop) => n + stop.invoiceIds.length, 0),
        })}
        confirmLabel={t('w10.planConfirm')}
        busy={createTrip.status === 'pending'}
        onConfirm={() => {
          if (plan !== null) createTrip.mutate(plan)
        }}
        testID="w10-plan-dialog"
      />

      <Dialog
        open={confirming === 'add' && stopPlan !== null}
        onClose={() => {
          setConfirming(null)
        }}
        title={t('w10.addBillTitle', { trip: tripName(addTrip) })}
        body={t('w10.addBillBody', {
          shop:
            bills.find((bill) => bill.retailerId === stopPlan?.stop.retailerId)?.retailerName ?? '',
          bills: stopPlan?.stop.invoiceIds.length ?? 0,
        })}
        confirmLabel={t('w10.addBill')}
        busy={addStop.status === 'pending'}
        onConfirm={() => {
          if (stopPlan !== null) addStop.mutate(stopPlan)
        }}
        testID="w10-add-dialog"
      />
    </Screen>
  )
}
