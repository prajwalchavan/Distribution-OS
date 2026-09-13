/**
 * M6 — the billing desk (docs/23 §2.1; the keyboard loop of UX-01 M1).
 *
 * The loop is: pick the next thing to bill, look at it, issue, next — and the screen states HOW MANY
 * ARE LEFT the whole time, because that count is the only thing that tells the person at the desk
 * when they are done. `j` / `k` move, `Enter` opens, `p` prints.
 *
 * There are two things to bill and they are not the same:
 *
 *  - `billing.invoices.queue` — orders that are packed or confirmed and have no bill yet.
 *  - `warehouse.packs.list { invoiced: false }` — packs confirmed with `issueInvoice: false`, where
 *    THE STOCK HAS ALREADY LEFT. Those are billed with `billing.invoices.issueForPack`, which is why
 *    its dialog says so: nothing is reserved or moved, only the document is made.
 *
 * An issued invoice is immutable except its payment state (docs/22 never-list 4), so the actions on
 * one are the three the ledger allows: cancel before dispatch (the number is kept), record the e-way
 * bill typed from the portal, and ask for an IRN. The PDF is the worker's; the first ask for a bill
 * that was never printed answers `queued` with no URL, and the screen says that rather than looking
 * broken.
 *
 * `billing.invoices.cancel` is owner + manager: for the accountant that button is absent.
 */
import type { BillingQueueItem, InvoiceListItem, PackListItem } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  billLineQty,
  Button,
  Dialog,
  ListRow,
  Money,
  Register,
  Row,
  Screen,
  Segments,
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
import { documents } from '@dos/ui/platform'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'

import {
  Async,
  ExportButton,
  Field,
  PageTabs,
  Panel,
  RangeSegments,
  Refusal,
  addCounts,
  countText,
  moneyColumn,
  pageTotal,
  pagedCount,
  stayOpen,
  textColumn,
  useCan,
  useNames,
} from '../../src/lib/ui'
import { absoluteUrl } from '../../src/config'
import { longDate, rangeOf, type RangeId } from '../../src/lib/dates'
import { useHotkeys, useRegisterKeys } from '../../src/lib/keys'
import { useWord } from '../../src/lib/words'

const INVOICE_FAMILY: Readonly<Record<string, StatusFamily>> = {
  draft: 'neutral',
  issued: 'ochre',
  partially_paid: 'ochre',
  paid: 'moss',
  written_off: 'neutral',
  cancelled: 'neutral',
}

