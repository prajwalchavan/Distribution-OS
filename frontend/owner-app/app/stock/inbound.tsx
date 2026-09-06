/**
 * O16 — inbound: supplier bills, goods received, purchase orders and the discrepancies they raise
 * (docs/23 §1.1).
 *
 * The four registers are one screen because they are one physical event seen from four sides: the
 * bill the supplier sent, the count the godown made, the order it was against, and what did not
 * agree. Only the last one has an action here — resolving a discrepancy is the owner's call about
 * money, and it is the one write on this screen.
 */
import type { Discrepancy, Grn, PurchaseOrder, SupplierInvoice } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Dialog,
  Money,
  Register,
  Screen,
  Segments,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import { Async, PageTabs, moneyColumn, textColumn, useNames } from '../../src/lib/ui'
import { instantWithClock, longDate } from '../../src/lib/dates'

const STATUS_FAMILY: Readonly<Record<string, StatusFamily>> = {
  extracted: 'ochre',
  in_review: 'ochre',
  approved: 'moss',
  received: 'moss',
  disputed: 'brick',
  cancelled: 'neutral',
  counting: 'ochre',
  reconciled: 'ochre',
  posted: 'moss',
  draft: 'neutral',
  sent: 'ochre',
  partially_received: 'clay',
  open: 'brick',
  claimed: 'ochre',
  credited: 'moss',
  accepted: 'neutral',
  written_off: 'neutral',
}

type View = 'bills' | 'grns' | 'pos' | 'issues'

