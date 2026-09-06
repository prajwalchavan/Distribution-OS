/**
 * M4 — supplier bills, goods receipts, findings and purchase orders (docs/23 §2.1).
 *
 * This is the desk half of "stock in" (docs/22 §5). The four registers are one screen because they
 * are one chain and the desk reads them in order:
 *
 *   a supplier BILL is approved  →  a goods RECEIPT is opened against it (expected pieces, no rates)
 *   →  the gate counts it blind (the phone tab)  →  posting the receipt writes the lots, the stock
 *   ledger and the purchase cost  →  whatever did not match becomes a FINDING to decide.
 *
 * A PURCHASE ORDER sits before all of it and is here because it is the same supplier conversation.
 *
 * Two things this screen refuses to do. It never posts a receipt that has not been counted — the
 * button says why. And it shows the expected pieces on a receipt only AFTER the count exists,
 * because the gate count is blind by design and this screen is one tap from that gate.
 */
import type { Discrepancy, Grn, PurchaseOrder, SupplierInvoice } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Money,
  Register,
  Screen,
  Chips,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
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
  countText,
  moneyColumn,
  pageTotal,
  pagedCount,
  textColumn,
  useCan,
  useNames,
} from '../../src/lib/ui'
import { longDate, shortInstant } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const BILL_FAMILY: Readonly<Record<string, StatusFamily>> = {
  draft: 'neutral',
  approved: 'ochre',
  received: 'moss',
  disputed: 'clay',
  cancelled: 'neutral',
}

const GRN_FAMILY: Readonly<Record<string, StatusFamily>> = {
  counting: 'ochre',
  reconciled: 'ochre',
  posted: 'moss',
  cancelled: 'neutral',
}

const FINDING_FAMILY: Readonly<Record<string, StatusFamily>> = {
  open: 'clay',
  accepted: 'moss',
  claimed: 'ochre',
  credited: 'moss',
  written_off: 'neutral',
}

type View = 'bills' | 'receipts' | 'findings' | 'orders'

/** How a gate-count finding ends, exactly as `discrepancies.resolve` accepts it. */
type Outcome = 'accepted' | 'claimed' | 'credited' | 'written_off'

const OUTCOMES: readonly { id: Outcome; labelKey: string }[] = [
  { id: 'accepted', labelKey: 'm4.resolveAccepted' },
  { id: 'claimed', labelKey: 'm4.resolveClaimed' },
  { id: 'credited', labelKey: 'm4.resolveCredited' },
  { id: 'written_off', labelKey: 'm4.resolveWrittenOff' },
]

/** The four registers of M4, in the order the goods move: bill in → counted in → argued → ordered. */
const VIEWS: readonly { id: View; labelKey: string }[] = [
  { id: 'bills', labelKey: 'm4.bills' },
  { id: 'receipts', labelKey: 'm4.receipts' },
  { id: 'findings', labelKey: 'm4.findings' },
  { id: 'orders', labelKey: 'm4.orders' },
]

