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
  Row,
  Screen,
  Search,
  Sparkline,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Toast,
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
  Refusal,
  moneyColumn,
  staffRetailer,
  stayOpen,
  textColumn,
  useCan,
  useNames,
} from '../../../src/groups/manager/lib/ui'
import { longDate, shiftDays, shortInstant, today } from '../../../src/groups/manager/lib/dates'
import {
  SHOP_COLUMNS,
  overdueAmount,
  statementRows,
  type ShopColumnKey,
  type ShopColumnSpec,
} from '../../../src/groups/manager/lib/shops'
import { useHotkeys, useRegisterKeys } from '../../../src/groups/manager/lib/keys'
import { useWord } from '../../../src/groups/manager/lib/words'
import { CreditDialog } from '../../../src/pricing/editors'

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
  const [phone, setPhone] = useState('')
  const [toast, setToast] = useState<string | null>(null)

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
  /*
   * The statement window is the SAME ninety days "Send the statement" queues below, so the panel and
   * the message the shopkeeper receives cover one period, and the opening row can say which day the
   * balance is carried from.
   */
  const statementFrom = shiftDays(today(), -90)
  const ledger = useQuery(
    ['receivables', 'ledger', selected ?? 'none', statementFrom],
    () =>
      api.api.receivables.ledger.get({
        retailerId: selected ?? '',
        from: statementFrom,
        to: today(),
        limit: 30,
      }),
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

  /*
   * DOS-212: "Change the credit terms" is `src/pricing/editors.tsx`'s CreditDialog, the owner's own —
   * limit, days to pay, what happens over the limit and the payment terms in one `retailers.setCredit`.
   * It used to ask for the two numbers only and pass the shop's mode straight back.
   */
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

  /*
   * The column set — which columns, in what order, and which of them a phone keeps — is
   * `SHOP_COLUMNS` in `src/lib/shops.ts`, where a vitest reads it (DOS-038). Here each key gets its
   * head and its cell.
   */
  const cellOf: Readonly<
    Record<ShopColumnKey, (at: Pick<ShopColumnSpec, 'priority'>) => RegisterColumn<Retailer>>
  > = {
    code: (at) => textColumn('code', t('m14.code'), (row) => row.code, at),
    name: (at) => textColumn('name', t('m14.name'), (row) => row.name, at),
    beat: (at) => textColumn('beat', t('m14.beat'), (row) => names.beat(row.beatId), at),
    tier: (at) => textColumn('tier', t('m14.tier'), (row) => row.tier, at),
    terms: (at) => textColumn('terms', t('m14.terms'), (row) => word(row.paymentTerms), at),
    limit: (at) => moneyColumn('limit', t('m14.limit'), (row) => row.creditLimitPaise, at),
    mode: (at) => ({
      key: 'mode',
      head: t('m14.creditMode'),
      priority: at.priority,
      cell: (row) => (
        <StatusChip
          label={word(row.creditMode)}
          family={
            row.creditMode === 'stop' ? 'brick' : row.creditMode === 'strict' ? 'ochre' : 'neutral'
          }
        />
      ),
    }),
    phone: (at) => textColumn('phone', t('m14.phone'), (row) => row.phone, at),
  }
  const columns: readonly RegisterColumn<Retailer>[] = SHOP_COLUMNS.map((spec) =>
    cellOf[spec.key]({ priority: spec.priority }),
  )

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
              {/* The credit limit is a desk column and a panel field: a phone row keeps the name. */}
              <Field label={t('m14.limit')}>
                <Money value={current.creditLimitPaise} size="cell" symbol={false} />
              </Field>
              <Field label={t('px.creditDays')}>{String(current.creditDays)}</Field>
              <Field label={t('m14.creditMode')}>{word(current.creditMode)}</Field>
              <Field label={t('px.terms')}>{word(current.paymentTerms)}</Field>
              <Field label={t('m14.phone')}>{current.phone ?? t('app.none')}</Field>
              <Field label={t('m14.gstin')}>{current.gstin ?? t('app.none')}</Field>

              <Panel title={t('m14.owes')}>
                <Stack gap={2}>
                  <Money value={dues.data?.outstandingPaise ?? null} size="moneyM" />
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {t('m1.overdue', { amount: overdueAmount(dues.data?.overduePaise) })}
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

              {/*
                Three figures per row, under one head: what the document added, what it took off, and
                the balance it left. Without them the single balance column read as the document's own
                amount (DOS-036).
              */}
              <Panel title={t('m14.ledger')}>
                <Stack gap={2}>
                  <Row gap={3} border="bottom" borderTone="hairline" padY={1}>
                    {[t('m14.debit'), t('m14.credit'), t('m14.balance')].map((head) => (
                      <Stack key={head} grow align="end">
                        <Txt field="label" desk="meta" color={colors.text.secondary}>
                          {head}
                        </Txt>
                      </Stack>
                    ))}
                  </Row>
                  {statementRows(ledger.data ?? { openingPaise: 0, items: [] }, {
                    from: statementFrom,
                    limit: 12,
                  }).map((row) => (
                    <Stack key={row.key} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {row.refNo === null ? word(row.kind) : `${word(row.kind)} · ${row.refNo}`}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary}>
                        {longDate(row.date)}
                      </Txt>
                      <Row gap={3}>
                        <Stack grow align="end">
                          <Money value={row.debitPaise} size="cell" symbol={false} />
                        </Stack>
                        <Stack grow align="end">
                          <Money value={row.creditPaise} size="cell" symbol={false} />
                        </Stack>
                        <Stack grow align="end">
                          <Money value={row.balancePaise} size="cell" symbol={false} />
                        </Stack>
                      </Row>
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

      <CreditDialog
        shop={current}
        open={dialog === 'credit'}
        onClose={() => {
          setDialog(null)
        }}
        onSaved={setToast}
      />

      <Dialog
        open={dialog === 'statement' || dialog === 'link'}
        onClose={() => {
          setDialog(null)
        }}
        title={dialog === 'statement' ? t('m14.statement') : t('m14.link')}
        body={
          <Stack gap={3}>
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
            <Refusal of={[statement, link]} testID="shop-refusal" />
          </Stack>
        }
        confirmLabel={dialog === 'statement' ? t('m14.statement') : t('m14.link')}
        busy={statement.status === 'pending' || link.status === 'pending'}
        onConfirm={() => {
          if (selected === null) return
          const close = (): void => {
            setDialog(null)
          }
          if (dialog === 'statement') void statement.mutateAsync(selected).then(close, stayOpen)
          if (dialog === 'link')
            void link.mutateAsync({ id: selected, phone: phone.trim() }).then(close, stayOpen)
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
