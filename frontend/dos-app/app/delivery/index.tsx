/**
 * D1 — Today's deliveries (docs/23 §5.1): the driver's jobs, in the order they should be done, each
 * with its next step on it.
 *
 * FOUNDER, 2026-09-28 (docs/22 §8): "currently the app feels hard to know, it may need training to
 * use — minimise the understanding effort". Every role's landing page IS that role's work with the
 * buttons on the page itself. For a driver that is: before the van leaves, ONE card — what is loaded
 * and "Picked up, start"; on the road, the stops in trip order as cards — "I am here", then "Delivered,
 * all items" (one tap and one confirm), then "Take money" (typed, never pre-filled); a finished door
 * folds to one quiet line; when every door is done, "Check in the vehicle". "Delivered" used to be
 * three taps and two screens from this list. Anything unusual — a short drop, a refusal, a return, a
 * tagged bill — is still the screen that exists today, one tap away on the same card.
 *
 * NOTHING ON THIS SCREEN IS A NEW WRITE. The arrival, the full delivery and the money are built by the
 * same functions D3, D4 and D5 call (`lib/door-writes.ts`) and sent the same way (`lib/home-writes.ts`),
 * so a card and its screen can never tell the office two different stories.
 *
 * Everything that was on this screen and is not a job — the figures, the load sheets, location, van
 * sales, money spent, the other trips — is below the list in a closed "More on this trip", unchanged
 * inside. Nothing is removed.
 *
 * EVERY FIGURE ON THIS SCREEN COMES OFF THE DEVICE. docs/23 §5.4: a driver is out of coverage for
 * hours, and this is the screen a crew opens at every stop. The only thing asked of the service is the
 * distributor's proof-of-delivery policy, which D4 asks for too; with no answer the same default
 * applies on both.
 *
 * "Today's" is deliberately the OPEN trip, not a date match (DOS-061): a van that leaves at six in the
 * morning is checked in after the IST business date has turned. The trip's own date is printed.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import { useSyncStatus } from '@dos/offline/react'
import {
  Button,
  Group,
  JobCard,
  JobList,
  KpiStrip,
  ListRow,
  Money,
  MoreGroup,
  Row,
  Screen,
  Stack,
  StatusChip,
  Toast,
  Txt,
  formatINR,
  useColors,
  useGo,
  useStrings,
  useViewport,
  wordFor,
  type JobAction,
  type JobChip,
} from '@dos/ui'
import { paise } from '@dos/domain'
import { haptics, links } from '@dos/ui/platform'
import { useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'

import { useTracking } from './_layout'
import { doorstepOrderRefusal } from '../../src/groups/delivery/lib/at-the-door'
import { instantWithClock, longDate, today } from '../../src/groups/delivery/lib/dates'
import {
  allDoorsDone,
  billsToDeliver,
  cartonsLoaded,
  doorNeedsPhoto,
  heldOnPhone,
  homeSummary,
  loadReadiness,
  moneyPutOff,
  nextJobId,
  putMoneyOff,
  readyToDeliverAll,
  sheetsForTrip,
  stopJob,
  type StopJob,
} from '../../src/groups/delivery/lib/home'
import { DeliverAllDialog, MoneySheet } from '../../src/groups/delivery/lib/home-sheets'
import { useArrive, useDeliverAll, useTakeMoney } from '../../src/groups/delivery/lib/home-writes'
import type { DoorMoney } from '../../src/groups/delivery/lib/door-writes'
import { keepKey } from '../../src/groups/delivery/lib/keep'
import {
  addressLine,
  bool,
  loadPanelTitleKey,
  loadSheetPackagesKey,
  pickCurrentTrip,
  tripEntryHref,
  useHydrated,
  useLocalDeliveryLinesOf,
  useLocalInvoiceLinesOf,
  useLocalInvoices,
  useLocalLoadSheets,
  useLocalRetailers,
  useLocalStops,
  useLocalTripDeliveries,
  useLocalTripReceipts,
  useLocalTrips,
  useLocalVehicle,
  type LocalDelivery,
  type LocalStop,
} from '../../src/groups/delivery/lib/local'
import { FillingNote, Panel, StopChip, pl, stopFamily } from '../../src/groups/delivery/lib/ui'

/** One stop as the list draws it: the row, its bills, and what `stopJob` made of them. */
interface StopCard {
  id: string
  stop: LocalStop
  bills: LocalDelivery[]
  job: StopJob
}