export default function Inbound(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const mayWrite = can('procurement.grns.open')
  const mayResolve = can('procurement.discrepancies.resolve')
  const [view, setView] = useState<View>('bills')
  const [selected, setSelected] = useState<string | null>(null)
  const [grnId, setGrnId] = useState<string | null>(null)
  const [findingId, setFindingId] = useState<string | null>(null)
  const [acting, setActing] = useState<'openGrn' | 'post' | 'dispute' | 'resolve' | null>(null)
  const [note, setNote] = useState('')
  const [outcome, setOutcome] = useState<Outcome>('accepted')

  const bills = useQuery(['procurement', 'supplierInvoices'], () =>
    api.api.procurement.supplierInvoices.list({ limit: 200 }),
  )
  const receipts = useQuery(['procurement', 'grns'], () =>
    api.api.procurement.grns.list({ limit: 200 }),
  )
  const findings = useQuery(['procurement', 'discrepancies'], () =>
    api.api.procurement.discrepancies.list({ limit: 200 }),
  )
  const orders = useQuery(['procurement', 'purchaseOrders'], () =>
    api.api.procurement.purchaseOrders.list({ limit: 200 }),
  )
  const locations = useQuery(['inventory', 'locations'], () => api.api.inventory.locations.list({}))

  const billDetail = useQuery(
    ['procurement', 'supplierInvoices', 'get', selected ?? 'none'],
    () => api.api.procurement.supplierInvoices.get({ id: selected ?? '' }),
    { enabled: selected !== null && view === 'bills' },
  )
  const grnDetail = useQuery(
    ['procurement', 'grns', 'get', grnId ?? 'none'],
    () => api.api.procurement.grns.get({ id: grnId ?? '' }),
    { enabled: grnId !== null },
  )
  const bill = billDetail.data?.item
  const grn = grnDetail.data?.item

  const openGrn = useMutation(
    (input: { supplierInvoiceId: string; locationId: string }, meta) =>
      api.api.procurement.grns.open({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        supplierInvoiceId: input.supplierInvoiceId,
        locationId: input.locationId,
      }),
    { invalidates: [['procurement']] },
  )
  const postGrn = useMutation(
    (id: string, meta) =>
      api.api.procurement.grns.post({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['procurement'], ['inventory'], ['tenantCatalog']] },
  )
  const dispute = useMutation(
    (input: { id: string; reason: string }, meta) =>
      api.api.procurement.supplierInvoices.dispute({
        id: input.id,
        reason: input.reason,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['procurement']] },
  )
  const resolve = useMutation(
    (
      input: {
        id: string
        status: 'accepted' | 'claimed' | 'credited' | 'written_off'
        note: string
      },
      meta,
    ) =>
      api.api.procurement.discrepancies.resolve({
        id: input.id,
        status: input.status,
        ...(input.note === '' ? {} : { note: input.note }),
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['procurement'], ['claims']] },
  )

  const billColumns: readonly RegisterColumn<SupplierInvoice>[] = [
    textColumn('no', t('m4.invoiceNo'), (row) => row.invoiceNo, { priority: 'identity' }),
    textColumn('supplier', t('m4.supplier'), (row) => names.supplier(row.supplierId)),
    textColumn('date', t('m4.invoiceDate'), (row) => longDate(row.invoiceDate)),
    moneyColumn('total', t('m4.value'), (row) => row.totalPaise),
    {
      key: 'status',
      head: t('m4.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.status)} family={BILL_FAMILY[row.status] ?? 'neutral'} />
      ),
    },
    textColumn('source', t('m11.source'), (row) => word(row.source)),
  ]

  const grnColumns: readonly RegisterColumn<Grn>[] = [
    textColumn('no', t('m4.grnNo'), (row) => row.grnNo, { priority: 'identity' }),
    textColumn('location', t('m4.location'), (row) => names.location(row.locationId)),
    {
      key: 'status',
      head: t('m4.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.status)} family={GRN_FAMILY[row.status] ?? 'neutral'} />
      ),
    },
    textColumn('counted', t('m4.counted'), (row) => shortInstant(row.countedAt)),
    textColumn('posted', t('m4.posted'), (row) => shortInstant(row.postedAt)),
  ]

  const findingColumns: readonly RegisterColumn<Discrepancy>[] = [
    {
      key: 'kind',
      head: t('m4.kind'),
      priority: 'identity',
      cell: (row) => <StatusChip label={word(row.kind)} family="clay" />,
    },
    textColumn('qty', t('m4.qty'), (row) => row.qtyPcs, { align: 'right', priority: 'value' }),
    {
      key: 'status',
      head: t('m4.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.status)} family={FINDING_FAMILY[row.status] ?? 'neutral'} />
      ),
    },
    textColumn('note', t('app.note'), (row) => row.note),
    textColumn('when', t('m12.date'), (row) => shortInstant(row.createdAt)),
  ]

  const poColumns: readonly RegisterColumn<PurchaseOrder>[] = [
    textColumn('no', t('m4.poNo'), (row) => row.poNo, { priority: 'identity' }),
    textColumn('supplier', t('m4.supplier'), (row) => names.supplier(row.supplierId)),
    {
      key: 'status',
      head: t('m4.status'),
      priority: 'chip',
      cell: (row) => <StatusChip label={word(row.status)} family="neutral" />,
    },
    textColumn('expected', t('m4.expectedOn'), (row) => longDate(row.expectedOn)),
    moneyColumn('total', t('m4.value'), (row) => row.totalPaise),
  ]

  /**
   * The place the receipt is opened at. The location kinds are `warehouse | vehicle | damaged |
   * in_transit | customer` — a goods receipt is counted into the WAREHOUSE, never onto a van.
   */
  const godown = (locations.data?.items ?? []).find((row) => row.kind === 'warehouse')

  const commit = (): void => {
    const done = (): void => {
      setActing(null)
      setNote('')
    }
    if (acting === 'openGrn' && selected !== null && godown !== undefined)
      void openGrn
        .mutateAsync({ supplierInvoiceId: selected, locationId: godown.id })
        .then(done, done)
    if (acting === 'post' && grnId !== null) void postGrn.mutateAsync(grnId).then(done, done)
    if (acting === 'dispute' && selected !== null)
      void dispute.mutateAsync({ id: selected, reason: note.trim() }).then(done, done)
    if (acting === 'resolve' && findingId !== null)
      void resolve.mutateAsync({ id: findingId, status: outcome, note: note.trim() }).then(() => {
        setFindingId(null)
        done()
      }, done)
  }

  const counted = (grn?.lines ?? []).filter((line) => line.countedQtyPcs !== null).length

  return (
    <Screen title={t('m4.title')} chips={<PageTabs group="/inbound" active="/inbound" />}>
      {/*
       * FOUR views, so a CHIP ROW and not a segmented control.
       *
       * `<Segments>` is 2–3 options by UX-00 §6.10 and the kit enforces it with `items.slice(0, 3)`
       * — silently. This screen passed four, so "Purchase orders" was dropped on the floor: the
       * register behind it (`procurement.purchaseOrders.list`, an M4 requirement of docs/23 §2.1)
       * was fully built, fetched on every load, and could not be opened by any means. The registers
       * screen already carries eight books on a chip row; this is the same control, single-select.
       */}
      <Chips
        testID="inbound-view"
        items={VIEWS.map((entry) => ({
          id: entry.id,
          label: t(entry.labelKey),
          selected: view === entry.id,
        }))}
        onToggle={(id) => {
          setView(id as View)
          setSelected(null)
        }}
      />

      {view === 'bills' ? (
        <Async
          state={[bills]}
          rows={10}
          empty={(bills.data?.items.length ?? 0) === 0}
          emptyMessage={t('m4.empty')}
        >
          <Register
            testID="bills-register"
            columns={billColumns}
            rows={bills.data?.items ?? []}
            rowKey={(row) => row.id}
            frozen="no"
            selectedKey={selected}
            onSelect={(row) => {
              setSelected(row.id)
            }}
            state="ready"
            totals={{
              no: countText(pagedCount(bills), t('app.none')),
              total: pageTotal(
                pagedCount(bills),
                <Money
                  value={(bills.data?.items ?? []).reduce((sum, row) => sum + row.totalPaise, 0)}
                  size="cell"
                  symbol={false}
                />,
              ),
            }}
          />
        </Async>
      ) : view === 'receipts' ? (
        <Async
          state={[receipts]}
          rows={10}
          empty={(receipts.data?.items.length ?? 0) === 0}
          emptyMessage={t('m4.empty')}
        >
          <Register
            testID="grn-register"
            columns={grnColumns}
            rows={receipts.data?.items ?? []}
            rowKey={(row) => row.id}
            frozen="no"
            selectedKey={grnId}
            onSelect={(row) => {
              setGrnId(row.id)
            }}
            state="ready"
          />
        </Async>
      ) : view === 'findings' ? (
        <Async
          state={[findings]}
          rows={10}
          empty={(findings.data?.items.length ?? 0) === 0}
          emptyMessage={t('m4.empty')}
        >
          <Register
            testID="findings-register"
            columns={findingColumns}
            rows={findings.data?.items ?? []}
            rowKey={(row) => row.id}
            frozen="kind"
            selectedKey={findingId}
            onSelect={
              mayResolve
                ? (row) => {
                    setFindingId(row.id)
                    setOutcome('accepted')
                    setActing('resolve')
                  }
                : undefined
            }
            state="ready"
          />
        </Async>
      ) : (
        <Async
          state={[orders]}
          rows={10}
          empty={(orders.data?.items.length ?? 0) === 0}
          emptyMessage={t('m4.empty')}
        >
          <Register
            testID="po-register"
            columns={poColumns}
            rows={orders.data?.items ?? []}
            rowKey={(row) => row.id}
            frozen="no"
            state="ready"
          />
        </Async>
      )}

      <Sheet
        open={selected !== null && view === 'bills'}
        onClose={() => {
          setSelected(null)
        }}
        title={bill === undefined ? undefined : t('m4.detail', { no: bill.invoiceNo })}
        testID="bill-panel"
      >
        <Async state={[billDetail]} rows={6}>
          {bill === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('m4.supplier')}>{names.supplier(bill.supplierId)}</Field>
              <Field label={t('m4.invoiceDate')}>{longDate(bill.invoiceDate)}</Field>
              <Field label={t('m4.status')}>
                <StatusChip
                  label={word(bill.status)}
                  family={BILL_FAMILY[bill.status] ?? 'neutral'}
                />
              </Field>
              <Field label={t('m4.value')}>
                <Money value={bill.totalPaise} size="moneyM" />
              </Field>

              <Panel title={t('m2.lines')}>
                <Stack gap={2}>
                  {bill.lines.map((line) => (
                    <Stack key={line.id} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {line.description}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                        {`${String(line.qtyPcs)} ${word('pcs')} · ${line.variantId === null ? t('m4.matchLine') : word('matched')}`}
                      </Txt>
                      <Money value={line.lineTotalPaise} size="cell" />
                    </Stack>
                  ))}
                </Stack>
              </Panel>

              {mayWrite ? (
                <Stack gap={3}>
                  <Button
                    label={t('m4.openGrn')}
                    variant="primary"
                    disabled={bill.status !== 'approved' || godown === undefined}
                    disabledReason={t('m4.onlyApproved')}
                    onPress={() => {
                      setActing('openGrn')
                    }}
                    testID="open-grn"
                  />
                  <Button
                    label={t('m4.dispute')}
                    variant="destructive"
                    disabled={bill.status === 'received' || bill.status === 'cancelled'}
                    disabledReason={t('m4.alreadyReceived')}
                    onPress={() => {
                      setActing('dispute')
                    }}
                    testID="dispute-bill"
                  />
                </Stack>
              ) : null}
            </Stack>
          )}
        </Async>
      </Sheet>

      <Sheet
        open={grnId !== null}
        onClose={() => {
          setGrnId(null)
        }}
        title={grn === undefined ? undefined : (grn.grnNo ?? t('m4.receipts'))}
        testID="grn-panel"
      >
        <Async state={[grnDetail]} rows={6}>
          {grn === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('m4.location')}>{names.location(grn.locationId)}</Field>
              <Field label={t('m4.status')}>
                <StatusChip label={word(grn.status)} family={GRN_FAMILY[grn.status] ?? 'neutral'} />
              </Field>
              <Field label={t('m19.countedLines', { done: counted, total: grn.lines.length })}>
                {shortInstant(grn.countedAt)}
              </Field>

              <Panel title={t('m4.grnLines')}>
                <Stack gap={2}>
                  {grn.lines.map((line) => (
                    <Stack key={line.id} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {names.variant(line.variantId)}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                        {line.countedQtyPcs === null
                          ? t('m4.expectedPcs')
                          : `${t('m4.receivedPcs')} ${String(line.countedQtyPcs)} · ${t('m4.expectedPcs')} ${String(line.expectedQtyPcs)} · ${t('m4.damagedPcs')} ${String(line.damagedQtyPcs)}`}
                      </Txt>
                    </Stack>
                  ))}
                </Stack>
              </Panel>

              {grn.discrepancies.length === 0 ? null : (
                <Panel title={t('m4.findings')}>
                  <Stack gap={2}>
                    {grn.discrepancies.map((row) => (
                      <Txt key={row.id} field="body" desk="cell" numeric>
                        {`${word(row.kind)} · ${String(row.qtyPcs)} ${word('pcs')} · ${word(row.status)}`}
                      </Txt>
                    ))}
                  </Stack>
                </Panel>
              )}

              {mayWrite ? (
                <Button
                  label={t('m4.postGrn')}
                  variant="primary"
                  disabled={grn.status !== 'counting' || grn.countedAt === null}
                  disabledReason={t('m19.countedLines', {
                    done: counted,
                    total: grn.lines.length,
                  })}
                  onPress={() => {
                    setActing('post')
                  }}
                  testID="post-grn"
                />
              ) : null}
            </Stack>
          )}
        </Async>
      </Sheet>

      <Dialog
        open={acting !== null}
        onClose={() => {
          setActing(null)
        }}
        title={
          acting === 'openGrn'
            ? t('m4.openGrn')
            : acting === 'post'
              ? t('m4.postGrn')
              : acting === 'dispute'
                ? t('m4.dispute')
                : t('m4.resolve')
        }
        body={
          <Stack gap={3}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {acting === 'post' ? t('m4.postBody') : ''}
            </Txt>
            {acting === 'resolve' ? (
              /*
               * FOUR outcomes, so a chip row again. `discrepancies.resolve` decides "accepted,
               * claimed, credited or written off" in the contract's own words, and the segmented
               * control this used to be showed the first three — leaving the manager no way at all
               * to write a finding off, on the one screen that decides them.
               */
              <Chips
                testID="finding-outcome"
                items={OUTCOMES.map((entry) => ({
                  id: entry.id,
                  label: t(entry.labelKey),
                  selected: outcome === entry.id,
                }))}
                onToggle={(id) => {
                  setOutcome(id as Outcome)
                }}
              />
            ) : null}
            {acting === 'dispute' || acting === 'resolve' ? (
              <TextInput
                label={acting === 'dispute' ? t('m4.disputeReason') : t('m4.resolveNote')}
                value={note}
                onChange={setNote}
                capitalize="sentences"
                testID="inbound-note"
              />
            ) : null}
          </Stack>
        }
        confirmLabel={
          acting === 'openGrn'
            ? t('m4.openGrn')
            : acting === 'post'
              ? t('m4.postGrn')
              : acting === 'dispute'
                ? t('m4.dispute')
                : t('m4.resolve')
        }
        destructive={acting === 'dispute'}
        busy={
          openGrn.status === 'pending' ||
          postGrn.status === 'pending' ||
          dispute.status === 'pending' ||
          resolve.status === 'pending'
        }
        onConfirm={commit}
        testID="inbound-dialog"
      />
    </Screen>
  )
}
