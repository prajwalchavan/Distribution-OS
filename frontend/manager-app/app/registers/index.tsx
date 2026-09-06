/**
 * M12 — the registers, and the accountant's home (docs/23 §2.1).
 *
 * Seven books behind one chip row, because that is how a back office thinks: "show me the sales
 * register", "show me the day book". Every one of them is a READ the service already computes — this
 * screen adds no arithmetic of its own, and every list is exportable through the worker with the
 * same filters the reader is looking at.
 *
 * The one thing this screen computes is the GSTR-1 countdown, and it computes it in the browser on
 * purpose: the return for a month is filed by the 11th of the next month, and a banner that says
 * "six days left" is worth more than a date. It is a fact about the calendar, not about the data.
 *
 * Every procedure here is BACK_OFFICE, so the accountant sees the whole screen; nothing is hidden
 * and nothing is greyed.
 */
import type {
  Account,
  CollectionsRow,
  DailyTenantStat,
  GstSummaryRow,
  JournalEntry,
  OutstandingListItem,
  PurchaseRegisterRow,
  SalesRegisterRow,
} from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  Chips,
  Money,
  Register,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  ExportButton,
  PageTabs,
  Panel,
  RangeSegments,
  moneyColumn,
  textColumn,
  useNames,
} from '../../src/lib/ui'
import { longDate, monthName, rangeOf, shortDate, today, type RangeId } from '../../src/lib/dates'
import { formatBps, useWord } from '../../src/lib/words'

type Book =
  'sales' | 'gst' | 'purchase' | 'collections' | 'outstanding' | 'trial' | 'dayBook' | 'daily'

/**
 * Days until the GSTR-1 deadline for the month that has just closed: the 11th of the NEXT month.
 * IST dates throughout, and the arithmetic is on the ISO string's own UTC midnight — the same thing
 * `src/lib/dates.ts` does everywhere else.
 */
function gstr1(nowIso: string): { month: string; days: number } {
  const [y, m] = nowIso.split('-').map(Number) as [number, number]
  // Before the 11th, the return still open is LAST month's; after it, this month's.
  const day = Number(nowIso.slice(8, 10))
  const closedMonth = day <= 11 ? m - 1 : m
  const dueYear = closedMonth === 0 ? y : closedMonth === 12 ? y + 1 : y
  const dueMonth = closedMonth === 0 ? 12 : closedMonth + 1
  const due = Date.UTC(dueYear, dueMonth - 1, 11)
  const now = Date.UTC(y, m - 1, day)
  const monthIso = `${String(closedMonth === 0 ? y - 1 : y)}-${String(closedMonth === 0 ? 12 : closedMonth).padStart(2, '0')}-01`
  return { month: monthIso, days: Math.round((due - now) / 86_400_000) }
}

