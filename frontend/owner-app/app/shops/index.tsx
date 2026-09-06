/**
 * O6 — the shops register and the shop record (docs/23 §1.1).
 *
 * The register is the searchable list; a row opens the shop as a side panel with the four things the
 * owner actually decides about a shop — what it owes, what its credit terms are, what it has been
 * buying, and whether it needs a statement. `q` arrives in the URL from the header search, so the
 * header's "go to" and this screen's own search are the same one query.
 */
import type { Retailer } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Money,
  Register,
  RupeeInput,
  Chips,
  Screen,
  Search,
  Sheet,
  Sparkline,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'

import {
  Async,
  Field,
  Panel,
  moneyColumn,
  staffRetailer,
  textColumn,
  useNames,
} from '../../src/lib/ui'
import { instantWithClock, longDate, today, shiftDays } from '../../src/lib/dates'
import { useHotkeys, useRegisterKeys } from '../../src/lib/keys'

export default function Shops(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const names = useNames()
  const params = useLocalSearchParams<{ q?: string }>()

  const [q, setQ] = useState(typeof params.q === 'string' ? params.q : '')
  const [beatId, setBeatId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'credit' | 'statement' | null>(null)
  const [limit, setLimit] = useState<number | null>(null)
  const [days, setDays] = useState('')

  const beats = useQuery(['names', 'beats'], () => api.api.retailers.beats.list({}), {
    staleTime: 300_000,
  })
  const list = useQuery(['retailers', 'list', q, beatId ?? 'all'], () =>
    api.api.retailers.list({
      limit: 300,
      activeOnly: true,
      ...(q === '' ? {} : { q }),
      ...(beatId === null ? {} : { beatId }),
    }),
  )
  const shop = useQuery(
    ['retailers', 'get', selected ?? 'none'],
    () => api.api.retailers.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const dues = useQuery(
    ['receivables', 'outstanding', 'get', selected ?? 'none'],
    () => api.api.receivables.outstanding.get({ retailerId: selected ?? '', includeBills: true }),
    { enabled: selected !== null },
  )
  const series = useQuery(
    ['reporting', 'retailerSeries', selected ?? 'none'],
    () => api.api.reporting.retailers.series({ id: selected ?? '', grain: 'week', buckets: 12 }),
    { enabled: selected !== null },
  )
  const behaviour = useQuery(
    ['reporting', 'behaviour', selected ?? 'none'],
    () => api.api.reporting.retailers.behaviour({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const visits = useQuery(
    ['retailers', 'visits', selected ?? 'none'],
    () => api.api.retailers.visits.list({ retailerId: selected ?? '', limit: 20 }),
    { enabled: selected !== null },
  )

  const setCredit = useMutation(
    (
      input: {
        id: string
        tier: string
        creditLimitPaise: number
        creditDays: number
        creditLimitBills: number
        creditMode: string
      },
      meta,
    ) =>
      api.api.retailers.setCredit({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
        tier: input.tier as 'A',
        creditLimitPaise: input.creditLimitPaise,
        creditDays: input.creditDays,
        creditLimitBills: input.creditLimitBills,
        creditMode: input.creditMode as 'indicate',
      }),
    { invalidates: [['retailers'], ['receivables'], ['names']] },
  )
  const statement = useMutation(
    (retailerId: string, meta) =>
      api.api.receivables.statements.send({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        retailerIds: [retailerId],
        from: shiftDays(today(), -90),
        to: today(),
        channel: 'whatsapp',
        includeUpiQr: true,
        overdueOnly: false,
      }),
    { invalidates: [['notifications']] },
  )

  /*
   * `retailers.list` answers the union of the staff row and a shop's own public row. The owner always
   * receives the staff shape; `staffRetailer` narrows rather than casts, so a row that somehow arrived
   * without a code is dropped instead of rendering `undefined` in the register.
   */
  const rows = (list.data?.items ?? [])
    .map((row) => staffRetailer(row))
    .filter((row): row is Retailer => row !== null)
  /*
   * `retailers.get` answers the union of the staff row and the shop's own public row; the owner always
   * gets the staff one, and narrowing rather than casting is what keeps the credit block honest.
   */
  const current = shop.data === undefined ? null : staffRetailer(shop.data.item)

  const columns: readonly RegisterColumn<Retailer>[] = [
    textColumn('code', t('o6.code'), (row) => row.code, { priority: 'detail' }),
    textColumn('name', t('o6.name'), (row) => row.name, { priority: 'identity' }),
    textColumn('beat', t('o6.beat'), (row) => names.beat(row.beatId)),
    {
      key: 'tier',
      head: t('o6.tier'),
      priority: 'chip',
      cell: (row) => <StatusChip label={row.tier} family="neutral" />,
    },
    moneyColumn('limit', t('o6.limit'), (row) => row.creditLimitPaise),
    textColumn('terms', t('o6.terms'), (row) => row.paymentTerms),
    textColumn('phone', t('o6.phone'), (row) => row.phone),
  ]

  useRegisterKeys({
    rows,
    rowKey: (row) => row.id,
    selected,
    onSelect: (row) => {
      setSelected(row.id)
    },
    enabled: dialog === null,
  })
  useHotkeys({
    Escape: () => {
      if (dialog !== null) setDialog(null)
      else setSelected(null)
    },
  })

  return (
    <Screen
      title={t('o6.title')}
      actions={
        <Txt field="label" desk="meta">
          {t('app.rows', { count: rows.length })}
        </Txt>
      }
    >
      <Stack gap={4}>
        {/* The beats are data, not a fixed list: one chip per beat this distributor actually runs. */}
        <Chips
          testID="shops-beat"
          size="desk"
          items={(beats.data?.items ?? []).map((beat) => ({
            id: beat.id,
            label: beat.name,
            selected: beatId === beat.id,
          }))}
          onToggle={(id) => {
            setBeatId((current) => (current === id ? null : id))
          }}
          onClear={
            beatId === null
              ? undefined
              : () => {
                  setBeatId(null)
                }
          }
        />

        <Search
          testID="shops-search"
          value={q}
          onChange={setQ}
          placeholder={t('app.search')}
          size="desk"
          autoFocus
          state={
            q === ''
              ? 'idle'
              : list.isFetching
                ? 'typing'
                : rows.length === 0
                  ? 'noResults'
                  : 'results'
          }
        />

        <Async state={[list]} rows={12} empty={rows.length === 0} emptyMessage={t('o6.empty')}>
          <Register
            testID="shops-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="name"
            selectedKey={selected}
            onSelect={(row) => {
              setSelected(row.id)
            }}
            state="ready"
            totals={{ name: t('app.rows', { count: rows.length }) }}
          />
        </Async>
      </Stack>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={current?.name}
        testID="shop-panel"
      >
        <Async state={[shop]} rows={8}>
          {current === null ? null : (
            <Stack gap={4}>
              <Field label={t('o6.code')}>{current.code ?? '—'}</Field>
              <Field label={t('o6.phone')}>{current.phone ?? '—'}</Field>
              <Field label={t('o6.beat')}>{names.beat(current.beatId)}</Field>
              <Field label={t('o6.gstin')}>{current.gstin ?? '—'}</Field>

              <Panel title={t('o10.dues')}>
                <Stack gap={2}>
                  <Money value={dues.data?.outstandingPaise ?? null} size="moneyL" />
                  <Field label={t('o10.overdue')}>
                    <Money value={dues.data?.overduePaise ?? null} size="cell" tone="critical" />
                  </Field>
                  <Field label={t('o10.bills')}>{String(dues.data?.openBills ?? 0)}</Field>
                </Stack>
              </Panel>

              <Panel title={t('o6.trend')}>
                <Sparkline
                  values={(series.data?.points ?? []).map((p) => p.invoicedPaise)}
                  width={280}
                  height={40}
                  testID="shop-sparkline"
                />
              </Panel>

              <Panel title={t('o6.behaviour')}>
                <Stack gap={2}>
                  <Field label={t('o6.lastOrder')}>
                    {instantWithClock(behaviour.data?.item.lastOrderAt ?? null)}
                  </Field>
                  <Field label={t('o6.avgDaysToPay')}>
                    {String(behaviour.data?.item.avgDaysToPay ?? 0)}
                  </Field>
                  <Field label={t('o6.visits')}>{String(visits.data?.items.length ?? 0)}</Field>
                </Stack>
              </Panel>

              <Panel title={t('o6.credit')}>
                <Stack gap={2}>
                  <Field label={t('o6.creditLimit')}>
                    <Money value={current.creditLimitPaise} size="cell" />
                  </Field>
                  <Field label={t('o6.creditDays')}>{String(current.creditDays)}</Field>
                  <Field label={t('o6.creditMode')}>{current.creditMode}</Field>
                </Stack>
              </Panel>

              <Button
                label={t('o6.setCredit')}
                variant="primary"
                onPress={() => {
                  setLimit(current.creditLimitPaise)
                  setDays(String(current.creditDays))
                  setDialog('credit')
                }}
                testID="shop-set-credit"
              />
              <Button
                label={t('o6.statement')}
                variant="secondary"
                loading={statement.status === 'pending'}
                onPress={() => {
                  setDialog('statement')
                }}
                testID="shop-statement"
              />
            </Stack>
          )}
        </Async>
      </Sheet>

      <Dialog
        open={dialog !== null}
        onClose={() => {
          setDialog(null)
        }}
        title={dialog === 'credit' ? t('o6.setCredit') : t('o6.statement')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {current?.name ?? ''}
            </Txt>
            {dialog === 'credit' ? (
              <>
                <RupeeInput label={t('o6.creditLimit')} value={limit} onChange={setLimit} />
                <TextInput
                  label={t('o6.creditDays')}
                  value={days}
                  onChange={setDays}
                  keyboard="decimal"
                />
              </>
            ) : (
              <Txt field="label" desk="meta">
                {longDate(today())}
              </Txt>
            )}
          </Stack>
        }
        confirmLabel={dialog === 'credit' ? t('app.save') : t('o6.statement')}
        busy={setCredit.status === 'pending' || statement.status === 'pending'}
        onConfirm={() => {
          if (current === null) return
          const done = (): void => {
            setDialog(null)
          }
          if (dialog === 'credit')
            void setCredit
              .mutateAsync({
                id: current.id,
                tier: current.tier,
                creditLimitPaise: limit ?? 0,
                creditDays: Number.parseInt(days, 10) || 0,
                creditLimitBills: current.creditLimitBills,
                creditMode: current.creditMode,
              })
              .then(done, done)
          else void statement.mutateAsync(current.id).then(done, done)
        }}
        testID="shop-dialog"
      />
    </Screen>
  )
}