export default function BillingDesk(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const mayCancel = can('billing.invoices.cancel')
  const mayIssueForPack = can('billing.invoices.issueForPack')
  const params = useLocalSearchParams<{ q?: string }>()
  const [view, setView] = useState<'queue' | 'bills'>('queue')
  const [range, setRange] = useState<RangeId>('d30')
  const [q, setQ] = useState(typeof params.q === 'string' ? params.q : '')
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'cancel' | 'eway' | 'billPack' | null>(null)
  const [reason, setReason] = useState('')
  const [ewayNo, setEwayNo] = useState('')
  const [packToBill, setPackToBill] = useState<PackListItem | null>(null)
  const [pdfNote, setPdfNote] = useState<string | null>(null)

  const span = rangeOf(range)
  const searching = q !== ''

  const queue = useQuery(['billing', 'queue'], () => api.api.billing.invoices.queue({ limit: 200 }))
  const unbilledPacks = useQuery(['warehouse', 'packs', 'unbilled'], () =>
    api.api.warehouse.packs.list({ invoiced: false, limit: 50 }),
  )
  const list = useQuery(
    ['invoices', 'list', searching ? q : `${span.from}:${span.to}`],
    () =>
      api.api.billing.invoices.list({
        ...(searching ? { q } : { from: span.from, to: span.to }),
        limit: 200,
      }),
    { enabled: view === 'bills' || searching },
  )
  const detail = useQuery(
    ['invoices', 'get', selected ?? 'none'],
    () => api.api.billing.invoices.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const invoice = detail.data?.item

  const cancel = useMutation(
    (input: { id: string; reason: string }, meta) =>
      api.api.billing.invoices.cancel({
        id: input.id,
        reason: input.reason,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['invoices'], ['billing'], ['receivables'], ['reporting']] },
  )
  const setEway = useMutation(
    (input: { id: string; ewayBillNo: string }, meta) =>
      api.api.billing.invoices.setEwayBill({
        id: input.id,
        ewayBillNo: input.ewayBillNo,
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['invoices']] },
  )
  const irn = useMutation(
    (id: string, meta) =>
      api.api.billing.invoices.requestIrn({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['invoices']] },
  )
  const billPack = useMutation(
    (packId: string, meta) =>
      api.api.billing.invoices.issueForPack({
        id: meta.id,
        packId,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['warehouse'], ['billing'], ['invoices'], ['receivables'], ['reporting']] },
  )

  const queueRows = queue.data?.items ?? []
  const billRows = list.data?.items ?? []
  const packRows = unbilledPacks.data?.items ?? []
  /*
   * "How many are left" is the only number this desk is paced by, and both lists behind it are
   * paged: a full page with a cursor means there are more. It says `200+` rather than `200`.
   */
  const remaining = addCounts(pagedCount(queue), pagedCount(unbilledPacks))

  const queueColumns: readonly RegisterColumn<BillingQueueItem>[] = [
    textColumn('orderNo', t('m6.orderNo'), (row) => row.orderNo, { priority: 'identity' }),
    textColumn('shop', t('m6.shop'), (row) => row.retailerName || names.retailer(row.retailerId)),
    textColumn('lines', t('m6.linesCount'), (row) => row.lineCount, { align: 'right' }),
    moneyColumn('total', t('m6.value'), (row) => row.orderTotalPaise),
    {
      key: 'state',
      head: t('m6.state'),
      priority: 'chip',
      cell: (row) => <StatusChip label={word(row.state)} family="ochre" />,
    },
    textColumn('expected', t('m6.expected'), (row) => longDate(row.expectedDeliveryDate)),
  ]

  const billColumns: readonly RegisterColumn<InvoiceListItem>[] = [
    textColumn('invoiceNo', t('m6.invoiceNo'), (row) => row.invoiceNo, { priority: 'identity' }),
    textColumn('date', t('m12.date'), (row) => longDate(row.invoiceDate)),
    textColumn('shop', t('m6.buyer'), (row) => row.buyerName || names.retailer(row.retailerId)),
    moneyColumn('taxable', t('m6.taxable'), (row) => row.taxablePaise),
    moneyColumn(
      'tax',
      t('m6.gst'),
      (row) => row.cgstPaise + row.sgstPaise + row.igstPaise + row.cessPaise,
    ),
    moneyColumn('total', t('m6.total'), (row) => row.totalPaise),
    moneyColumn('due', t('m6.due'), (row) => row.amountDuePaise, {
      cell: (row) => (
        <Money
          value={row.amountDuePaise}
          size="cell"
          symbol={false}
          tone={row.amountDuePaise > 0 ? 'critical' : 'positive'}
        />
      ),
    }),
    {
      key: 'state',
      head: t('m6.payState'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.state)} family={INVOICE_FAMILY[row.state] ?? 'neutral'} />
      ),
    },
  ]

  /*
   * The PDF is rendered by the WORKER (`documents.pdf.render`), so the first ask for a bill that has
   * never been printed answers `queued` with a null URL. That is not a failure and must not look
   * like one: the note says so and the next press opens the file.
   */
  const openPdf = (print: boolean): void => {
    if (invoice === undefined) return
    setPdfNote(null)
    void api.api.billing.invoices.pdf({ id: invoice.id }).then(
      (result) => {
        const url = absoluteUrl(result.url)
        if (url === null) {
          setPdfNote(t('m6.pdfQueued'))
          return
        }
        void (print ? documents.print(url) : documents.open(url))
      },
      () => {
        setPdfNote(t('state.error'))
      },
    )
  }

  useRegisterKeys({
    rows: billRows,
    rowKey: (row) => row.id,
    selected,
    onSelect: (row) => {
      setSelected(row.id)
    },
    enabled: dialog === null && view === 'bills',
  })
  useHotkeys({
    Escape: () => {
      if (dialog !== null) setDialog(null)
      else setSelected(null)
    },
    p: () => {
      if (selected !== null) openPdf(true)
    },
  })

  const commit = (): void => {
    const done = (): void => {
      setDialog(null)
      setReason('')
    }
    if (dialog === 'cancel' && invoice !== undefined)
      void cancel.mutateAsync({ id: invoice.id, reason: reason.trim() }).then(done, stayOpen)
    if (dialog === 'eway' && invoice !== undefined)
      void setEway.mutateAsync({ id: invoice.id, ewayBillNo: ewayNo.trim() }).then(done, stayOpen)
    if (dialog === 'billPack' && packToBill !== null)
      void billPack.mutateAsync(packToBill.id).then(() => {
        setPackToBill(null)
        done()
      }, stayOpen)
  }

  return (
    <Screen
      title={t('m6.title')}
      context={t('m6.remaining', { count: countText(remaining, t('app.none')) })}
      chips={<PageTabs group="/billing" active="/billing" />}
      actions={
        <>
          <Segments
            testID="billing-view"
            value={view}
            onChange={(id) => {
              setView(id as 'queue' | 'bills')
            }}
            items={[
              { id: 'queue', label: t('m6.tab') },
              { id: 'bills', label: t('m6.invoices') },
            ]}
          />
          {view === 'bills' ? (
            <RangeSegments
              value={range}
              onChange={(id) => {
                setRange(id as RangeId)
              }}
            />
          ) : null}
          <ExportButton
            register="gstSalesRegister"
            filters={{ from: span.from, to: span.to }}
            testID="billing-export"
          />
        </>
      }
    >
      {view === 'queue' ? (
        <Stack gap={6}>
          {/*
           * The panel states ITS OWN queue, never the screen's total again.
           *
           * The header says "211+ left to bill" — the confirmed orders plus the packs that went out
           * unbilled — and this panel, sixty pixels below it, said "200+ left to bill" for the first
           * of those two lists alone. The same five words over two different figures on one screen
           * is a contradiction, not a repetition, so the panel now names what it is counting.
           */}
          <Panel
            title={t('m6.tab')}
            meta={t('m6.queueRows', {
              count: countText(pagedCount(queue), t('app.none')),
            })}
            testID="billing-queue"
          >
            <Async
              state={[queue]}
              rows={10}
              empty={queueRows.length === 0}
              emptyMessage={t('m6.empty')}
            >
              <Register
                testID="billing-queue-register"
                columns={queueColumns}
                rows={queueRows}
                rowKey={(row) => row.orderId}
                frozen="orderNo"
                state="ready"
                totals={{
                  orderNo: countText(pagedCount(queue), t('app.none')),
                  /* Only when the whole queue is on the page — see `pageTotal`. */
                  total: pageTotal(
                    pagedCount(queue),
                    <Money
                      value={queueRows.reduce((sum, row) => sum + row.orderTotalPaise, 0)}
                      size="cell"
                      symbol={false}
                    />,
                  ),
                }}
              />
            </Async>
          </Panel>

          <Panel
            title={t('m6.packs')}
            meta={t('m6.packRows', {
              count: countText(pagedCount(unbilledPacks), t('app.none')),
            })}
            testID="billing-packs"
          >
            <Async
              state={[unbilledPacks]}
              rows={4}
              empty={packRows.length === 0}
              emptyMessage={t('m6.empty')}
            >
              <Stack gap={2}>
                {packRows.map((row) => (
                  <ListRow
                    key={row.id}
                    primary={`${row.orderNo ?? ''} · ${row.retailerName}`}
                    secondary={t('m6.billPackBody')}
                    trailing={<StatusChip label={t('m20.packed')} family="ochre" />}
                    onPress={
                      mayIssueForPack
                        ? () => {
                            setPackToBill(row)
                            setDialog('billPack')
                          }
                        : undefined
                    }
                  />
                ))}
              </Stack>
            </Async>
          </Panel>
        </Stack>
      ) : (
        <Stack gap={4}>
          <Async
            state={[list]}
            rows={12}
            empty={billRows.length === 0}
            emptyMessage={t('m6.noInvoices')}
          >
            <Register
              testID="billing-register"
              columns={billColumns}
              rows={billRows}
              rowKey={(row) => row.id}
              frozen="invoiceNo"
              selectedKey={selected}
              onSelect={(row) => {
                setSelected(row.id)
              }}
              state="ready"
              filters={searching ? [{ id: 'q', label: t('app.searchFilter', { query: q }) }] : []}
              onClearFilters={() => {
                setQ('')
              }}
              totals={{
                invoiceNo: countText(pagedCount(list), t('app.none')),
                total: pageTotal(
                  pagedCount(list),
                  <Money
                    value={billRows.reduce((sum, row) => sum + row.totalPaise, 0)}
                    size="cell"
                    symbol={false}
                  />,
                ),
                due: pageTotal(
                  pagedCount(list),
                  <Money
                    value={billRows.reduce((sum, row) => sum + row.amountDuePaise, 0)}
                    size="cell"
                    symbol={false}
                  />,
                ),
              }}
            />
          </Async>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('m6.keys')}
          </Txt>
        </Stack>
      )}

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={invoice === undefined ? undefined : t('m6.detail', { no: invoice.invoiceNo ?? '' })}
        testID="invoice-panel"
      >
        <Async state={[detail]} rows={6}>
          {invoice === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('m6.buyer')}>{invoice.buyerName}</Field>
              <Field label={t('m12.date')}>{longDate(invoice.invoiceDate)}</Field>
              <Field label={t('m6.payState')}>
                <StatusChip
                  label={word(invoice.state)}
                  family={INVOICE_FAMILY[invoice.state] ?? 'neutral'}
                />
              </Field>
              <Field label={t('m6.total')}>
                <Money value={invoice.totalPaise} size="moneyM" />
              </Field>
              <Field label={t('m6.due')}>
                <Money
                  value={invoice.amountDuePaise}
                  size="moneyM"
                  tone={invoice.amountDuePaise > 0 ? 'critical' : 'positive'}
                />
              </Field>

              <Panel title={t('m2.lines')}>
                <Stack gap={2}>
                  {invoice.lines.map((line) => (
                    <Stack key={line.id} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {line.description}
                      </Txt>
                      <Row gap={2} wrap align="center">
                        <Txt field="label" desk="meta" color={colors.text.secondary}>
                          {billLineQty(line)}
                        </Txt>
                        <Txt field="label" desk="meta" color={colors.text.secondary}>
                          ·
                        </Txt>
                        <Txt field="label" desk="meta" color={colors.text.secondary}>
                          {t('qty.at')}
                        </Txt>
                        <Money value={line.ratePaise} size="body" tone="secondary" />
                        {line.discountPaise > 0 ? (
                          <>
                            <Txt field="label" desk="meta" color={colors.text.secondary}>
                              ·
                            </Txt>
                            <Txt field="label" desk="meta" color={colors.text.secondary}>
                              {t('bill.lessDiscount')}
                            </Txt>
                            <Money value={line.discountPaise} size="body" tone="secondary" />
                          </>
                        ) : null}
                      </Row>
                      <Money value={line.lineTotalPaise} size="cell" />
                    </Stack>
                  ))}
                </Stack>
              </Panel>

              <Stack gap={3}>
                <Button
                  label={t('m6.print')}
                  variant="secondary"
                  shortcut="p"
                  onPress={() => {
                    openPdf(true)
                  }}
                  testID="invoice-print"
                />
                {pdfNote === null ? null : (
                  <Txt field="label" desk="meta" color={colors.status.ochre.fg}>
                    {pdfNote}
                  </Txt>
                )}
                {can('billing.invoices.setEwayBill') ? (
                  <Button
                    label={t('m6.setEwb')}
                    variant="secondary"
                    onPress={() => {
                      setEwayNo(invoice.ewayBillNo ?? '')
                      setDialog('eway')
                    }}
                    testID="invoice-eway"
                  />
                ) : null}
                {can('billing.invoices.requestIrn') ? (
                  <>
                    <Refusal of={[irn]} scope={invoice.id} testID="invoice-irn-refusal" />
                    <Button
                      label={t('m6.requestIrn')}
                      variant="secondary"
                      loading={irn.status === 'pending'}
                      onPress={() => {
                        irn.mutate(invoice.id)
                      }}
                      testID="invoice-irn"
                    />
                  </>
                ) : null}
                {mayCancel ? (
                  <Button
                    label={t('m6.cancelInvoice')}
                    variant="destructive"
                    disabled={invoice.state === 'cancelled'}
                    disabledReason={t('m6.alreadyCancelled')}
                    onPress={() => {
                      setDialog('cancel')
                    }}
                    testID="invoice-cancel"
                  />
                ) : (
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {t('app.accountantRead')}
                  </Txt>
                )}
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
          dialog === 'cancel'
            ? t('m6.cancelInvoice')
            : dialog === 'eway'
              ? t('m6.setEwb')
              : t('m6.billPack')
        }
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {dialog === 'billPack'
                ? `${packToBill?.orderNo ?? ''} · ${packToBill?.retailerName ?? ''}`
                : (invoice?.invoiceNo ?? '')}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {dialog === 'cancel'
                ? t('m6.cancelBody')
                : dialog === 'billPack'
                  ? t('m6.billPackBody')
                  : t('m7.ewbHint')}
            </Txt>
            {dialog === 'cancel' ? (
              <TextInput
                label={t('m6.cancelReason')}
                value={reason}
                onChange={setReason}
                capitalize="sentences"
                testID="invoice-reason"
              />
            ) : null}
            {dialog === 'eway' ? (
              <TextInput
                label={t('m7.ewbNo')}
                value={ewayNo}
                onChange={setEwayNo}
                keyboard="decimal"
                capitalize="none"
                testID="invoice-ewb"
              />
            ) : null}
            <Refusal of={[cancel, setEway, billPack]} testID="billing-refusal" />
          </Stack>
        }
        confirmLabel={
          dialog === 'cancel'
            ? t('m6.cancelInvoice')
            : dialog === 'eway'
              ? t('m6.setEwb')
              : t('m6.billPack')
        }
        destructive={dialog === 'cancel'}
        busy={
          cancel.status === 'pending' ||
          setEway.status === 'pending' ||
          billPack.status === 'pending'
        }
        onConfirm={commit}
        testID="billing-dialog"
      />
    </Screen>
  )
}
