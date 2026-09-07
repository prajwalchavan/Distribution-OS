/**
 * W1 — Home: the four queues a godown works through (docs/23 §4.1).
 *
 * Bills waiting at the gate, waves on the floor, packs without a bill, sheets waiting for a vehicle.
 * Every row is the whole tap target at this app's 76 dp floor and goes straight to the screen that
 * does the work; nothing here is a figure a picker has to add up.
 *
 * The one graph docs/23 §4.2 allows: a `<Sparkline>` of the fill rate over the last fortnight —
 * pieces picked against pieces ordered, which is the godown's own score and carries no money.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  Group,
  KpiStrip,
  ListRow,
  Screen,
  Sparkline,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useRouter } from 'expo-router'

import { instantWithClock, shiftDays, shortDate, today } from '../src/lib/dates'
import { Async, Panel, PageTabs, atLeast, count, pl, workFamily } from '../src/lib/ui'

export default function Home(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null

  /*
   * `enabled` is not decoration: a deep link opened while signed out mounts this screen for the one
   * frame before the layout's redirect lands, and an unguarded read would spend that frame asking a
   * service for a tenant with no token.
   */
  const grns = useQuery(
    ['grns', 'counting'],
    () => api.api.procurement.grns.list({ status: 'counting', limit: 20 }),
    { enabled: signedIn },
  )
  const picklists = useQuery(
    ['picklists', 'live'],
    () => api.api.warehouse.picklists.list({ status: 'picking', limit: 20 }),
    { enabled: signedIn },
  )
  const openWaves = useQuery(
    ['picklists', 'open'],
    () => api.api.warehouse.picklists.list({ status: 'open', limit: 20 }),
    { enabled: signedIn },
  )
  const packs = useQuery(
    ['packs', 'unbilled'],
    () => api.api.warehouse.packs.list({ invoiced: false, limit: 20 }),
    { enabled: signedIn },
  )
  const sheets = useQuery(
    ['loadSheets', 'draft'],
    () => api.api.warehouse.loadSheets.list({ status: 'draft', limit: 20 }),
    { enabled: signedIn },
  )
  /*
   * `GrnSchema` carries a `locationId` and no name, and a queue of twenty rows that all read the same
   * date is a queue nobody can work: the pilot's own gate list printed "5 Sep · Confirmed on phone
   * with the shopkeeper" twenty times. Names come from `inventory.locations.list` (STAFF), the clock
   * separates the rows, and the seeded note — which is demo noise, not a fact about this receipt —
   * is gone.
   */
  const locations = useQuery(
    ['locations', 'all'],
    () => api.api.inventory.locations.list({ activeOnly: true }),
    { enabled: signedIn },
  )
  const counts = useQuery(
    ['cycleCounts', 'open'],
    () => api.api.inventory.cycleCounts.list({ status: 'open', limit: 20 }),
    { enabled: signedIn },
  )

  /**
   * docs/23 §4.2: the only graph on this app, and it is a count, not a rupee.
   *
   * TWO reads, because they answer two different questions and only one of them is a line.
   * `registers.fillRate` is a row PER VARIANT over the window — it carries the totals the headline
   * needs and it is not a series: plotting its rows put twenty unrelated products on an axis
   * captioned "25 Aug — 7 Sep", and because that register is ordered worst-first the line always
   * sloped upwards and meant nothing. `series.fillRate` is the fortnight, one bucket a day, and
   * `reporting.ts` names it as the warehouse's own read alongside the register.
   */
  const to = today()
  const from = shiftDays(to, -13)
  const fill = useQuery(
    ['fillRate', from, to],
    () => api.api.reporting.registers.fillRate({ from, to }),
    { enabled: signedIn },
  )
  const fillSeries = useQuery(
    ['fillRateSeries', from, to],
    () => api.api.reporting.series.fillRate({ from, to, grain: 'day' }),
    { enabled: signedIn },
  )

  const locationName = (id: string): string =>
    (locations.data?.items ?? []).find((one) => one.id === id)?.name ?? t('w.godown')

  /** Being picked first: a wave on the floor is what someone is standing in front of right now. */
  const waves = [...(picklists.data?.items ?? []), ...(openWaves.data?.items ?? [])]
  /** Two pages added together is still a floor if either of them has more behind it. */
  const wavesCapped =
    (picklists.data?.nextCursor ?? null) !== null || (openWaves.data?.nextCursor ?? null) !== null
  const wavesCount =
    picklists.data === undefined || openWaves.data === undefined
      ? t('w.unknown')
      : wavesCapped
        ? t('w1.atLeast', { count: waves.length })
        : String(waves.length)
  const fillTotals = fill.data?.totals
  const fillPercent =
    fillTotals === undefined ? null : Math.round((fillTotals.fillRate ?? 0) * 1000) / 10
  /** One point per day, in the window the caption states. Ratios 0..1 drawn as whole percent. */
  const spark = (fillSeries.data?.series[0]?.points ?? []).map((point) =>
    Math.round(point.value * 100),
  )

  return (
    <Screen title={t('w1.title')} context={session?.tenant.displayName}>
      <Stack gap={6}>
        <PageTabs group="/" active="/" />

        <KpiStrip
          testID="w1-kpis"
          items={[
            { label: t('w1.grnsToCount'), value: atLeast(t, grns.data) },
            { label: t('w1.wavesOpen'), value: wavesCount },
            { label: t('w1.packsUnbilled'), value: atLeast(t, packs.data) },
            { label: t('w1.sheetsDraft'), value: atLeast(t, sheets.data) },
          ]}
        />

        <Panel
          title={t('w1.gateCounts')}
          meta={
            grns.data === undefined
              ? undefined
              : t(grns.data.items.length === 1 ? 'w.linesN.one' : 'w.linesN', {
                  count: atLeast(t, grns.data),
                })
          }
          testID="w1-grns"
        >
          <Async
            state={grns}
            empty={(grns.data?.items.length ?? 0) === 0}
            emptyMessage={t('w1.gateCountsEmpty')}
          >
            <Group>
              {(grns.data?.items ?? []).map((grn) => (
                <ListRow
                  key={grn.id}
                  testID={`w1-grn-${grn.id}`}
                  primary={
                    grn.grnNo ?? t('w1.receiptAt', { location: locationName(grn.locationId) })
                  }
                  secondary={instantWithClock(grn.createdAt)}
                  trailing={<StatusChip label={grn.status} family={workFamily(grn.status)} />}
                  onPress={() => {
                    router.push(`/inbound/${grn.id}`)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel
          title={t('w1.waves')}
          meta={t('w1.wavesMeta', {
            picking: atLeast(t, picklists.data),
            open: atLeast(t, openWaves.data),
          })}
          testID="w1-waves"
        >
          <Async
            state={[picklists, openWaves]}
            empty={waves.length === 0}
            emptyMessage={t('w1.wavesEmpty')}
          >
            <Group>
              {waves.slice(0, 8).map((sheet) => (
                <ListRow
                  key={sheet.id}
                  testID={`w1-wave-${sheet.id}`}
                  primary={sheet.picklistNo ?? sheet.id.slice(0, 8)}
                  secondary={t('w4.wavePicked', {
                    picked: sheet.pickedQtyPcs,
                    requested: sheet.requestedQtyPcs,
                  })}
                  trailing={<StatusChip label={sheet.status} family={workFamily(sheet.status)} />}
                  onPress={() => {
                    router.push(`/pick/${sheet.id}`)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('w1.packsQueue')} testID="w1-packs">
          <Async
            state={packs}
            empty={(packs.data?.items.length ?? 0) === 0}
            emptyMessage={t('w1.packsEmpty')}
          >
            <Group>
              {(packs.data?.items ?? []).map((pack) => (
                <ListRow
                  key={pack.id}
                  testID={`w1-pack-${pack.id}`}
                  primary={pack.retailerName}
                  secondary={`${pack.orderNo ?? pack.orderId.slice(0, 8)} · ${t('w6.packages')} ${String(pack.packages)}`}
                  trailing={<StatusChip label={t('w6.noBill')} family="ochre" />}
                  onPress={() => {
                    router.push(`/pack/${pack.orderId}`)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('w1.sheets')} testID="w1-sheets">
          <Async
            state={sheets}
            empty={(sheets.data?.items.length ?? 0) === 0}
            emptyMessage={t('w1.sheetsEmpty')}
          >
            <Group>
              {(sheets.data?.items ?? []).slice(0, 8).map((sheet) => (
                <ListRow
                  key={sheet.id}
                  testID={`w1-sheet-${sheet.id}`}
                  primary={`${sheet.vehicleRegNo ?? t('w.vehicle')} · ${shortDate(sheet.sheetDate)}`}
                  secondary={`${pl(t, 'w.ordersN', sheet.orderCount)} · ${pl(
                    t,
                    'w.cartonsN',
                    sheet.expectedPackages,
                  )}`}
                  trailing={
                    /* The same rule /load draws, so one sheet never wears two labels. */
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
                  onPress={() => {
                    router.push(`/load/${sheet.id}`)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('w1.cycleCounts')} testID="w1-counts">
          <Async
            state={counts}
            empty={(counts.data?.items.length ?? 0) === 0}
            emptyMessage={t('w8c.countsEmpty')}
          >
            <Group>
              {(counts.data?.items ?? []).slice(0, 5).map((count) => (
                <ListRow
                  key={count.id}
                  testID={`w1-count-${count.id}`}
                  primary={count.note ?? shortDate(count.createdAt.slice(0, 10))}
                  secondary={pl(t, 'w.lotsN', count.lineCount)}
                  trailing={<StatusChip label={count.status} family={workFamily(count.status)} />}
                  onPress={() => {
                    router.push(`/stock/counts/${count.id}`)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel
          title={t('w1.fillRate')}
          meta={t('chart.range', { from: shortDate(from), to: shortDate(to) })}
          testID="w1-fill"
        >
          <Async
            state={[fill, fillSeries]}
            rows={2}
            empty={spark.length === 0}
            emptyMessage={t('chart.noData')}
          >
            <Stack gap={2}>
              <Txt field="moneyL" desk="cellMoney" numeric>
                {t('w1.fillRateValue', { percent: fillPercent ?? 0 })}
              </Txt>
              {/*
               * Sized deliberately. UX-00 §6's "40 x 16 dp" describes the sparkline where it
               * belongs — inside a strip column or a retailer row — and this is the one place the
               * godown has a chart of its own: fourteen daily points across 40 px is 3 px a day, a
               * squiggle under a headline. `width`/`height` are on the component contract for
               * exactly this. Still one stroke and no axes; the range is printed above it.
               */}
              <Sparkline testID="w1-fill-spark" values={spark} width={320} height={64} />
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {t('w5.progress', {
                  picked: count(fillTotals?.pickedPcs ?? 0),
                  total: count(fillTotals?.orderedPcs ?? 0),
                })}
              </Txt>
            </Stack>
          </Async>
        </Panel>
      </Stack>
    </Screen>
  )
}