export default function Registers(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()

  const [book, setBook] = useState<Book>('sales')
  const [range, setRange] = useState<RangeId>('d30')
  const span = rangeOf(range)
  const on = (which: Book): boolean => book === which

  const sales = useQuery(
    ['registers', 'sales', span.from, span.to],
    () => api.api.billing.registers.salesRegister({ from: span.from, to: span.to, limit: 200 }),
    { enabled: on('sales') },
  )
  const gst = useQuery(
    ['registers', 'gst', span.from, span.to],
    () => api.api.billing.registers.gstSummary({ from: span.from, to: span.to }),
    { enabled: on('gst') },
  )
  const purchase = useQuery(
    ['registers', 'purchase', span.from, span.to],
    () => api.api.reporting.registers.gstPurchaseRegister({ from: span.from, to: span.to }),
    { enabled: on('purchase') },
  )
  const collections = useQuery(
    ['registers', 'collections', span.from, span.to],
    () => api.api.reporting.registers.collections({ from: span.from, to: span.to, groupBy: 'day' }),
    { enabled: on('collections') },
  )
  const outstanding = useQuery(
    ['registers', 'outstanding'],
    () => api.api.receivables.outstanding.list({ limit: 200 }),
    { enabled: on('outstanding') },
  )
  const accounts = useQuery(
    ['registers', 'accounts'],
    () => api.api.receivables.accounts.list({}),
    { enabled: on('trial') },
  )
  const journal = useQuery(
    ['registers', 'journal', span.from, span.to],
    () => api.api.receivables.journal.list({ from: span.from, to: span.to, limit: 200 }),
    { enabled: on('dayBook') },
  )
  const daily = useQuery(
    ['registers', 'daily', span.from, span.to],
    () => api.api.reporting.dailyStats.tenant({ from: span.from, to: span.to, limit: 92 }),
    { enabled: on('daily') },
  )

  const deadline = gstr1(today())

  const salesColumns: readonly RegisterColumn<SalesRegisterRow>[] = [
    textColumn('no', t('m12.invoiceNo'), (row) => row.invoiceNo ?? row.externalInvoiceNo, {
      priority: 'identity',
    }),
    textColumn('date', t('m12.date'), (row) => longDate(row.invoiceDate)),
    textColumn('shop', t('m12.shop'), (row) => row.buyerName),
    textColumn('supply', t('m11.source'), (row) => word(row.supplyType)),
    moneyColumn('taxable', t('m12.taxable'), (row) => row.taxablePaise),
    moneyColumn(
      'gst',
      t('m12.gstAmount'),
      (row) => row.cgstPaise + row.sgstPaise + row.igstPaise + row.cessPaise,
    ),
    moneyColumn('total', t('m12.total'), (row) => row.totalPaise),
  ]

  const gstColumns: readonly RegisterColumn<GstSummaryRow>[] = [
    textColumn('hsn', t('m12.hsn'), (row) => row.hsnCode, { priority: 'identity' }),
    textColumn('rate', t('m12.rate'), (row) => formatBps(row.gstBps)),
    textColumn('qty', t('m16.qty'), (row) => row.qtyPcs, { align: 'right' }),
    moneyColumn('taxable', t('m12.taxable'), (row) => row.taxablePaise),
    moneyColumn('cgst', 'CGST ₹', (row) => row.cgstPaise),
    moneyColumn('sgst', 'SGST ₹', (row) => row.sgstPaise),
    moneyColumn('igst', 'IGST ₹', (row) => row.igstPaise),
    moneyColumn('total', t('m12.total'), (row) => row.totalPaise),
  ]

  const outstandingColumns: readonly RegisterColumn<OutstandingListItem>[] = [
    textColumn('code', t('m14.code'), (row) => row.code, { priority: 'identity' }),
    textColumn('shop', t('m12.shop'), (row) => row.name),
    textColumn('beat', t('m14.beat'), (row) => names.beat(row.beatId)),
    moneyColumn('owed', t('m12.owed'), (row) => row.outstandingPaise),
    moneyColumn('overdue', t('m1.outstanding'), (row) => row.overduePaise, {
      cell: (row) => (
        <Money
          value={row.overduePaise}
          size="cell"
          symbol={false}
          tone={row.overduePaise > 0 ? 'critical' : 'default'}
        />
      ),
    }),
    textColumn('bills', t('m6.invoices'), (row) => row.openBills, { align: 'right' }),
    textColumn('oldest', t('m14.oldest'), (row) => longDate(row.oldestDueDate)),
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
  ]

  /*
   * The purchase register is GSTR-2-shaped and NOT the same row as the sales summary: it counts
   * DOCUMENTS rather than invoices and carries free quantity. Sharing one column array between the
   * two would have compiled only by widening a type that means two different things.
   */
  const purchaseColumns: readonly RegisterColumn<PurchaseRegisterRow>[] = [
    textColumn('hsn', t('m12.hsn'), (row) => row.hsnCode, { priority: 'identity' }),
    textColumn('rate', t('m12.rate'), (row) => formatBps(row.gstBps)),
    textColumn('qty', t('m16.qty'), (row) => row.qtyPcs, { align: 'right' }),
    moneyColumn('taxable', t('m12.taxable'), (row) => row.taxablePaise),
    moneyColumn('cgst', 'CGST ₹', (row) => row.cgstPaise),
    moneyColumn('sgst', 'SGST ₹', (row) => row.sgstPaise),
    moneyColumn('igst', 'IGST ₹', (row) => row.igstPaise),
    moneyColumn('total', t('m12.total'), (row) => row.totalPaise),
  ]

  const collectionColumns: readonly RegisterColumn<CollectionsRow>[] = [
    textColumn('bucket', t('m12.date'), (row) => row.bucketName || row.bucket, {
      priority: 'identity',
    }),
    moneyColumn('cash', word('cash'), (row) => row.cashPaise),
    moneyColumn('upi', word('upi'), (row) => row.upiPaise),
    moneyColumn('cheque', word('cheque'), (row) => row.chequePaise),
    moneyColumn('bank', word('bank_transfer'), (row) => row.bankTransferPaise),
    moneyColumn('total', t('m12.collected'), (row) => row.totalPaise),
    textColumn('count', t('m6.invoices'), (row) => row.receiptCount, { align: 'right' }),
  ]

  const dailyColumns: readonly RegisterColumn<DailyTenantStat>[] = [
    textColumn('day', t('m12.date'), (row) => longDate(row.day), { priority: 'identity' }),
    textColumn('orders', t('m2.title'), (row) => row.ordersCount, { align: 'right' }),
    moneyColumn('invoiced', t('m1.invoicedToday'), (row) => row.invoicedPaise),
    moneyColumn('collected', t('m12.collected'), (row) => row.collectedPaise),
    moneyColumn('outstanding', t('m12.owed'), (row) => row.outstandingPaise),
    textColumn('shops', t('m12.shop'), (row) => row.activeRetailers, { align: 'right' }),
  ]

  const accountColumns: readonly RegisterColumn<Account>[] = [
    textColumn('code', t('m12.account'), (row) => row.code, { priority: 'identity' }),
    textColumn('name', t('m12.narration'), (row) => row.name),
    textColumn('kind', t('m4.kind'), (row) => word(row.kind)),
    moneyColumn('balance', t('m12.total'), (row) => row.balancePaise),
  ]

  const journalColumns: readonly RegisterColumn<JournalEntry>[] = [
    textColumn('date', t('m12.date'), (row) => longDate(row.entryDate), { priority: 'identity' }),
    textColumn('doc', t('m12.document'), (row) => word(row.refType)),
    textColumn('narration', t('m12.narration'), (row) => row.narration),
    {
      /*
       * A journal entry has a debit side and a credit side and they are equal by construction
       * (the balance trigger enforces it). One column can only be the ENTRY'S VALUE — the debit
       * total — and calling it "Debit" beside no credit column invites the reader to look for the
       * other half. It states the value.
       */
      key: 'amount',
      head: t('m12.entryValue'),
      align: 'right',
      priority: 'value',
      cell: (row) => (
        <Money
          value={row.lines.reduce((sum, line) => sum + Math.max(0, line.amountPaise), 0)}
          size="cell"
          symbol={false}
        />
      ),
    },
    textColumn('by', t('m9.receivedBy'), (row) => names.staff(row.postedBy)),
  ]

  const BOOKS: readonly { id: Book; label: string }[] = [
    { id: 'sales', label: t('m12.sales') },
    { id: 'gst', label: t('m12.gst') },
    { id: 'purchase', label: t('m12.purchase') },
    { id: 'collections', label: t('m12.collections') },
    { id: 'outstanding', label: t('m12.outstanding') },
    { id: 'trial', label: t('m12.trial') },
    { id: 'dayBook', label: t('m12.dayBook') },
    { id: 'daily', label: t('m12.daily') },
  ]

  /** Which export register this book maps to; a book with no server-side export offers none. */
  const EXPORTS: Partial<
    Record<Book, 'gstSalesRegister' | 'gstPurchaseRegister' | 'collections' | 'dailySales'>
  > = {
    sales: 'gstSalesRegister',
    gst: 'gstSalesRegister',
    purchase: 'gstPurchaseRegister',
    collections: 'collections',
    daily: 'dailySales',
  }
  const exportable = EXPORTS[book]

  return (
    <Screen
      title={t('m12.title')}
      chips={<PageTabs group="/registers" active="/registers" />}
      actions={
        <>
          <RangeSegments
            value={range}
            onChange={(id) => {
              setRange(id as RangeId)
            }}
          />
          {exportable === undefined ? null : (
            <ExportButton
              register={exportable}
              filters={{ from: span.from, to: span.to }}
              testID="registers-export"
            />
          )}
        </>
      }
    >
      <Stack gap={4}>
        <Txt
          field="body"
          desk="body"
          color={deadline.days <= 3 ? colors.status.brick.fg : colors.text.secondary}
          testID="gstr1-deadline"
        >
          {deadline.days === 0
            ? t('m12.gstr1DueToday', { month: monthName(deadline.month) })
            : deadline.days > 0
              ? t('m12.gstr1Due', { month: monthName(deadline.month), days: deadline.days })
              : t('m12.gstr1Late', { month: monthName(deadline.month), days: -deadline.days })}
        </Txt>

        <Chips
          testID="registers-books"
          items={BOOKS.map((entry) => ({
            id: entry.id,
            label: entry.label,
            selected: book === entry.id,
          }))}
          onToggle={(id) => {
            setBook(id as Book)
          }}
        />

        {on('sales') ? (
          <Async
            state={[sales]}
            rows={12}
            empty={(sales.data?.items.length ?? 0) === 0}
            emptyMessage={t('m12.empty')}
          >
            <Register
              testID="sales-register"
              columns={salesColumns}
              rows={sales.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="no"
              state="ready"
              totals={{
                no: t('app.rows', { count: sales.data?.items.length ?? 0 }),
                taxable: (
                  <Money value={sales.data?.totals.taxablePaise ?? 0} size="cell" symbol={false} />
                ),
                total: (
                  <Money value={sales.data?.totals.totalPaise ?? 0} size="cell" symbol={false} />
                ),
              }}
            />
          </Async>
        ) : null}

        {on('gst') ? (
          <Async state={[gst]} rows={8} empty={(gst.data?.rows.length ?? 0) === 0}>
            <Register
              testID="gst-register"
              columns={gstColumns}
              rows={gst.data?.rows ?? []}
              rowKey={(row) => `${row.hsnCode}-${String(row.gstBps)}-${String(row.cessBps)}`}
              frozen="hsn"
              state="ready"
              totals={{
                hsn: t('word.total'),
                taxable: (
                  <Money value={gst.data?.totals.taxablePaise ?? 0} size="cell" symbol={false} />
                ),
                total: (
                  <Money value={gst.data?.totals.totalPaise ?? 0} size="cell" symbol={false} />
                ),
              }}
            />
          </Async>
        ) : null}

        {on('purchase') ? (
          <Async state={[purchase]} rows={8} empty={(purchase.data?.rows.length ?? 0) === 0}>
            <Register
              testID="purchase-register"
              columns={purchaseColumns}
              rows={purchase.data?.rows ?? []}
              rowKey={(row) => `${row.hsnCode}-${String(row.gstBps)}-${String(row.cessBps)}`}
              frozen="hsn"
              state="ready"
              totals={{
                hsn: t('word.total'),
                taxable: (
                  <Money
                    value={purchase.data?.totals.taxablePaise ?? 0}
                    size="cell"
                    symbol={false}
                  />
                ),
                total: (
                  <Money value={purchase.data?.totals.totalPaise ?? 0} size="cell" symbol={false} />
                ),
              }}
            />
          </Async>
        ) : null}

        {on('collections') ? (
          <Async state={[collections]} rows={8} empty={(collections.data?.items.length ?? 0) === 0}>
            <Register
              testID="collections-register"
              columns={collectionColumns}
              rows={collections.data?.items ?? []}
              rowKey={(row) => row.bucket}
              frozen="bucket"
              state="ready"
              totals={{
                bucket: t('word.total'),
                total: (
                  <Money
                    value={collections.data?.totals.totalPaise ?? 0}
                    size="cell"
                    symbol={false}
                  />
                ),
              }}
            />
          </Async>
        ) : null}

        {on('outstanding') ? (
          <Async
            state={[outstanding]}
            rows={12}
            empty={(outstanding.data?.items.length ?? 0) === 0}
          >
            <Register
              testID="outstanding-register"
              columns={outstandingColumns}
              rows={outstanding.data?.items ?? []}
              rowKey={(row) => row.retailerId}
              frozen="code"
              state="ready"
              totals={{
                code: t('app.rows', { count: outstanding.data?.items.length ?? 0 }),
                owed: (
                  <Money
                    value={outstanding.data?.totals.outstandingPaise ?? 0}
                    size="cell"
                    symbol={false}
                  />
                ),
                overdue: (
                  <Money
                    value={outstanding.data?.totals.overduePaise ?? 0}
                    size="cell"
                    symbol={false}
                  />
                ),
              }}
            />
          </Async>
        ) : null}

        {on('trial') ? (
          <Async state={[accounts]} rows={10} empty={(accounts.data?.items.length ?? 0) === 0}>
            <Register
              testID="trial-register"
              columns={accountColumns}
              rows={accounts.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="code"
              state="ready"
            />
          </Async>
        ) : null}

        {on('dayBook') ? (
          <Async state={[journal]} rows={12} empty={(journal.data?.items.length ?? 0) === 0}>
            <Register
              testID="daybook-register"
              columns={journalColumns}
              rows={journal.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="date"
              state="ready"
              totals={{ date: t('app.rows', { count: journal.data?.items.length ?? 0 }) }}
            />
          </Async>
        ) : null}

        {on('daily') ? (
          <Async state={[daily]} rows={10} empty={(daily.data?.items.length ?? 0) === 0}>
            <Register
              testID="daily-register"
              columns={dailyColumns}
              rows={daily.data?.items ?? []}
              rowKey={(row) => row.day}
              frozen="day"
              state="ready"
            />
          </Async>
        ) : null}

        <Panel>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('app.range', { from: shortDate(span.from), to: shortDate(span.to) })}
          </Txt>
        </Panel>
      </Stack>
    </Screen>
  )
}
