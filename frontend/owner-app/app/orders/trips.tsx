/**
 * O18 — trips, settlements, expenses and doorstep collections (docs/23 §1.1).
 *
 * The owner's question about a trip is always the same three: did the stops happen, did the money come
 * back, and does the count agree. So the register carries the stops and the state, and the side panel
 * is the settlement preview — expected against counted, with the variance named — plus the trip's own
 * collections and expenses.
 */
import type { Trip } from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  Money,
  Register,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  Txt,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  Field,
  PageTabs,
  Panel,
  RangeSegments,
  moneyColumn,
  textColumn,
  useNames,
} from '../../src/lib/ui'
import { longDate, rangeOf, type RangeId } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const TRIP_FAMILY: Readonly<Record<string, StatusFamily>> = {
  planned: 'neutral',
  loading: 'ochre',
  active: 'ochre',
  closing: 'ochre',
  settled: 'moss',
  settled_with_variance: 'clay',
  cancelled: 'neutral',
}

export default function Trips(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const names = useNames()
  const [range, setRange] = useState<RangeId>('d30')
  const [selected, setSelected] = useState<string | null>(null)

  const span = rangeOf(range)
  const trips = useQuery(['delivery', 'trips', span.from, span.to], () =>
    api.api.delivery.trips.list({ from: span.from, to: span.to, limit: 200 }),
  )
  const settlement = useQuery(
    ['delivery', 'settlement', selected ?? 'none'],
    () => api.api.delivery.trips.settlementPreview({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const collections = useQuery(
    ['delivery', 'collections', selected ?? 'none'],
    () => api.api.delivery.collections.list({ tripId: selected ?? '', limit: 100 }),
    { enabled: selected !== null },
  )
  const expenses = useQuery(
    ['delivery', 'expenses', selected ?? 'none'],
    () => api.api.delivery.expenses.list({ tripId: selected ?? '', limit: 100 }),
    { enabled: selected !== null },
  )

  const rows = trips.data?.items ?? []
  const preview = settlement.data

  const columns: readonly RegisterColumn<Trip>[] = [
    textColumn('tripNo', t('o18.tripNo'), (row) => row.tripNo, { priority: 'identity' }),
    textColumn('date', t('o18.date'), (row) => longDate(row.tripDate)),
    textColumn('vehicle', t('o18.vehicle'), (row) => row.vehicleRegNo),
    textColumn('driver', t('o4.driver'), (row) => names.staff(row.driverId)),
    {
      key: 'stops',
      head: t('o18.stops'),
      align: 'right',
      priority: 'value',
      cell: (row) => (
        <Txt field="body" desk="cell" numeric>
          {`${String(row.stopsCompleted)} / ${String(row.plannedStops)}`}
        </Txt>
      ),
    },
    {
      key: 'state',
      head: t('o5.state'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.state)} family={TRIP_FAMILY[row.state] ?? 'neutral'} />
      ),
    },
    moneyColumn('opening', t('o11.amount'), (row) => row.openingCashPaise),
  ]

  return (
    <Screen
      title={t('o18.title')}
      chips={<PageTabs group="/orders" active="/orders/trips" />}
      actions={
        <RangeSegments
          value={range}
          onChange={(id) => {
            setRange(id as RangeId)
          }}
        />
      }
    >
      <Async state={[trips]} rows={10} empty={rows.length === 0} emptyMessage={t('o18.empty')}>
        <Register
          testID="trips-register"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          frozen="tripNo"
          selectedKey={selected}
          onSelect={(row) => {
            setSelected(row.id)
          }}
          state="ready"
        />
      </Async>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={t('o18.preview')}
        testID="trip-panel"
      >
        <Async state={[settlement]} rows={6}>
          {preview === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('o18.collected')}>
                <Money value={preview.cashCollectedPaise} size="moneyM" />
              </Field>
              <Field label={t('o18.expenses')}>
                <Money value={preview.expensesPaise} size="cell" />
              </Field>
              <Field label={t('o18.expected')}>
                <Money value={preview.expectedCashPaise} size="cell" />
              </Field>
              <Field label={t('o18.variance')}>
                <Money
                  value={preview.settlement?.cashVariancePaise ?? null}
                  size="cell"
                  tone={
                    (preview.settlement?.cashVariancePaise ?? 0) === 0 ? 'positive' : 'critical'
                  }
                />
              </Field>
              <Panel title={t('o11.title')}>
                <Txt field="body" desk="cell" numeric>
                  {String(collections.data?.items.length ?? 0)}
                </Txt>
              </Panel>
              <Panel title={t('o18.expenses')}>
                <Txt field="body" desk="cell" numeric>
                  {String(expenses.data?.items.length ?? 0)}
                </Txt>
              </Panel>
            </Stack>
          )}
        </Async>
      </Sheet>
    </Screen>
  )
}
