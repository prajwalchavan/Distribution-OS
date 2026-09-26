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
  Chips,
  Screen,
  Search,
  Sheet,
  Sparkline,
  Stack,
  StatusChip,
  Toast,
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
} from '../../../src/groups/owner/lib/ui'
import { instantWithClock, longDate, today, shiftDays } from '../../../src/groups/owner/lib/dates'
import { useHotkeys, useRegisterKeys } from '../../../src/groups/owner/lib/keys'
import { useWord } from '../../../src/groups/owner/lib/words'
import { CreditDialog, useMayWrite } from '../../../src/pricing/editors'

export default function Shops(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const names = useNames()
  const params = useLocalSearchParams<{ q?: string }>()

  const [q, setQ] = useState(typeof params.q === 'string' ? params.q : '')
  const [beatId, setBeatId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'credit' | 'statement' | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const may = useMayWrite()

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

  /*
   * DOS-212: the credit dialog is `src/pricing/editors.tsx` — limit, days, what happens over the limit
   * and the payment terms, in one `retailers.setCredit`, opened on the shop's current values. It used to
   * offer the limit and the days only and pass `creditMode: current.creditMode` straight back, so every
   * shop opened in the app stayed "Warn only" and "Credit" for good; and it closed on a refusal too.
   */
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
    textColumn('terms', t('o6.terms'), (row) => word(row.paymentTerms)),
    {
      /* DOS-212: what happens over the limit, as a chip that follows a change made in the panel. */
      key: 'mode',
      head: t('o6.creditMode'),
      cell: (row) => (
        <StatusChip
          label={word(row.creditMode)}
          family={
            row.creditMode === 'stop' ? 'brick' : row.creditMode === 'strict' ? 'ochre' : 'neutral'
          }
        />
      ),
    },
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
          placeholder={t('app.filterShops')}
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
                  {/*
                    DOS-093: `reporting.retailers.behaviour` is a 404 until the nightly rollup has
                    seen the shop, so a shop added this morning had no `data` — and `?? 0` printed
                    "0 days to pay", which reads as a shop that settles the same day. `lastOrder`
                    above already prints an em dash for exactly this; now so does the figure beside
                    it. No new string key: this file already writes `'—'` inline.
                  */}
                  <Field label={t('o6.avgDaysToPay')}>
                    {behaviour.data === undefined ? '—' : String(behaviour.data.item.avgDaysToPay)}
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
                  <Field label={t('o6.creditMode')}>{word(current.creditMode)}</Field>
                  <Field label={t('px.terms')}>{word(current.paymentTerms)}</Field>
                </Stack>
              </Panel>

              {may('retailers.setCredit') ? (
                <Button
                  label={t('o6.setCredit')}
                  variant="primary"
                  onPress={() => {
                    setDialog('credit')
                  }}
                  testID="shop-set-credit"
                />
              ) : null}
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

      <CreditDialog
        shop={current}
        open={dialog === 'credit'}
        onClose={() => {
          setDialog(null)
        }}
        onSaved={setToast}
      />

      <Dialog
        open={dialog === 'statement'}
        onClose={() => {
          setDialog(null)
        }}
        title={t('o6.statement')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {current?.name ?? ''}
            </Txt>
            <Txt field="label" desk="meta">
              {longDate(today())}
            </Txt>
          </Stack>
        }
        confirmLabel={t('o6.statement')}
        busy={statement.status === 'pending'}
        onConfirm={() => {
          if (current === null) return
          const done = (): void => {
            setDialog(null)
          }
          void statement.mutateAsync(current.id).then(
            () => {
              done()
              setToast(t('o6.statementSent'))
            },
            (error: unknown) => {
              done()
              setToast(error instanceof Error ? error.message : t('app.retry'))
            },
          )
        }}
        testID="shop-dialog"
      />

      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="shop-toast"
      />
    </Screen>
  )
}
