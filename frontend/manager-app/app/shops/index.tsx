/**
 * M14 — shops and credit, the staff view (docs/23 §2.1).
 *
 * The register is the searchable list; a row opens the shop as a side panel with the four things a
 * back office decides about a shop — what it owes, what its credit terms are, its statement of
 * account, and whether the shopkeeper is linked to the app. `q` arrives in the URL from the header
 * search, so "go to a shop" and this screen's own filter are one query.
 *
 * `retailers.setCredit` and `retailers.linkIdentity` are owner + manager: for the accountant both
 * controls are absent, and the statement — which IS the money desk's job — stays.
 *
 * `linkIdentity` is back-office only for a reason worth restating (docs/17 item 27): a salesperson
 * must never learn whether a phone number already exists in another distributor's network.
 */
import type { Retailer } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Dialog,
  Money,
  Register,
  RupeeInput,
  Screen,
  Search,
  Sparkline,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
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
  useCan,
  useNames,
} from '../../src/lib/ui'
import { longDate, shiftDays, shortInstant, today } from '../../src/lib/dates'
import { useHotkeys, useRegisterKeys } from '../../src/lib/keys'
import { useWord } from '../../src/lib/words'

export default function Shops(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()
  const params = useLocalSearchParams<{ q?: string }>()

  const maySetCredit = can('retailers.setCredit')
  const mayLink = can('retailers.linkIdentity')
  const [q, setQ] = useState(typeof params.q === 'string' ? params.q : '')
  const [beatId, setBeatId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'credit' | 'statement' | 'link' | null>(null)
  const [limitPaise, setLimitPaise] = useState<number | null>(null)
  const [creditDays, setCreditDays] = useState('')
  const [phone, setPhone] = useState('')

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
  const ledger = useQuery(
    ['receivables', 'ledger', selected ?? 'none'],
    () => api.api.receivables.ledger.get({ retailerId: selected ?? '', limit: 30 }),
    { enabled: selected !== null },
  )
  const series = useQuery(
    ['reporting', 'retailerSeries', selected ?? 'none'],
    () => api.api.reporting.retailers.series({ id: selected ?? '', grain: 'week', buckets: 12 }),
    { enabled: selected !== null && can('reporting.retailers.series') },
  )
  const behaviour = useQuery(
    ['reporting', 'behaviour', selected ?? 'none'],
    () => api.api.reporting.retailers.behaviour({ id: selected ?? '' }),
    { enabled: selected !== null && can('reporting.retailers.behaviour') },
  )

  const setCredit = useMutation(
    (
      input: {
        id: string
        tier: Retailer['tier']
        creditLimitPaise: number
        creditDays: number
        creditLimitBills: number
        creditMode: Retailer['creditMode']
      },
      meta,
    ) =>
      api.api.retailers.setCredit({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
        tier: input.tier,
        creditLimitPaise: input.creditLimitPaise,
        creditDays: input.creditDays,
        creditLimitBills: input.creditLimitBills,
        creditMode: input.creditMode,
      }),
    { invalidates: [['retailers'], ['receivables'], ['names']] },
  )
  const statement = useMutation(
    (retailerId: string, meta) =>
      api.api.receivables.statements.send({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        retailerIds: [retailerId],
        /* The statement is a window, and 90 days is what a shopkeeper recognises as "my account". */
        from: shiftDays(today(), -90),
        to: today(),
        channel: 'whatsapp',
        includeUpiQr: true,
      }),
    { invalidates: [['notifications']] },
  )
  const link = useMutation(
    (input: { id: string; phone: string }, meta) =>
      api.api.retailers.linkIdentity({
        id: input.id,
        phone: input.phone,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['retailers']] },
  )

  /*
   * `retailers.list` and `retailers.get` answer the UNION of the staff row (code, tier, the credit
   * block) and a shop's own public row. A manager and an accountant always receive the staff shape;
   * `staffRetailer` narrows rather than casts, so a row that somehow arrived without a code is
   * dropped instead of rendering `undefined` in the register.
   */
  const rows = (list.data?.items ?? [])
    .map((row) => staffRetailer(row))
    .filter((row): row is Retailer => row !== null)
  const current = shop.data === undefined ? null : staffRetailer(shop.data.item)

  const columns: readonly RegisterColumn<Retailer>[] = [
    textColumn('code', t('m14.code'), (row) => row.code, { priority: 'identity' }),
    textColumn('name', t('m14.name'), (row) => row.name),
    textColumn('beat', t('m14.beat'), (row) => names.beat(row.beatId)),
    textColumn('tier', t('m14.tier'), (row) => row.tier),
    textColumn('terms', t('m14.terms'), (row) => word(row.paymentTerms)),
    moneyColumn('limit', t('m14.limit'), (row) => row.creditLimitPaise),
    {
      key: 'mode',
      head: t('m14.creditMode'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={word(row.creditMode)}
          family={row.creditMode === 'stop' ? 'brick' : 'neutral'}
        />
      ),
    },
    textColumn('phone', t('m14.phone'), (row) => row.phone),
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
      title={t('m14.title')}
      actions={
        <Search
          testID="shops-filter"
          value={q}
          onChange={setQ}
          placeholder={t('app.filterShops')}
          state="idle"
        />
      }
    >
      <Stack gap={4}>
        <Chips
          testID="shops-beats"
          items={(beats.data?.items ?? []).map((beat) => ({
            id: beat.id,
            label: beat.name,
            selected: beatId === beat.id,
          }))}
          onToggle={(id) => {
            setBeatId((currentId) => (currentId === id ? null : id))
          }}
        />

        <Async state={[list]} rows={12} empty={rows.length === 0} emptyMessage={t('m14.empty')}>
          <Register
            testID="shops-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="code"
            selectedKey={selected}
            onSelect={(row) => {
              setSelected(row.id)
            }}
            state="ready"
            filters={[
              ...(q === '' ? [] : [{ id: 'q', label: t('app.searchFilter', { query: q }) }]),
              ...(beatId === null ? [] : [{ id: beatId, label: names.beat(beatId) }]),
            ]}
            onClearFilters={() => {
              setQ('')
              setBeatId(null)
            }}
            totals={{ code: t('app.rows', { count: rows.length }) }}
          />
        </Async>
      </Stack>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={current === null ? undefined : t('m14.detail', { shop: current.name })}
        testID="shop-panel"
      >
        <Async state={[shop]} rows={6}>
          {current === null ? null : (
            <Stack gap={4}>
              <Field label={t('m14.code')}>{current.code}</Field>
              <Field label={t('m14.beat')}>{names.beat(current.beatId)}</Field>
              <Field label={t('m14.phone')}>{current.phone ?? t('app.none')}</Field>
              <Field label={t('m14.gstin')}>{current.gstin ?? t('app.none')}</Field>

              <Panel title={t('m14.owes')}>
                <Stack gap={2}>
                  <Money value={dues.data?.outstandingPaise ?? null} size="moneyM" />
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {t('m1.overdue', { amount: String(dues.data?.overduePaise ?? 0) })}
                  </Txt>
                  <Field label={t('m14.oldest')}>{longDate(dues.data?.oldestDueDate)}</Field>
                  {series.data === undefined ? null : (
                    <Sparkline
                      values={series.data.points.map((point) => point.invoicedPaise)}
                      width={180}
                      height={32}
                    />
                  )}
                </Stack>
              </Panel>

              {behaviour.data === undefined ? null : (
                <Panel title={t('m14.behaviour')}>
                  <Stack gap={1}>
                    <Txt field="body" desk="cell">
                      {t('m14.avgDays', { days: behaviour.data.item.avgDaysToPay ?? 0 })}
                    </Txt>
                    <Txt field="label" desk="meta" color={colors.text.secondary}>
                      {t('m14.lastOrderOn', {
                        when: shortInstant(behaviour.data.item.lastOrderAt),
                      })}
                    </Txt>
                  </Stack>
                </Panel>
              )}

              <Panel title={t('m14.ledger')}>
                <Stack gap={2}>
                  {(ledger.data?.items ?? []).slice(0, 12).map((row) => (
                    <Stack
                      key={`${row.kind}-${row.refId}-${row.date}`}
                      gap={1}
                      border="bottom"
                      borderTone="faint"
                      padY={2}
                    >
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {`${word(row.kind)} · ${row.refNo ?? ''}`}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary}>
                        {longDate(row.date)}
                      </Txt>
                      <Money value={row.balancePaise} size="cell" />
                    </Stack>
                  ))}
                </Stack>
              </Panel>

              <Stack gap={3}>
                {maySetCredit ? (
                  <Button
                    label={t('m14.setCredit')}
                    variant="secondary"
                    onPress={() => {
                      setLimitPaise(current.creditLimitPaise)
                      setCreditDays(String(current.creditDays))
                      setDialog('credit')
                    }}
                    testID="shop-credit"
                  />
                ) : null}
                <Button
                  label={t('m14.statement')}
                  variant="secondary"
                  loading={statement.status === 'pending'}
                  onPress={() => {
                    setDialog('statement')
                  }}
                  testID="shop-statement"
                />
                {mayLink ? (
                  <Button
                    label={t('m14.link')}
                    variant="ghost"
                    onPress={() => {
                      setPhone(current.phone ?? '')
                      setDialog('link')
                    }}
                    testID="shop-link"
                  />
                ) : null}
              </Stack>
            </Stack>
          )}
        </Async>
      </Sheet>

      <Dialog
        open={dialog !== null}
        onClose={() => {
          setDialog(null)
        }}
        title={
          dialog === 'credit'
            ? t('m14.creditTitle', { shop: current?.name ?? '' })
            : dialog === 'statement'
              ? t('m14.statement')
              : t('m14.link')
        }
        body={
          <Stack gap={3}>
            {dialog === 'credit' ? (
              <>
                <RupeeInput
                  label={t('m14.creditLimit')}
                  value={limitPaise}
                  onChange={setLimitPaise}
                  testID="credit-limit"
                />
                <TextInput
                  label={t('m14.creditDays')}
                  value={creditDays}
                  onChange={setCreditDays}
                  keyboard="decimal"
                  testID="credit-days"
                />
              </>
            ) : null}
            {dialog === 'statement' ? (
              <Txt field="body" desk="body">
                {t('m14.statementBody')}
              </Txt>
            ) : null}
            {dialog === 'link' ? (
              <>
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {t('m14.linkBody')}
                </Txt>
                <TextInput
                  label={t('m14.linkPhone')}
                  value={phone}
                  onChange={setPhone}
                  keyboard="phone"
                  capitalize="none"
                  testID="link-phone"
                />
              </>
            ) : null}
          </Stack>
        }
        confirmLabel={
          dialog === 'credit'
            ? t('app.save')
            : dialog === 'statement'
              ? t('m14.statement')
              : t('m14.link')
        }
        busy={
          setCredit.status === 'pending' ||
          statement.status === 'pending' ||
          link.status === 'pending'
        }
        onConfirm={() => {
          if (selected === null) return
          const close = (): void => {
            setDialog(null)
          }
          if (dialog === 'credit' && limitPaise !== null && current !== null)
            void setCredit
              .mutateAsync({
                id: selected,
                /* The tier, the bill count and the mode are the shop's own; only the two numbers
                   this dialog actually asks for change. */
                tier: current.tier,
                creditLimitPaise: limitPaise,
                creditDays: Number.parseInt(creditDays, 10) || 0,
                creditLimitBills: current.creditLimitBills,
                creditMode: current.creditMode,
              })
              .then(close, close)
          if (dialog === 'statement') void statement.mutateAsync(selected).then(close, close)
          if (dialog === 'link')
            void link.mutateAsync({ id: selected, phone: phone.trim() }).then(close, close)
        }}
        testID="shop-dialog"
      />
    </Screen>
  )
}
