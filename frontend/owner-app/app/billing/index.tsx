/**
 * O13 — the billing register, the bill detail and the GST summary (docs/23 §1.1).
 *
 * An issued invoice is immutable except its payment state, so nothing here edits one: the actions are
 * the three the ledger allows — cancel before dispatch (which keeps the number and marks the row
 * cancelled), record an e-way bill, and ask for an IRN. The PDF is the worker's, opened through
 * `@dos/ui/platform` so the same button prints in a browser and shares on a phone.
 */
import type { GstSummaryRow, InvoiceListItem } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Money,
  Register,
  Screen,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { documents } from '@dos/ui/platform'
import { useState } from 'react'

import {
  Async,
  ExportButton,
  Field,
  PageTabs,
  Panel,
  RangeSegments,
  moneyColumn,
  textColumn,
  useNames,
} from '../../src/lib/ui'
import { absoluteUrl } from '../../src/config'
import { longDate, rangeOf, type RangeId } from '../../src/lib/dates'
import { useHotkeys, useRegisterKeys } from '../../src/lib/keys'

const INVOICE_FAMILY: Readonly<Record<string, StatusFamily>> = {
  draft: 'neutral',
  issued: 'ochre',
  partially_paid: 'ochre',
  paid: 'moss',
  written_off: 'neutral',
  cancelled: 'neutral',
}