export default function Inbound(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const names = useNames()
  const [view, setView] = useState<View>('bills')
  const [resolving, setResolving] = useState<Discrepancy | null>(null)
  const [note, setNote] = useState('')

  const suppliers = useQuery(['tenantCatalog', 'suppliers'], () =>
    api.api.tenantCatalog.suppliers(),
  )
  const bills = useQuery(['procurement', 'supplierInvoices'], () =>
    api.api.procurement.supplierInvoices.list({ limit: 100 }),
  )
  const grns = useQuery(['procurement', 'grns'], () =>
    api.api.procurement.grns.list({ limit: 100 }),
  )
  const pos = useQuery(['procurement', 'purchaseOrders'], () =>
    api.api.procurement.purchaseOrders.list({ limit: 100 }),
  )
  const issues = useQuery(['procurement', 'discrepancies'], () =>
    api.api.procurement.discrepancies.list({ limit: 200 }),
  )

  const resolve = useMutation(
    (input: { id: string; note: string }, meta) =>
      api.api.procurement.discrepancies.resolve({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
        status: 'accepted',
        ...(input.note === '' ? {} : { note: input.note }),
      }),
    { invalidates: [['procurement']] },
  )

  const supplierName = (id: string): string =>
    suppliers.data?.items.find((s) => s.id === id)?.name ?? id.slice(0, 8)

  const chip = (value: string): React.JSX.Element => (
    <StatusChip label={value} family={STATUS_FAMILY[value] ?? 'neutral'} />
  )

  const billColumns: readonly RegisterColumn<SupplierInvoice>[] = [
    textColumn('no', t('o16.invoiceNo'), (row) => row.invoiceNo, { priority: 'identity' }),
    textColumn('date', t('o13.date'), (row) => longDate(row.invoiceDate)),
    textColumn('supplier', t('o16.supplier'), (row) => supplierName(row.supplierId)),
    moneyColumn('total', t('o16.total'), (row) => row.totalPaise),
    { key: 'status', head: t('o16.status'), priority: 'chip', cell: (row) => chip(row.status) },
  ]

  const grnColumns: readonly RegisterColumn<Grn>[] = [
    textColumn('no', t('o16.grnNo'), (row) => row.grnNo, { priority: 'identity' }),
    textColumn('when', t('o12.date'), (row) => instantWithClock(row.createdAt)),
    { key: 'status', head: t('o16.status'), priority: 'chip', cell: (row) => chip(row.status) },
    textColumn('posted', t('o16.expected'), (row) => instantWithClock(row.postedAt)),
  ]

  const poColumns: readonly RegisterColumn<PurchaseOrder>[] = [
    textColumn('no', t('o16.poNo'), (row) => row.poNo, { priority: 'identity' }),
    textColumn('supplier', t('o16.supplier'), (row) => supplierName(row.supplierId)),
    textColumn('expected', t('o16.expected'), (row) => longDate(row.expectedOn)),
    moneyColumn('total', t('o16.total'), (row) => row.totalPaise),
    { key: 'status', head: t('o16.status'), priority: 'chip', cell: (row) => chip(row.status) },
  ]

  const issueColumns: readonly RegisterColumn<Discrepancy>[] = [
    textColumn('kind', t('o16.kind'), (row) => row.kind, { priority: 'identity' }),
    {
      key: 'qty',
      head: t('o16.qty'),
      align: 'right',
      priority: 'value',
      cell: (row) => (
        <Txt field="body" desk="cell" numeric>
          {row.qtyPcs}
        </Txt>
      ),
    },
    textColumn('note', t('o3.note'), (row) => row.note),
    { key: 'status', head: t('o16.status'), priority: 'chip', cell: (row) => chip(row.status) },
    textColumn('when', t('o12.date'), (row) => instantWithClock(row.createdAt)),
  ]

  return (
    <Screen
      title={t('o16.title')}
      chips={<PageTabs group="/stock" active="/stock/inbound" />}
      actions={
        <Segments
          size="desk"
          value={view}
          onChange={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'bills', label: t('o16.supplierInvoices') },
            { id: 'grns', label: t('o16.grns') },
            { id: 'pos', label: t('o16.pos') },
            { id: 'issues', label: t('o16.discrepancies') },
          ]}
          testID="inbound-view"
        />
      }
    >
      <Stack gap={4}>
        {view === 'bills' ? (
          <Async
            state={[bills]}
            rows={10}
            empty={(bills.data?.items.length ?? 0) === 0}
            emptyMessage={t('o16.empty')}
          >
            <Register
              testID="supplier-invoices"
              columns={billColumns}
              rows={bills.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="no"
              state="ready"
              totals={{
                no: t('word.total'),
                total: (
                  <Money
                    value={(bills.data?.items ?? []).reduce((s, r) => s + r.totalPaise, 0)}
                    size="cell"
                    symbol={false}
                  />
                ),
              }}
            />
          </Async>
        ) : null}

        {view === 'grns' ? (
          <Async state={[grns]} rows={10} empty={(grns.data?.items.length ?? 0) === 0}>
            <Register
              testID="grns"
              columns={grnColumns}
              rows={grns.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="no"
              state="ready"
            />
          </Async>
        ) : null}

        {view === 'pos' ? (
          <Async state={[pos]} rows={10} empty={(pos.data?.items.length ?? 0) === 0}>
            <Register
              testID="purchase-orders"
              columns={poColumns}
              rows={pos.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="no"
              state="ready"
            />
          </Async>
        ) : null}

        {view === 'issues' ? (
          <Async state={[issues]} rows={10} empty={(issues.data?.items.length ?? 0) === 0}>
            <Register
              testID="discrepancies"
              columns={issueColumns}
              rows={issues.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="kind"
              onSelect={(row) => {
                if (row.status === 'open') setResolving(row)
              }}
              state="ready"
            />
          </Async>
        ) : null}
      </Stack>

      <Dialog
        open={resolving !== null}
        onClose={() => {
          setResolving(null)
        }}
        title={t('o16.resolve')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {resolving?.note ?? resolving?.kind ?? ''}
            </Txt>
            <TextInput
              label={t('o16.resolution')}
              value={note}
              onChange={setNote}
              capitalize="sentences"
            />
          </Stack>
        }
        confirmLabel={t('o16.resolve')}
        busy={resolve.status === 'pending'}
        onConfirm={() => {
          if (resolving === null) return
          void resolve.mutateAsync({ id: resolving.id, note: note.trim() }).then(
            () => {
              setResolving(null)
              setNote('')
            },
            () => {
              /* the error stays on the mutation */
            },
          )
        }}
        testID="discrepancy-dialog"
      />
      <Txt field="label" desk="meta">
        {names.loading ? t('state.loading') : ''}
      </Txt>
    </Screen>
  )
}
