/**
 * O10 — money owed: the outstanding register, the ageing ladder and the ageing history (docs/23 §1.1).
 *
 * The ladder and the register are the same figures at two zooms, and the six rungs are the ONE ordered
 * ladder of docs/22 §6 — 0–7, 8–15, 16–30, 31–60, 61–90, 90+ — so a rung is also a filter: press it
 * and the register below is the shops in that bucket. Every action here is the money desk's: send a
 * statement, write a debt off (owner only), rebuild the ageing after a correction.
 */
import type { OutstandingListItem } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  AgeingBuckets,
  Button,
  Chips,
  Dialog,
  ListRow,
  Money,
  Register,
  RupeeInput,
  Sheet,
  Screen,
  Stack,
  StatusChip,
  TextInput,
  TrendChart,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
  type Series,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  Columns,
  ExportButton,
  Field,
  Half,
  PageTabs,
  Panel,
  RangeSegments,
  moneyColumn,
  textColumn,
  useNames,
} from '../../src/lib/ui'
import { rangeOf, shortDate, today, type RangeId } from '../../src/lib/dates'

const BUCKETS = ['b0_7', 'b8_15', 'b16_30', 'b31_60', 'b61_90', 'b90plus'] as const
type BucketId = (typeof BUCKETS)[number]
const BUCKET_LABEL: Readonly<Record<BucketId, string>> = {
  b0_7: '0–7',
  b8_15: '8–15',
  b16_30: '16–30',
  b31_60: '31–60',
  b61_90: '61–90',
  b90plus: '90+',
}