export default function TodaysDeliveries(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const go = useGo()
  const api = useApi()
  const { session } = useSession()
  const hydrated = useHydrated()
  const status = useSyncStatus()
  const tracking = useTracking()
  const wide = useViewport().kind === 'desk'

  const trips = useLocalTrips()
  const trip = pickCurrentTrip(trips.rows)
  const others = trips.rows.filter((one) => one.id !== trip?.id)
  const tripId = trip?.id ?? null

  const stops = useLocalStops(tripId)
  const { vehicle } = useLocalVehicle(trip?.vehicle_id ?? null)
  const receipts = useLocalTripReceipts(tripId)
  const deliveries = useLocalTripDeliveries(tripId)
  const sheets = useLocalLoadSheets(tripId)
  const retailerIds = useMemo(() => stops.rows.map((stop) => stop.retailer_id), [stops.rows])
  const { byId: shops } = useLocalRetailers(retailerIds)
  const { byId: invoices } = useLocalInvoices(
    useMemo(() => deliveries.rows.map((row) => row.invoice_id), [deliveries.rows]),
  )

  /* The tenant's proof policy rides on `TripDetail` — the same read, and the same default, as D4. */
  const tripDetail = useQuery(
    ['trip', tripId],
    () => api.api.delivery.trips.get({ id: tripId ?? '' }),
    { enabled: session !== null && tripId !== null, staleTime: 300_000 },
  )
  const podPolicy = tripDetail.data?.item.policy.podRequired ?? 'credit_only'

  const arrive = useArrive()
  const deliverAll = useDeliverAll()
  const takeMoney = useTakeMoney()

  const [toast, setToast] = useState<string | null>(null)
  /** The stop whose card is writing right now: its button shows the spinner and takes no second tap. */
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [paying, setPaying] = useState<string | null>(null)
  const [moneyError, setMoneyError] = useState<string | null>(null)
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(moneyPutOff)
  /*
   * Stable, because the kit's toast restarts its four seconds whenever this changes — and this screen
   * re-renders on every sync tick, so an inline arrow kept a toast on screen for as long as the phone
   * was pulling.
   */
  const dismissToast = useCallback(() => {
    setToast(null)
  }, [])

  /* ---- each stop as a job ---------------------------------------------------------------------- */

  const billsByStop = useMemo(() => {
    const out = new Map<string, LocalDelivery[]>()
    for (const row of deliveries.rows) out.set(row.stop_id, [...(out.get(row.stop_id) ?? []), row])
    return out
  }, [deliveries.rows])

  /** Every receipt this trip holds for a shop — the ones still on this phone included. */
  const takenByShop = useMemo(() => {
    const out = new Map<string, number>()
    for (const row of receipts.rows)
      out.set(row.retailer_id, (out.get(row.retailer_id) ?? 0) + row.amount_paise)
    return out
  }, [receipts.rows])

  const cards = useMemo<StopCard[]>(
    () =>
      stops.rows.map((stop) => {
        const bills = billsByStop.get(stop.id) ?? []
        return {
          id: stop.id,
          stop,
          bills,
          job: stopJob({
            state: stop.state,
            bills: bills.map((bill) => ({ outcome: bill.outcome, pending: bill._pending ?? null })),
            plannedPaise: stop.planned_collection_paise,
            takenPaise: takenByShop.get(stop.retailer_id) ?? 0,
          }),
        }
      }),
    [stops.rows, billsByStop, takenByShop],
  )

  /* The lines of the bills a "Delivered, all items" would record — only the stops the van is AT. */
  const atTheDoor = useMemo(
    () =>
      cards
        .filter((card) => card.job.kind === 'here')
        .flatMap((card) => card.bills.map((bill) => bill.invoice_id)),
    [cards],
  )
  const doorLines = useLocalInvoiceLinesOf(atTheDoor)
  /* What went in at the finished doors, for their one quiet line. */
  const recordedIds = useMemo(
    () => deliveries.rows.filter((row) => row.outcome !== null).map((row) => row.id),
    [deliveries.rows],
  )
  const recordedLines = useLocalDeliveryLinesOf(recordedIds)

  const shopName = (stop: LocalStop): string => shops.get(stop.retailer_id)?.name ?? t('d.unknown')
  const money = (value: number): string => formatINR(paise(value))
  const totalStops = Math.max(trip?.planned_stops ?? 0, stops.rows.length)
  const summary = homeSummary(cards, totalStops)
  const nextId = nextJobId(cards, deferred)
  const allDone = allDoorsDone(cards, totalStops, deferred)
  /*
   * Only a van on the road has a stop to do next. Once it is checked in, the one job is the office's
   * count, and a card still carrying money (it may be taken until the trip is settled) keeps its
   * buttons without claiming to be the next thing to do.
   */
  const onTheRoad = trip?.state === 'active'

  /* ---- the writes ------------------------------------------------------------------------------ */

  const onArrive = (stop: LocalStop): void => {
    if (busy !== null) return
    setBusy(stop.id)
    void (async () => {
      try {
        await arrive(stop)
        haptics.success()
        setToast(t('home.arrived', { shop: shopName(stop) }))
      } catch (thrown) {
        haptics.error()
        setToast(thrown instanceof Error ? thrown.message : t('d.unknown'))
      } finally {
        setBusy(null)
      }
    })()
  }

  const confirmingCard = cards.find((card) => card.id === confirming) ?? null
  const confirmBills =
    confirmingCard === null
      ? []
      : billsToDeliver(
          confirmingCard.bills,
          (invoiceId) => invoices.get(invoiceId)?.invoice_no ?? null,
          doorLines.rows,
        )

  const onDeliverAll = (): void => {
    const card = confirmingCard
    if (card === null || busy !== null) return
    setBusy(card.id)
    setConfirmError(null)
    const open = card.bills.filter((bill) => confirmBills.some((one) => one.deliveryId === bill.id))
    void (async () => {
      try {
        const outcome = await deliverAll(
          card.stop,
          open.map((delivery) => ({
            delivery,
            lines: doorLines.rows.filter((line) => line.invoice_id === delivery.invoice_id),
          })),
        )
        if (outcome.kind === 'notOnVan') {
          haptics.error()
          setConfirmError(doorstepOrderRefusal(t, outcome.block))
          return
        }
        if (outcome.kind === 'refused') {
          haptics.error()
          setConfirmError(outcome.message)
          return
        }
        haptics.success()
        setConfirming(null)
        setToast(
          outcome.phone > 0
            ? t(keepKey('savedOnPhone', status.persistent))
            : outcome.creditNotes.length > 0
              ? t('d4.creditNote', { no: outcome.creditNotes.join(', ') })
              : t('home.delivered', {
                  bills: confirmBills.map((bill) => bill.invoiceNo ?? t('d.bill')).join(', '),
                }),
        )
      } catch (thrown) {
        haptics.error()
        setConfirmError(thrown instanceof Error ? thrown.message : t('d4.failedRecord'))
      } finally {
        setBusy(null)
      }
    })()
  }

  const payingCard = cards.find((card) => card.id === paying) ?? null

  const onTakeMoney = (entered: DoorMoney): void => {
    const card = payingCard
    if (card === null || busy !== null) return
    setBusy(card.id)
    setMoneyError(null)
    void (async () => {
      try {
        const outcome = await takeMoney(card.stop, entered)
        if (outcome.kind === 'refused') {
          haptics.error()
          setMoneyError(outcome.message)
          return
        }
        haptics.success()
        setPaying(null)
        setToast(
          outcome.kind === 'office'
            ? t('d5.recorded', { no: outcome.no })
            : t(keepKey('recordedMoney', status.persistent), { no: outcome.no }),
        )
      } catch (thrown) {
        haptics.error()
        setMoneyError(thrown instanceof Error ? thrown.message : t('d5.failed'))
      } finally {
        setBusy(null)
      }
    })()
  }

  const onNoMoney = (stop: LocalStop): void => {
    setDeferred(putMoneyOff(stop.id))
    haptics.tap()
    setToast(t('home.noMoneyToast', { shop: shopName(stop) }))
  }

  const openStop = (stop: LocalStop): void => {
    router.push(go.href(`/stop/${stop.id}`))
  }

  /* ---- one card -------------------------------------------------------------------------------- */

  /**
   * What a finished door did, in one line: the goods, then the money.
   *
   * ON A PHONE THE SHOP'S NAME WINS THE LINE. The kit folds a finished card to the tick, the name and
   * this word, and the name is the one that shrinks — measured at 390 px, "Delivered 72 pc · ₹1,190.00
   * taken" left "1. Shiva…". So a phone gets the one fact that matters for that door — the money
   * taken, or what went wrong — and the desk, which has the room, gets the whole line. The rest is
   * one tap away on the stop.
   */
  const doneLine = (card: StopCard): string => {
    const taken = takenByShop.get(card.stop.retailer_id) ?? 0
    if (!wide) {
      if (card.stop.state === 'failed' || card.stop.state === 'skipped')
        return card.stop.failure_reason === null
          ? wordFor(t, card.stop.state)
          : wordFor(t, card.stop.failure_reason)
      if (card.stop.state === 'partial') return wordFor(t, 'partial')
      if (taken > 0) return t('home.doneTaken', { amount: money(taken) })
      return card.stop.state === 'arrived' ? t('home.doneHeld') : wordFor(t, card.stop.state)
    }
    const moneyWords =
      taken > 0 ? t('home.doneTaken', { amount: money(taken) }) : t('home.doneNoMoney')
    if (card.stop.state === 'failed' || card.stop.state === 'skipped')
      return t('home.doneLine', {
        what:
          card.stop.failure_reason === null
            ? wordFor(t, card.stop.state)
            : t('home.doneFailed', {
                outcome: wordFor(t, card.stop.state),
                reason: wordFor(t, card.stop.failure_reason),
              }),
        money: moneyWords,
      })
    const ids = new Set(card.bills.map((bill) => bill.id))
    const went = recordedLines.rows
      .filter((line) => ids.has(line.delivery_id))
      .reduce((sum, line) => sum + line.delivered_qty_pcs, 0)
    const outcome = card.stop.state === 'arrived' ? t('home.doneHeld') : wordFor(t, card.stop.state)
    return t('home.doneLine', {
      what: went > 0 ? t('home.donePieces', { outcome, pieces: went }) : outcome,
      money: moneyWords,
    })
  }

  const chipFor = (card: StopCard): JobChip => {
    switch (card.job.kind) {
      case 'waiting':
        return { label: t('home.chipWaiting'), family: 'neutral' }
      case 'here':
        return { label: t('home.chipHere'), family: 'clay' }
      case 'money':
        return { label: t('home.chipUnpaid'), family: 'ochre' }
      case 'finished':
        return {
          label: doneLine(card),
          /* Recorded on this device and not at the office yet: no colour claims an outcome. */
          family: card.stop.state === 'arrived' ? 'neutral' : stopFamily(card.stop.state),
        }
    }
  }

  const actionsFor = (
    card: StopCard,
    isNext: boolean,
  ): { primary?: JobAction; secondary?: JobAction[] } => {
    const { stop, job } = card
    const shop = shops.get(stop.retailer_id)
    const loading = busy === stop.id
    switch (job.kind) {
      case 'waiting': {
        /* The one to drive to also carries the map and the phone number — the stop screen's own two. */
        const extras: JobAction[] = []
        if (isNext && shop?.lat !== null && shop?.lat !== undefined && shop.lng !== null) {
          const { lat, lng, name } = shop
          extras.push({
            label: t('home.map'),
            testID: `d1-map-${stop.id}`,
            onPress: () => {
              void links.open(links.mapsUrl(lat, lng, name))
            },
          })
        }
        if (isNext && shop?.phone !== null && shop?.phone !== undefined) {
          const phone = shop.phone
          extras.push({
            label: t('home.call'),
            testID: `d1-call-${stop.id}`,
            onPress: () => {
              void links.open(`tel:${phone}`)
            },
          })
        }
        return {
          primary: {
            label: t('home.arrive'),
            testID: `d1-arrive-${stop.id}`,
            loading,
            onPress: () => {
              onArrive(stop)
            },
          },
          secondary: extras,
        }
      }
      case 'here': {
        const different: JobAction = {
          label: t('home.different'),
          testID: `d1-different-${stop.id}`,
          onPress: () => {
            openStop(stop)
          },
        }
        if (job.openBills === 0) {
          /* A door with no bill of its own (old dues, a van sale): the money, or the stop itself. */
          return {
            primary:
              job.leftPaise > 0
                ? {
                    label: t('home.takeMoney'),
                    testID: `d1-money-${stop.id}`,
                    onPress: () => {
                      setMoneyError(null)
                      setPaying(stop.id)
                    },
                  }
                : {
                    label: t('home.openShop'),
                    testID: `d1-open-${stop.id}`,
                    onPress: () => {
                      openStop(stop)
                    },
                  },
            secondary: job.leftPaise > 0 ? [different] : [],
          }
        }
        if (doorNeedsPhoto(podPolicy, shop?.payment_terms)) {
          /* The photograph cannot be skipped: "Deliver" opens D4 on the first bill still open. */
          const first = card.bills.find(
            (bill) => bill.outcome === null && !heldOnPhone(bill._pending),
          )
          return {
            primary: {
              label: t('home.deliver'),
              testID: `d1-deliver-${stop.id}`,
              onPress: () => {
                router.push(
                  go.href(
                    first === undefined
                      ? `/stop/${stop.id}`
                      : `/stop/${stop.id}/deliver?deliveryId=${first.id}`,
                  ),
                )
              },
            },
            secondary: [different],
          }
        }
        const bills = billsToDeliver(
          card.bills,
          (invoiceId) => invoices.get(invoiceId)?.invoice_no ?? null,
          doorLines.rows,
        )
        const ready = hydrated && readyToDeliverAll(bills)
        return {
          primary: {
            label: t('home.deliverAll'),
            testID: `d1-deliver-all-${stop.id}`,
            loading,
            disabled: !ready,
            ...(ready
              ? {}
              : { disabledReason: hydrated ? t('home.billsComing') : t('d.waitForFill') }),
            onPress: () => {
              setConfirmError(null)
              setConfirming(stop.id)
            },
          },
          secondary: [different],
        }
      }
      case 'money':
        return {
          primary: {
            label: t('home.takeMoney'),
            testID: `d1-money-${stop.id}`,
            loading,
            onPress: () => {
              setMoneyError(null)
              setPaying(stop.id)
            },
          },
          secondary: [
            {
              label: t('home.noMoney'),
              testID: `d1-no-money-${stop.id}`,
              onPress: () => {
                onNoMoney(stop)
              },
            },
          ],
        }
      case 'finished':
        return {}
    }
  }

  const stopCard = (card: StopCard): React.JSX.Element => {
    const { stop, job } = card
    const isNext = onTheRoad && card.id === nextId
    const where =
      stop.failure_reason === null
        ? (addressLine(shops.get(stop.retailer_id)?.address) ?? undefined)
        : wordFor(t, stop.failure_reason)
    const { primary, secondary } = actionsFor(card, isNext)
    return (
      <JobCard
        key={stop.id}
        testID={`d1-stop-${stop.id}`}
        title={t('home.stopTitle', { n: stop.sequence, shop: shopName(stop) })}
        {...(where === undefined ? {} : { subtitle: where })}
        {...(job.kind === 'finished' || job.leftPaise === 0
          ? {}
          : { trailing: <Money value={job.leftPaise} size="moneyM" /> })}
        chip={chipFor(card)}
        state={job.kind === 'finished' ? 'done' : isNext ? 'next' : 'default'}
        onPress={() => {
          openStop(stop)
        }}
        {...(primary === undefined ? {} : { primary })}
        {...(secondary === undefined ? {} : { secondary })}
      />
    )
  }

  /* ---- no trip, or not yet --------------------------------------------------------------------- */

  if (trips.loading && trip === null) {
    return (
      <Screen title={t('d1.title')} context={session?.tenant.displayName} testID="d1-screen">
        <JobList loading />
      </Screen>
    )
  }

  if (trip === null) {
    return (
      <Screen title={t('d1.title')} context={session?.tenant.displayName} testID="d1-screen">
        <Stack gap={4}>
          <JobList
            testID="d1-jobs"
            emptyMessage={t('d1.noTrip')}
            emptyActionLabel={t('home.pastTrips')}
            onEmptyAction={() => {
              router.push(go.href('/trips'))
            }}
          />
          <Txt field="body" desk="body" color={colors.text.secondary} testID="d1-no-trip">
            {hydrated ? t('d1.noTripBody') : t('d.filling')}
          </Txt>
        </Stack>
      </Screen>
    )
  }

  /* ---- the trip -------------------------------------------------------------------------------- */

  const road = trip.state === 'active'
  const beforeTheRoad = trip.state === 'planned' || trip.state === 'loading'
  const tripOrders = [
    ...new Set(
      deliveries.rows.map((row) => row.order_id).filter((id): id is string => id !== null),
    ),
  ]
  const tripSheets = sheetsForTrip(sheets.rows, trip.id, tripOrders)
  const readiness = loadReadiness({
    tripState: trip.state,
    sheets: tripSheets,
    orderIds: tripOrders,
  })
  const cartons = cartonsLoaded(tripSheets)
  const collectedPaise = receipts.rows.reduce((sum, row) => sum + row.amount_paise, 0)

  const summaryLine = t(summary.leftPaise > 0 ? 'home.summary' : 'home.summaryNothingLeft', {
    done: summary.done,
    total: summary.total,
    amount: money(summary.leftPaise),
  })

  const loadCard = (
    <JobCard
      key="load"
      testID="d1-load-card"
      title={
        trip.trip_date === today()
          ? t('home.loadTitle')
          : t('home.loadTitleFor', { date: longDate(trip.trip_date) })
      }
      subtitle={[
        pl(t, 'home.shops', totalStops),
        pl(t, 'home.bills', deliveries.rows.length),
        ...(cartons === null ? [] : [pl(t, 'home.cartons', cartons)]),
      ].join(' · ')}
      chip={
        readiness === 'ready'
          ? { label: t('home.chipLoaded'), family: 'moss' }
          : readiness === 'loading'
            ? { label: t('home.chipLoading'), family: 'ochre' }
            : { label: t('home.chipWaiting'), family: 'neutral' }
      }
      state="next"
      onPress={() => {
        router.push(go.href(`/trip/start?tripId=${trip.id}`))
      }}
      primary={{
        label: t('home.pickedUp'),
        testID: 'd1-start',
        disabled: readiness !== 'ready',
        ...(readiness === 'ready'
          ? {}
          : {
              disabledReason:
                readiness === 'notStarted' ? t('home.notStarted') : t('home.stillLoading'),
            }),
        onPress: () => {
          router.push(go.href(`/trip/start?tripId=${trip.id}`))
        },
      }}
    />
  )

  const allDoneCard = (
    <JobCard
      key="all-done"
      testID="d1-all-done"
      title={t('home.allDoneTitle')}
      subtitle={t('home.allDoneLine')}
      state="next"
      onPress={() => {
        router.push(go.href('/day'))
      }}
      primary={{
        label: t('home.checkIn'),
        testID: 'd1-check-in',
        onPress: () => {
          router.push(go.href('/day'))
        },
      }}
    />
  )

  const checkedInCard = (
    <JobCard
      key="checked-in"
      testID="d1-checked-in"
      title={t('home.checkedInTitle')}
      subtitle={t('home.checkedInLine')}
      state="next"
      onPress={() => {
        router.push(go.href(`/day?tripId=${trip.id}`))
      }}
      primary={{
        label: t('home.seeDay'),
        testID: 'd1-day',
        onPress: () => {
          router.push(go.href(`/day?tripId=${trip.id}`))
        },
      }}
    />
  )

  /* ---- More on this trip: everything that was here and is not a job, unchanged inside ---------- */

  const moreSections: React.JSX.Element[] = [
    <Panel key="trip" title={t('home.thisTrip')} testID="d1-trip-panel">
      <Stack gap={3}>
        <Row gap={2} wrap>
          <StatusChip
            testID="d1-trip-state"
            label={wordFor(t, trip.state)}
            family={road ? 'moss' : 'ochre'}
          />
          <StatusChip
            testID="d1-vehicle"
            label={vehicle?.reg_no ?? t('d.vehicle')}
            family="neutral"
          />
        </Row>
        <KpiStrip
          testID="d1-kpis"
          items={[
            {
              label: t('d1.collectedToday'),
              value: <Money value={collectedPaise} size="moneyM" />,
            },
            {
              label: t('d1.openingCash'),
              value: <Money value={trip.opening_cash_paise} size="moneyM" />,
            },
            { label: t('d8.stops'), value: `${String(summary.done)} / ${String(summary.total)}` },
          ]}
        />
      </Stack>
    </Panel>,
  ]

  if (beforeTheRoad)
    moreSections.push(
      <Panel
        key="stops"
        title={t('d1.stops')}
        meta={t('d.stopsN', { done: summary.done, total: summary.total })}
        testID="d1-stop-list"
      >
        <Group>
          {stops.rows.map((stop) => (
            <ListRow
              key={stop.id}
              testID={`d1-row-${stop.id}`}
              primary={t('home.stopTitle', { n: stop.sequence, shop: shopName(stop) })}
              secondary={addressLine(shops.get(stop.retailer_id)?.address) ?? undefined}
              trailingMoney={stop.planned_collection_paise}
              trailing={<StopChip state={stop.state} />}
              onPress={() => {
                openStop(stop)
              }}
            />
          ))}
        </Group>
      </Panel>,
    )

  moreSections.push(
    <Panel
      key="load"
      /* "Load on board" only once the godown has confirmed a sheet (DOS-061). */
      title={t(loadPanelTitleKey(tripSheets.map((sheet) => sheet.status)))}
      {...(tripSheets.some((sheet) => sheet.confirmed_at !== null)
        ? {
            meta: t('d1.loadConfirmed', {
              when: instantWithClock(
                tripSheets.find((sheet) => sheet.confirmed_at !== null)?.confirmed_at ?? null,
              ),
            }),
          }
        : {})}
      testID="d1-load"
    >
      {tripSheets.length === 0 ? (
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {hydrated ? t('d1.loadNotConfirmed') : t('d.filling')}
        </Txt>
      ) : (
        <Group>
          {tripSheets.map((sheet) => {
            /* Only a confirmed sheet is cartons on board; a cancelled one has no carton line. */
            const packagesKey = loadSheetPackagesKey(sheet.status)
            return (
              <ListRow
                key={sheet.id}
                testID={`d1-sheet-${sheet.id}`}
                primary={sheet.challan_no ?? longDate(sheet.sheet_date)}
                secondary={
                  sheet.expected_packages === null || packagesKey === null
                    ? undefined
                    : pl(t, packagesKey, sheet.expected_packages)
                }
                trailing={
                  <StatusChip
                    label={wordFor(t, sheet.status)}
                    family={sheet.confirmed_at === null ? 'ochre' : 'moss'}
                  />
                }
              />
            )
          })}
        </Group>
      )}
    </Panel>,
    /*
     * The DPDP promise, kept on screen rather than in a settings page (ADR 0012): whether the office
     * can see the vehicle, and what this build actually does on each platform.
     */
    <Panel key="tracking" title={t('d12.consent')} testID="d1-tracking">
      <Stack gap={2}>
        <Row gap={3} wrap align="center">
          <StatusChip
            testID="d1-tracking-state"
            label={tracking?.state === 'on' ? t('d1.tracking') : t('d1.trackingOff')}
            family={tracking?.state === 'on' ? 'moss' : 'neutral'}
          />
          {tracking === null || tracking.buffered === 0 ? null : (
            <StatusChip
              testID="d1-tracking-buffer"
              label={t(keepKey('trackingHeld', status.persistent), {
                count: tracking.buffered,
              })}
              family="ochre"
              figure
            />
          )}
        </Row>
        {tracking?.state === 'denied' ||
        tracking?.state === 'error' ||
        tracking?.state === 'unavailable' ? (
          <Txt field="label" desk="meta" color={colors.text.secondary} testID="d1-tracking-off">
            {t('d1.trackingDenied')}
          </Txt>
        ) : null}
        {tracking === null ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary} testID="d1-tracking-web">
            {tracking.canTrackInBackground ? t('d1.trackingForeground') : t('d1.trackingWeb')}
          </Txt>
        )}
      </Stack>
    </Panel>,
    <Row key="buttons" gap={8} wrap>
      {bool(trip.van_sales_enabled) && road ? (
        <Button
          testID="d1-van-sale"
          label={t('d1.vanSale')}
          variant="secondary"
          onPress={() => {
            const next = cards.find((card) => card.job.kind !== 'finished')
            router.push(go.href(next === undefined ? '/' : `/stop/${next.id}/van-sale`))
          }}
          {...(cards.every((card) => card.job.kind === 'finished')
            ? { disabled: true, disabledReason: t('d3.noBills') }
            : {})}
        />
      ) : null}
      <Button
        testID="d1-expense"
        label={t('d1.addExpense')}
        variant="secondary"
        onPress={() => {
          router.push(go.href('/expenses'))
        }}
      />
      {road && !allDone ? (
        <Button
          testID="d1-end-day"
          label={t('home.endDayNow')}
          variant="secondary"
          onPress={() => {
            router.push(go.href('/day'))
          }}
        />
      ) : null}
    </Row>,
  )

  if (others.length > 0)
    moreSections.push(
      <Panel key="others" title={t('d1.otherTrips')} testID="d1-other-trips">
        <Group>
          {others.map((one) => (
            <ListRow
              key={one.id}
              testID={`d1-other-${one.id}`}
              primary={one.trip_no ?? t('d.trip')}
              secondary={t('d1.plannedFor', { date: longDate(one.trip_date) })}
              trailing={<StatusChip label={wordFor(t, one.state)} family="neutral" />}
              /* A trip that has left opens its stops, never the Start screen (DOS-061). */
              onPress={() => {
                router.push(go.href(tripEntryHref(one)))
              }}
            />
          ))}
        </Group>
      </Panel>,
    )

  const jobs: React.JSX.Element[] = beforeTheRoad
    ? [loadCard]
    : road
      ? [...(allDone ? [allDoneCard] : []), ...cards.map(stopCard)]
      : [checkedInCard, ...cards.map(stopCard)]

  return (
    <Screen
      title={t('d1.title')}
      context={[trip.trip_no ?? t('d.trip'), vehicle?.reg_no ?? null, longDate(trip.trip_date)]
        .filter((part): part is string => part !== null)
        .join(' · ')}
      testID="d1-screen"
    >
      <Stack gap={4}>
        <FillingNote hydrated={hydrated} testID="d1-provisional" />

        <JobList
          testID="d1-jobs"
          summary={
            <Txt field="bodyStrong" desk="body" testID="d1-summary" numeric>
              {summaryLine}
            </Txt>
          }
          loading={stops.loading && stops.rows.length === 0 && !beforeTheRoad}
          emptyMessage={hydrated ? t('d3.noBills') : t('d.filling')}
        >
          {jobs}
        </JobList>

        {/*
          DOS-179 — "{count} writes are still on this phone" is only true of a store that keeps. On a
          browser with no OPFS the strip at the top of THIS screen already reads "· Not kept in this
          browser", so the sentence asks the store like every other keep verb in this app.
        */}
        {status.pending === 0 ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary} testID="d1-pending">
            {t(keepKey('pending', status.persistent), { count: status.pending })}
          </Txt>
        )}

        <MoreGroup
          id="delivery.home.more"
          title={t('home.more')}
          count={moreSections.length}
          testID="d1-more"
        >
          <Stack gap={6}>{moreSections}</Stack>
        </MoreGroup>
      </Stack>

      <DeliverAllDialog
        open={confirmingCard !== null}
        shop={confirmingCard === null ? '' : shopName(confirmingCard.stop)}
        bills={confirmBills}
        online={status.online}
        persistent={status.persistent}
        busy={busy !== null}
        error={confirmError}
        onConfirm={onDeliverAll}
        onClose={() => {
          if (busy === null) setConfirming(null)
        }}
      />

      <MoneySheet
        open={payingCard !== null}
        shop={payingCard === null ? '' : shopName(payingCard.stop)}
        leftPaise={payingCard?.job.leftPaise ?? null}
        online={status.online}
        persistent={status.persistent}
        busy={busy !== null}
        error={moneyError}
        onRecord={onTakeMoney}
        onMoreOptions={() => {
          const card = payingCard
          setPaying(null)
          if (card !== null) router.push(go.href(`/stop/${card.id}/collect`))
        }}
        onClose={() => {
          if (busy === null) setPaying(null)
        }}
      />

      <Toast
        testID="d1-toast"
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={dismissToast}
      />
    </Screen>
  )
}