export default function Billing(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const names = useNames()

  const [range, setRange] = useState<RangeId>('d30')
  const [view, setView] = useState<'bills' | 'gst'>('bills')
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'cancel' | 'eway' | null>(null)
  const [reason, setReason] = useState('')
  const [ewayNo, setEwayNo] = useState('')
  const [pdfNote, setPdfNote] = useState<string | null>(null)

  const span = rangeOf(range)
  const list = useQuery(['invoices', 'list', span.from, span.to], () =>
    api.api.billing.invoices.list({ from: span.from, to: span.to, limit: 200 }),
  )
  const gst = useQuery(
    ['billing', 'gst', span.from, span.to],
    () => api.api.billing.registers.gstSummary({ from: span.from, to: span.to }),
    { enabled: view === 'gst' },
  )
  const detail = useQuery(
    ['invoices', 'get', selected ?? 'none'],
    () => api.api.billing.invoices.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )

  const cancel = useMutation(
    (input: { id: string; reason: string }, meta) =>
      api.api.billing.invoices.cancel({
        id: input.id,
        reason: input.reason,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['invoices'], ['receivables'], ['reporting']] },
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

  const rows = list.data?.items ?? []
  const invoice = detail.data?.item

  const columns: readonly RegisterColumn<InvoiceListItem>[] = [
    textColumn('invoiceNo', t('o13.invoiceNo'), (row) => row.invoiceNo, { priority: 'identity' }),
    textColumn('date', t('o13.date'), (row) => longDate(row.invoiceDate)),
    textColumn('shop', t('o13.shop'), (row) => row.buyerName || names.retailer(row.retailerId)),
    moneyColumn('taxable', t('o13.taxable'), (row) => row.taxablePaise),
    moneyColumn(
      'tax',
      t('o13.tax'),
      (row) => row.cgstPaise + row.sgstPaise + row.igstPaise + row.cessPaise,
    ),
    moneyColumn('total', t('o13.total'), (row) => row.totalPaise),
    moneyColumn('due', t('o13.due'), (row) => row.amountDuePaise, {
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
      head: t('o13.state'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={row.state} family={INVOICE_FAMILY[row.state] ?? 'neutral'} />
      ),
    },
  ]

  useRegisterKeys({
    rows,
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
  })

  /*
   * The PDF is rendered by the WORKER (`documents.pdf.render`), so the first ask for a bill that has
   * never been printed answers `queued` with a null URL. That is not a failure and must not look like
   * one: the button says so and the next press opens the file.
   */
  const openPdf = (print: boolean): void => {
    if (invoice === undefined) return
    setPdfNote(null)
    void api.api.billing.invoices.pdf({ id: invoice.id }).then(
      (result) => {
        const url = absoluteUrl(result.url)
        if (url === null) {
          setPdfNote(t('o13.pdfQueued'))
          return
        }
        void (print ? documents.print(url) : documents.open(url))
      },
      () => {
        setPdfNote(t('state.error'))
      },
    )
  }

  return (
    <Screen
      title={t('o13.title')}
      chips={<PageTabs group="/billing" active="/billing" />}
      actions={
        <>
          <Segments
            value={view}
            onChange={(id) => {
              setView(id as 'bills' | 'gst')
            }}
            items={[
              { id: 'bills', label: t('o13.tab') },
              { id: 'gst', label: t('o13.gst') },
            ]}
            testID="billing-view"
          />
          <RangeSegments
            value={range}
            onChange={(id) => {
              setRange(id as RangeId)
            }}
          />
          <ExportButton
            register="gstSalesRegister"
            filters={{ from: span.from, to: span.to }}
            testID="billing-export"
          />
        </>
      }
    >
      {view === 'bills' ? (
        <Async state={[list]} rows={12} empty={rows.length === 0} emptyMessage={t('o13.empty')}>
          <Register
            testID="billing-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="invoiceNo"
            selectedKey={selected}
            onSelect={(row) => {
              setSelected(row.id)
            }}
            state="ready"
            totals={{
              invoiceNo: t('app.rows', { count: rows.length }),
              total: (
                <Money
                  value={rows.reduce((sum, row) => sum + row.totalPaise, 0)}
                  size="cell"
                  symbol={false}
                />
              ),
              due: (
                <Money
                  value={rows.reduce((sum, row) => sum + row.amountDuePaise, 0)}
                  size="cell"
                  symbol={false}
                />
              ),
            }}
          />
        </Async>
      ) : (
        <Async state={[gst]} rows={8} empty={(gst.data?.rows.length ?? 0) === 0}>
          <Register
            testID="gst-register"
            columns={[
              textColumn('hsn', t('o13.hsn'), (row: GstSummaryRow) => row.hsnCode, {
                priority: 'identity',
              }),
              textColumn(
                'rate',
                t('o13.rate'),
                (row: GstSummaryRow) => `${String(row.gstBps / 100)}%`,
              ),
              textColumn('qty', t('o16.qty'), (row: GstSummaryRow) => row.qtyPcs),
              moneyColumn('taxable', t('o13.taxable'), (row: GstSummaryRow) => row.taxablePaise),
              moneyColumn('cgst', 'CGST ₹', (row: GstSummaryRow) => row.cgstPaise),
              moneyColumn('sgst', 'SGST ₹', (row: GstSummaryRow) => row.sgstPaise),
              moneyColumn('igst', 'IGST ₹', (row: GstSummaryRow) => row.igstPaise),
              moneyColumn('total', t('o13.total'), (row: GstSummaryRow) => row.totalPaise),
            ]}
            rows={gst.data?.rows ?? []}
            rowKey={(row) => `${row.hsnCode}-${String(row.gstBps)}-${String(row.cessBps)}`}
            state="ready"
            totals={{
              hsn: t('word.total'),
              taxable: (
                <Money value={gst.data?.totals.taxablePaise ?? 0} size="cell" symbol={false} />
              ),
              total: <Money value={gst.data?.totals.totalPaise ?? 0} size="cell" symbol={false} />,
            }}
          />
        </Async>
      )}

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={invoice?.invoiceNo ?? undefined}
        testID="invoice-panel"
      >
        <Async state={[detail]} rows={6}>
          {invoice === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('o13.shop')}>{invoice.buyerName}</Field>
              <Field label={t('o13.date')}>{longDate(invoice.invoiceDate)}</Field>
              <Field label={t('o13.total')}>
                <Money value={invoice.totalPaise} size="moneyM" />
              </Field>
              <Field label={t('o13.due')}>
                <Money
                  value={invoice.amountDuePaise}
                  size="cell"
                  tone={invoice.amountDuePaise > 0 ? 'critical' : 'positive'}
                />
              </Field>
              <Panel title={t('o5.lines', { count: invoice.lines.length })}>
                <Stack gap={2}>
                  {invoice.lines.map((line) => (
                    <Stack key={line.id} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {line.description}
                      </Txt>
                      <Money value={line.lineTotalPaise} size="cell" />
                    </Stack>
                  ))}
                </Stack>
              </Panel>
              <Button
                label={t('o13.pdf')}
                variant="secondary"
                onPress={() => {
                  openPdf(false)
                }}
                testID="invoice-pdf"
              />
              <Button
                label={t('o13.printBill')}
                variant="ghost"
                shortcut="⌘P"
                onPress={() => {
                  openPdf(true)
                }}
              />
              {pdfNote === null ? null : (
                <Txt field="label" desk="meta">
                  {pdfNote}
                </Txt>
              )}
              <Button
                label={t('o13.eway')}
                variant="ghost"
                onPress={() => {
                  setDialog('eway')
                }}
              />
              <Button
                label={t('o13.irn')}
                variant="ghost"
                loading={irn.status === 'pending'}
                onPress={() => {
                  irn.mutate(invoice.id)
                }}
              />
              <Button
                label={t('o13.cancel')}
                variant="destructive"
                disabled={invoice.state === 'cancelled'}
                disabledReason={t('o13.state')}
                onPress={() => {
                  setDialog('cancel')
                }}
                testID="invoice-cancel"
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
        title={dialog === 'cancel' ? t('o13.cancel') : t('o13.eway')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {invoice?.invoiceNo ?? ''}
            </Txt>
            {dialog === 'cancel' ? (
              <TextInput
                label={t('o5.cancelReason')}
                value={reason}
                onChange={setReason}
                capitalize="sentences"
              />
            ) : (
              <TextInput
                label={t('o13.ewayNo')}
                value={ewayNo}
                onChange={setEwayNo}
                keyboard="decimal"
                maxLength={12}
              />
            )}
          </Stack>
        }
        confirmLabel={dialog === 'cancel' ? t('o13.cancel') : t('app.save')}
        destructive={dialog === 'cancel'}
        busy={cancel.status === 'pending' || setEway.status === 'pending'}
        onConfirm={() => {
          if (invoice === undefined) return
          const done = (): void => {
            setDialog(null)
            setReason('')
            setEwayNo('')
          }
          if (dialog === 'cancel')
            void cancel.mutateAsync({ id: invoice.id, reason: reason.trim() }).then(done, done)
          else
            void setEway.mutateAsync({ id: invoice.id, ewayBillNo: ewayNo.trim() }).then(done, done)
        }}
        testID="invoice-dialog"
      />
    </Screen>
  )
}