export default function OutstandingListItem(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const names = useNames()

  const [bucket, setBucket] = useState<BucketId | null>(null)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [range, setRange] = useState<RangeId>('d90')
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'writeOff' | 'statement' | 'rebuild' | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [billId, setBillId] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const span = rangeOf(range)
  const list = useQuery(
    ['receivables', 'outstanding', bucket ?? 'all', overdueOnly ? 'overdue' : 'all'],
    () =>
      api.api.receivables.outstanding.list({
        limit: 200,
        sort: 'outstanding',
        ...(bucket === null ? {} : { bucket }),
        ...(overdueOnly ? { overdueOnly: true } : {}),
      }),
  )
  const history = useQuery(['receivables', 'ageingHistory', span.from, span.to], () =>
    api.api.receivables.ageing.history({ grain: 'week', from: span.from, to: span.to }),
  )

  const writeOff = useMutation(
    (input: { invoiceId: string; amountPaise: number; note: string }, meta) =>
      api.api.receivables.writeOffs.create({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        invoiceId: input.invoiceId,
        amountPaise: input.amountPaise,
        reason: 'bad_debt',
        ...(input.note === '' ? {} : { note: input.note }),
      }),
    { invalidates: [['receivables'], ['invoices'], ['reporting']] },
  )
  const statements = useMutation(
    (input: { retailerIds: readonly string[] }, meta) =>
      api.api.receivables.statements.send({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        retailerIds: [...input.retailerIds],
        from: span.from,
        to: span.to,
        channel: 'whatsapp',
        includeUpiQr: true,
        overdueOnly: false,
      }),
    { invalidates: [['notifications']] },
  )
  const rebuild = useMutation(
    (_input: null, meta) =>
      api.api.receivables.ageing.rebuild({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        asOf: today(),
      }),
    { invalidates: [['receivables'], ['reporting']] },
  )

  const shop = useQuery(
    ['receivables', 'outstanding', 'get', selected ?? 'none'],
    () =>
      api.api.receivables.outstanding.get({
        retailerId: selected ?? '',
        includeBills: true,
      }),
    { enabled: selected !== null },
  )

  const rows = list.data?.items ?? []
  const totals = list.data?.totals
  const current = rows.find((row) => row.retailerId === selected) ?? null

  const trend: readonly Series[] = [
    {
      id: 'outstanding',
      label: t('o10.dues'),
      role: 'primary',
      points: (history.data?.points ?? []).map((p) => ({
        x: shortDate(p.asOf),
        y: p.outstandingPaise,
      })),
    },
    {
      id: 'overdue',
      label: t('o10.overdue'),
      role: 'secondary',
      points: (history.data?.points ?? []).map((p) => ({
        x: shortDate(p.asOf),
        y: p.overduePaise,
      })),
    },
  ]

  const columns: readonly RegisterColumn<OutstandingListItem>[] = [
    textColumn('code', t('o10.shop'), (row) => `${row.code ?? ''} ${row.name}`.trim(), {
      priority: 'identity',
    }),
    textColumn('beat', t('word.beat'), (row) => names.beat(row.beatId)),
    moneyColumn('dues', t('o10.dues'), (row) => row.outstandingPaise),
    moneyColumn('overdue', t('o10.overdue'), (row) => row.overduePaise, {
      cell: (row) => (
        <Money
          value={row.overduePaise}
          size="cell"
          symbol={false}
          tone={row.overduePaise > 0 ? 'critical' : 'default'}
        />
      ),
    }),
    textColumn('bills', t('o10.bills'), (row) => row.openBills),
    textColumn('oldest', t('o10.oldest'), (row) => shortDate(row.oldestDueDate)),
    {
      key: 'mode',
      head: t('o10.mode'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.creditMode}
          family={row.creditMode === 'stop' ? 'brick' : 'neutral'}
        />
      ),
    },
  ]

  return (
    <Screen
      title={t('o10.title')}
      chips={<PageTabs group="/money" active="/money" />}
      actions={
        <>
          <RangeSegments
            value={range}
            onChange={(id) => {
              setRange(id as RangeId)
            }}
          />
          <ExportButton register="outstanding" filters={{}} testID="money-export" />
          <Button
            label={t('o10.rebuild')}
            variant="ghost"
            loading={rebuild.status === 'pending'}
            onPress={() => {
              setDialog('rebuild')
            }}
            testID="money-rebuild"
          />
        </>
      }
    >
      <Stack gap={6}>
        <Columns>
          <Half>
            <Panel testID="money-ladder">
              <Async state={[list]} rows={6}>
                <AgeingBuckets
                  buckets={{
                    '0-7': totals?.buckets.b0_7 ?? 0,
                    '8-15': totals?.buckets.b8_15 ?? 0,
                    '16-30': totals?.buckets.b16_30 ?? 0,
                    '31-60': totals?.buckets.b31_60 ?? 0,
                    '61-90': totals?.buckets.b61_90 ?? 0,
                    '90+': totals?.buckets.b90plus ?? 0,
                  }}
                />
              </Async>
              <Chips
                testID="money-bucket-filter"
                items={BUCKETS.map((id) => ({
                  id,
                  label: BUCKET_LABEL[id],
                  selected: bucket === id,
                }))}
                onToggle={(id) => {
                  setBucket((cur) => (cur === id ? null : (id as BucketId)))
                }}
                onClear={
                  bucket === null
                    ? undefined
                    : () => {
                        setBucket(null)
                      }
                }
              />
            </Panel>
          </Half>
          <Half>
            <Panel
              title={t('o10.history')}
              meta={t('app.range', { from: shortDate(span.from), to: shortDate(span.to) })}
              testID="money-history"
            >
              <Async state={[history]} rows={4} empty={(history.data?.points.length ?? 0) === 0}>
                <TrendChart series={trend} legend height={180} />
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Panel
          title={t('o10.byShop')}
          meta={totals === undefined ? undefined : t('app.rows', { count: totals.retailers })}
          actions={
            <Button
              label={t('o10.statements')}
              variant="secondary"
              disabled={rows.length === 0}
              disabledReason={t('o10.empty')}
              loading={statements.status === 'pending'}
              onPress={() => {
                setDialog('statement')
              }}
              testID="money-statements"
            />
          }
        >
          <Chips
            items={[{ id: 'overdue', label: t('o10.overdue'), selected: overdueOnly }]}
            onToggle={() => {
              setOverdueOnly((v) => !v)
            }}
          />
          <Async state={[list]} rows={10} empty={rows.length === 0} emptyMessage={t('o10.empty')}>
            <Register
              testID="money-register"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.retailerId}
              frozen="code"
              selectedKey={selected}
              onSelect={(row) => {
                setSelected(row.retailerId)
              }}
              state="ready"
              totals={{
                code: t('word.total'),
                dues: <Money value={totals?.outstandingPaise ?? 0} size="cell" symbol={false} />,
                overdue: <Money value={totals?.overduePaise ?? 0} size="cell" symbol={false} />,
              }}
            />
          </Async>
        </Panel>
      </Stack>

      {/*
        The drill-through UX-00 §9.0 asks for: a shop's row opens its own bills as a side panel over
        this page, and a write-off is taken against ONE bill because that is the only thing the ledger
        can settle. `writeOffs.create` is owner-only by the matrix, so this button exists on this app
        and nowhere else.
      */}
      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
          setBillId(null)
        }}
        title={current?.name}
        testID="money-shop-panel"
      >
        <Async state={[shop]} rows={6}>
          {shop.data === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('o10.dues')}>
                <Money value={shop.data.outstandingPaise} size="moneyM" />
              </Field>
              <Field label={t('o10.overdue')}>
                <Money value={shop.data.overduePaise} size="cell" tone="critical" />
              </Field>
              <Field label={t('o10.oldest')}>{shortDate(shop.data.oldestDueDate)}</Field>
              <Panel title={t('o6.bills')}>
                <Stack gap={2}>
                  {shop.data.bills.map((bill) => (
                    <ListRow
                      key={bill.id}
                      primary={bill.invoiceNo}
                      secondary={shortDate(bill.dueDate)}
                      trailingMoney={bill.openPaise}
                      state={billId === bill.id ? 'selected' : 'default'}
                      onPress={() => {
                        setBillId(bill.id)
                      }}
                    />
                  ))}
                </Stack>
              </Panel>
              <Button
                label={t('o10.writeOff')}
                variant="destructive"
                disabled={billId === null}
                disabledReason={t('o6.bills')}
                onPress={() => {
                  setDialog('writeOff')
                }}
                testID="money-write-off"
              />
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {t('o6.avgDaysToPay')}
              </Txt>
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
          dialog === 'rebuild'
            ? t('o10.rebuild')
            : dialog === 'statement'
              ? t('o10.statements')
              : t('o10.writeOff')
        }
        body={
          <Stack gap={3}>
            {dialog === 'statement' ? (
              <Txt field="body" desk="body">
                {t('app.rows', { count: rows.length })}
              </Txt>
            ) : null}
            {dialog === 'writeOff' ? (
              <>
                <RupeeInput label={t('o10.writeOffAmount')} value={amount} onChange={setAmount} />
                <TextInput
                  label={t('o10.writeOffReason')}
                  value={note}
                  onChange={setNote}
                  capitalize="sentences"
                />
              </>
            ) : null}
            {dialog === 'rebuild' ? (
              <Txt field="body" desk="body">
                {today()}
              </Txt>
            ) : null}
          </Stack>
        }
        confirmLabel={
          dialog === 'rebuild'
            ? t('o10.rebuild')
            : dialog === 'statement'
              ? t('o10.statement')
              : t('o10.writeOff')
        }
        busy={
          rebuild.status === 'pending' ||
          statements.status === 'pending' ||
          writeOff.status === 'pending'
        }
        onConfirm={() => {
          const done = (): void => {
            setDialog(null)
            setNote('')
            setAmount(null)
          }
          if (dialog === 'rebuild') void rebuild.mutateAsync(null).then(done, done)
          if (dialog === 'statement')
            void statements
              .mutateAsync({ retailerIds: rows.slice(0, 200).map((row) => row.retailerId) })
              .then(done, done)
          if (dialog === 'writeOff' && billId !== null && amount !== null && amount > 0)
            void writeOff
              .mutateAsync({ invoiceId: billId, amountPaise: amount, note: note.trim() })
              .then(done, done)
        }}
        testID="money-dialog"
      />
    </Screen>
  )
}
