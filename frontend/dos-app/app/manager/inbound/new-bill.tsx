/**
 * M4n — type a supplier bill (QA DOS-213).
 *
 * The photo path (warehouse Capture → Documents → review → book) stays the first way in, and this
 * screen says so. But a supplier whose bill carries no QR, or whose photo the engine could not read
 * ("MOM Foods — Failed" in the day-1 queue), left the desk with no way at all to bring the goods in:
 * the Inbound registers had no add, and the day-1 simulation's eight-SKU receipt could not be booked.
 * `procurement.supplierInvoices.create` (owner + manager, `source: 'manual'`) was always there.
 *
 * So: the supplier, the bill number and date, and one line per item as printed — item, batch, expiry,
 * quantity in pieces or cases (the supplier's own case size), the rate per piece or per case, and GST
 * from the item's HSN (`catalog.hsnRates`, dated to the bill) unless the desk types what the bill
 * printed. The arithmetic and the rules live in `src/groups/manager/lib/supplier-bill.ts`, where they
 * are tested; the Book button's reason is always the next thing to fix.
 *
 * It is a page of Supplier bills, not a fifth tab: the Inbound tab row is three routes wide on a phone
 * already, and the Supplier bills page carries the one button that opens this form.
 *
 * Booking is two writes, and the screen reports each only after its 2xx (never-list #12): the bill is
 * booked (`supplierInvoices.create`), then a goods receipt is opened at the godown (`grns.open`) so
 * the gate hand finds it on the warehouse home and counts it blind. If the second write fails the
 * screen says the bill IS booked and offers only the receipt again — it never re-books.
 */
import { newId } from '@dos/api-client'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import { businessDate } from '@dos/domain'
import {
  Button,
  Chips,
  Dialog,
  Group,
  ListRow,
  Money,
  Row,
  RupeeInput,
  Screen,
  Search,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  routeFor,
  useColors,
  useStrings,
} from '@dos/ui'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import {
  billProblems,
  billTotals,
  bpsToPercent,
  createBody,
  lineFigures,
  lineProblems,
  parseDate,
  rateFor,
  shelfLifeDays,
  showDate,
  type BillProblem,
  type CreateBody,
  type DraftLine,
  type HsnRateLike,
  type LineProblem,
} from '../../../src/groups/manager/lib/supplier-bill'
import {
  Columns,
  Field,
  Half,
  PageTabs,
  Panel,
  Refusal,
  useCan,
} from '../../../src/groups/manager/lib/ui'

const LINE_PROBLEM_KEY: Readonly<Record<LineProblem, string>> = {
  item: 'm4n.needItem',
  qty: 'm4n.needQty',
  free: 'm4n.needFree',
  rate: 'm4n.needRate',
  caseRate: 'm4n.needCaseSize',
  gst: 'm4n.needGst',
  expiry: 'm4n.needExpiry',
  mrp: 'm4n.needMrp',
}

const BILL_PROBLEM_KEY: Readonly<Record<BillProblem, string>> = {
  supplier: 'm4n.needSupplier',
  billNo: 'm4n.needBillNo',
  billDate: 'm4n.needBillDate',
  futureDate: 'm4n.futureDate',
  lines: 'm4n.needLines',
  total: 'm4n.totalMismatch',
}

const HSN_RE = /^\d{4,8}$/

function blankLine(): DraftLine {
  return {
    id: newId(),
    variantId: null,
    name: '',
    hsnCode: null,
    mrpPaise: null,
    variantMrpPaise: null,
    caseSize: 1,
    batchNo: '',
    expiry: '',
    qty: '',
    unit: 'cs',
    freePcs: '',
    ratePaise: null,
    rateBasis: 'case',
    gstText: '',
  }
}

interface Booked {
  id: string
  invoiceNo: string
  totalPaise: number
}

interface Receipt {
  id: string
  locationId: string
  lineCount: number
}

export default function NewSupplierBill(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const router = useRouter()
  const can = useCan()
  const today = businessDate().date

  // ------------------------------------------------------------------ the masters this form reads
  const me = useQuery(['tenancy', 'me'], () => api.api.tenancy.me(), { staleTime: 300_000 })
  const ourState = me.data?.tenant.stateCode ?? null
  const suppliers = useQuery(['names', 'suppliers'], () => api.api.tenantCatalog.suppliers({}), {
    staleTime: 300_000,
  })
  const locations = useQuery(['inventory', 'locations'], () => api.api.inventory.locations.list({}))
  const godowns = (locations.data?.items ?? []).filter(
    (row) => row.kind === 'warehouse' && row.active,
  )

  // ------------------------------------------------------------------ the bill header
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [supplierQuery, setSupplierQuery] = useState('')
  const [billNo, setBillNo] = useState('')
  const [billDate, setBillDate] = useState(showDate(today))
  const [printedTotal, setPrintedTotal] = useState<number | null>(null)
  const [godownId, setGodownId] = useState<string | null>(null)
  const [lines, setLines] = useState<readonly DraftLine[]>([])
  const [tried, setTried] = useState(false)

  const supplier = (suppliers.data?.items ?? []).find((row) => row.id === supplierId)
  /** The supplier's state: its register row, else the first two digits of its GSTIN. */
  const supplierState =
    supplier === undefined
      ? null
      : (supplier.stateCode ?? (supplier.gstin === null ? null : supplier.gstin.slice(0, 2)))
  const supplierHits = (suppliers.data?.items ?? [])
    .filter((row) => row.active)
    .filter((row) => {
      const q = supplierQuery.trim().toLowerCase()
      return (
        q === '' ||
        row.name.toLowerCase().includes(q) ||
        (row.gstin ?? '').toLowerCase().includes(q)
      )
    })
    .slice(0, 8)
  const godown = godowns.find((row) => row.id === godownId) ?? godowns[0]

  const packs = useQuery(
    ['tenantCatalog', 'packConfigs', supplierId ?? 'none'],
    () => api.api.tenantCatalog.packConfigs.list({ supplierId: supplierId ?? '', limit: 500 }),
    { enabled: supplierId !== null, staleTime: 300_000 },
  )

  // ------------------------------------------------------------------ one line at a time, in a sheet
  const [editing, setEditing] = useState<DraftLine | null>(null)
  const [editingIsNew, setEditingIsNew] = useState(false)
  const [lineTried, setLineTried] = useState(false)
  const [itemQuery, setItemQuery] = useState('')
  const itemHits = useQuery(
    ['tenantCatalog', 'list', 'bill', itemQuery.trim()],
    () => api.api.tenantCatalog.list({ q: itemQuery.trim(), limit: 20, listedOnly: false }),
    { enabled: editing !== null && itemQuery.trim().length >= 2 },
  )

  // ------------------------------------------------------------------ GST from the HSN, dated to the bill
  const billIso = parseDate(billDate) ?? today
  const codes = useMemo(
    () =>
      [
        ...new Set(
          [...lines, ...(editing === null ? [] : [editing])]
            .map((line) => line.hsnCode)
            .filter((code): code is string => code !== null && HSN_RE.test(code)),
        ),
      ].sort(),
    [lines, editing],
  )
  const hsn = useQuery(
    ['catalog', 'hsnRates', codes.join(','), billIso],
    () => api.api.catalog.hsnRates({ codes: codes.join(','), on: billIso }),
    { enabled: codes.length > 0, staleTime: 300_000 },
  )
  const rates = useMemo(() => {
    const map = new Map<string, HsnRateLike>()
    for (const row of hsn.data?.items ?? []) map.set(row.hsnCode, row)
    return map
  }, [hsn.data])

  const draft = {
    supplierId,
    supplierState,
    billNo,
    billDate,
    printedTotalPaise: printedTotal,
    lines,
  }
  const totals = billTotals(draft, rates, ourState)
  const problems = billProblems(draft, rates, ourState, today)
  const firstProblem = problems[0]

  // ------------------------------------------------------------------ the two writes
  const create = useMutation(
    (body: CreateBody, meta) =>
      api.api.procurement.supplierInvoices.create({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        ...body,
      }),
    { invalidates: [['procurement']] },
  )
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
  const [confirming, setConfirming] = useState(false)
  const [booked, setBooked] = useState<Booked | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  const sendToGate = async (bill: Booked): Promise<void> => {
    if (godown === undefined) return
    const opened = await openGrn.mutateAsync({ supplierInvoiceId: bill.id, locationId: godown.id })
    setReceipt({
      id: opened.item.id,
      locationId: opened.item.locationId,
      lineCount: opened.item.lineCount,
    })
    setConfirming(false)
  }

  const book = (): void => {
    if (problems.length > 0) return
    const run = async (): Promise<void> => {
      let bill = booked
      if (bill === null) {
        const made = await create.mutateAsync(createBody(draft, rates, ourState))
        bill = {
          id: made.item.id,
          invoiceNo: made.item.invoiceNo,
          totalPaise: made.item.totalPaise,
        }
        setBooked(bill)
      }
      await sendToGate(bill)
    }
    // A refusal stays on its mutation and <Refusal> prints it; every figure stays in the form.
    void run().catch(() => undefined)
  }

  const startOver = (): void => {
    setSupplierId(null)
    setSupplierQuery('')
    setBillNo('')
    setBillDate(showDate(today))
    setPrintedTotal(null)
    setLines([])
    setTried(false)
    setBooked(null)
    setReceipt(null)
    create.reset()
    openGrn.reset()
  }

  const editLine = (line: DraftLine, isNew: boolean): void => {
    setEditing(line)
    setEditingIsNew(isNew)
    setLineTried(false)
    setItemQuery('')
  }
  const editingProblems = editing === null ? [] : lineProblems(editing, rateFor(editing, rates))
  const lineError = (problem: LineProblem): string | undefined =>
    lineTried && editingProblems.includes(problem) ? t(LINE_PROBLEM_KEY[problem]) : undefined
  const keepLine = (): void => {
    if (editing === null) return
    setLineTried(true)
    if (editingProblems.length > 0) return
    setLines((held) =>
      held.some((line) => line.id === editing.id)
        ? held.map((line) => (line.id === editing.id ? editing : line))
        : [...held, editing],
    )
    setEditing(null)
  }

  if (!can('procurement.supplierInvoices.create')) {
    return (
      <Screen title={t('m4n.title')}>
        <Txt field="body" desk="body" color={colors.text.secondary}>
          {t('m4n.notYours')}
        </Txt>
      </Screen>
    )
  }

  // ------------------------------------------------------------------ booked: the outcome, from the 2xx
  if (booked !== null) {
    return (
      <Screen
        title={t('m4n.title')}
        chips={
          <PageTabs
            group={routeFor('manager', '/inbound')}
            active={routeFor('manager', '/inbound')}
          />
        }
      >
        <Panel title={t('m4n.bookedTitle', { no: booked.invoiceNo })} testID="bill-booked">
          <Stack gap={4}>
            <Txt field="body" desk="body" color={colors.status.moss.fg} testID="bill-booked-line">
              {t('m4n.booked', {
                no: booked.invoiceNo,
                supplier: supplier?.name ?? '—',
              })}
            </Txt>
            <Field label={t('m4.value')}>
              <Money value={booked.totalPaise} size="moneyM" />
            </Field>
            {receipt === null ? (
              <Stack gap={3} testID="bill-receipt-missing">
                <Txt field="body" desk="body" color={colors.status.brick.fg}>
                  {t('m4n.receiptNotOpen')}
                </Txt>
                <Refusal of={[openGrn]} testID="bill-receipt-refusal" />
                <Button
                  label={t('m4n.sendToGate')}
                  variant="primary"
                  loading={openGrn.status === 'pending'}
                  disabled={godown === undefined}
                  {...(godown === undefined ? { disabledReason: t('m4n.noGodown') } : {})}
                  onPress={() => {
                    void sendToGate(booked).catch(() => undefined)
                  }}
                  testID="bill-send-to-gate"
                />
              </Stack>
            ) : (
              <Txt field="body" desk="body" testID="bill-receipt-open">
                {t('m4n.atTheGate', {
                  lines: receipt.lineCount,
                  godown: godown?.name ?? '—',
                })}
              </Txt>
            )}
            <Row gap={3} wrap>
              <Button
                label={t('m4n.seeReceipts')}
                variant="secondary"
                onPress={() => {
                  router.push(`${routeFor('manager', '/inbound')}?view=receipts`)
                }}
                testID="bill-see-receipts"
              />
              <Button
                label={t('m4n.another')}
                variant="ghost"
                onPress={startOver}
                testID="bill-another"
              />
            </Row>
          </Stack>
        </Panel>
      </Screen>
    )
  }

  // ------------------------------------------------------------------ the form
  return (
    <Screen
      title={t('m4n.title')}
      chips={
        <PageTabs
          group={routeFor('manager', '/inbound')}
          active={routeFor('manager', '/inbound')}
        />
      }
      bottomBar={
        <Row justify="between" align="center" gap={4} wrap>
          <Stack gap={1}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('m4n.billTotal')}
            </Txt>
            <Money value={totals.totalPaise} size="moneyM" testID="bill-total" />
          </Stack>
          <Button
            label={t('m4n.book')}
            variant="primary"
            disabled={firstProblem !== undefined}
            {...(firstProblem === undefined
              ? {}
              : {
                  disabledReason: t(BILL_PROBLEM_KEY[firstProblem], {
                    lines: (totals.linesTotalPaise / 100).toFixed(2),
                  }),
                })}
            onPress={() => {
              setTried(true)
              setConfirming(true)
            }}
            testID="bill-book"
          />
        </Row>
      }
    >
      <Stack gap={6}>
        <Txt field="body" desk="body" color={colors.text.secondary}>
          {t('m4n.hint')}
        </Txt>

        <Columns>
          <Half>
            <Panel title={t('m4n.supplierTitle')} testID="bill-supplier">
              {supplier === undefined ? (
                <Search
                  testID="bill-supplier-search"
                  value={supplierQuery}
                  onChange={setSupplierQuery}
                  placeholder={t('m4n.pickSupplier')}
                  state={
                    suppliers.isLoading
                      ? 'typing'
                      : supplierHits.length === 0
                        ? 'noResults'
                        : 'results'
                  }
                >
                  {supplierHits.map((row) => (
                    <ListRow
                      key={row.id}
                      testID={`bill-supplier-${row.id}`}
                      primary={row.name}
                      secondary={row.gstin ?? t('m4n.noGstin')}
                      onPress={() => {
                        setSupplierId(row.id)
                      }}
                    />
                  ))}
                </Search>
              ) : (
                <Stack gap={2}>
                  <Field label={t('m4.supplier')}>{supplier.name}</Field>
                  <Txt
                    field="label"
                    desk="meta"
                    color={colors.text.secondary}
                    testID="bill-tax-kind"
                  >
                    {[
                      supplier.gstin ?? t('m4n.noGstin'),
                      supplierState === null || ourState === null || supplierState === ourState
                        ? t('m4n.intra')
                        : t('m4n.inter'),
                    ].join(' · ')}
                  </Txt>
                  <Button
                    label={t('m4n.changeSupplier')}
                    variant="ghost"
                    onPress={() => {
                      setSupplierId(null)
                    }}
                    testID="bill-supplier-change"
                  />
                </Stack>
              )}
              {tried && supplierId === null ? (
                <Txt field="label" desk="meta" color={colors.status.brick.fg}>
                  {t('m4n.needSupplier')}
                </Txt>
              ) : null}
            </Panel>
          </Half>
          <Half>
            <Panel title={t('m4n.billTitle')}>
              <TextInput
                label={t('m4.invoiceNo')}
                value={billNo}
                onChange={setBillNo}
                maxLength={40}
                {...(tried && billNo.trim() === '' ? { error: t('m4n.needBillNo') } : {})}
                testID="bill-no"
              />
              <TextInput
                label={t('m4.invoiceDate')}
                value={billDate}
                onChange={setBillDate}
                helper={t('m4n.dateHelper')}
                maxLength={10}
                {...(parseDate(billDate) === null
                  ? { error: t('m4n.needBillDate') }
                  : billIso > today
                    ? { error: t('m4n.futureDate') }
                    : {})}
                testID="bill-date"
              />
              <RupeeInput
                label={t('m4n.printedTotal')}
                value={printedTotal}
                onChange={setPrintedTotal}
                helper={t('m4n.printedTotalHelper')}
                {...(problems.includes('total')
                  ? {
                      error: t('m4n.totalMismatch', {
                        lines: (totals.linesTotalPaise / 100).toFixed(2),
                      }),
                    }
                  : {})}
                testID="bill-printed-total"
              />
              {godowns.length > 1 ? (
                <Field label={t('m4n.godown')}>
                  <Chips
                    testID="bill-godown"
                    items={godowns.map((row) => ({
                      id: row.id,
                      label: row.name,
                      selected: row.id === godown?.id,
                    }))}
                    onToggle={setGodownId}
                  />
                </Field>
              ) : null}
            </Panel>
          </Half>
        </Columns>

        <Panel
          title={t('m4n.linesTitle')}
          meta={t('m4n.linesMeta', { count: lines.length })}
          actions={
            <Button
              label={t('m4n.addLine')}
              variant={lines.length === 0 ? 'primary' : 'secondary'}
              onPress={() => {
                editLine(blankLine(), true)
              }}
              testID="bill-add-line"
            />
          }
          testID="bill-lines"
        >
          {lines.length === 0 ? (
            <Txt field="body" desk="body" color={colors.text.secondary}>
              {t('m4n.noLines')}
            </Txt>
          ) : (
            <Group>
              {lines.map((line, index) => {
                const rate = rateFor(line, rates)
                const f = lineFigures(line, rate, supplierState, ourState)
                const bad = lineProblems(line, rate)
                const life = shelfLifeDays(line, billIso)
                return (
                  <ListRow
                    key={line.id}
                    testID={`bill-line-${String(index + 1)}`}
                    primary={line.name}
                    secondary={[
                      line.batchNo.trim() === '' ? t('m4n.noBatch') : line.batchNo.trim(),
                      life === null
                        ? t('m4n.noExpiry')
                        : life <= 0
                          ? t('m4n.expired')
                          : t('m4n.lifeLeft', { days: life }),
                      line.unit === 'cs'
                        ? t('m4n.casesAndPieces', { qty: line.qty, pieces: f.pieces })
                        : t('m4n.pieces', { pieces: f.pieces }),
                      f.gstBps === null
                        ? t('m4n.gstMissing')
                        : t('m4n.gstAt', { rate: bpsToPercent(f.gstBps) }),
                    ].join(' · ')}
                    trailing={
                      bad.length > 0 ? (
                        <StatusChip label={t(LINE_PROBLEM_KEY[bad[0] ?? 'item'])} family="brick" />
                      ) : (
                        <Money value={f.lineTotalPaise} size="cell" />
                      )
                    }
                    state={bad.length > 0 ? 'needsAttention' : 'default'}
                    onPress={() => {
                      editLine(line, false)
                    }}
                  />
                )
              })}
            </Group>
          )}
        </Panel>

        <Panel title={t('m4n.totalsTitle')} testID="bill-totals">
          <Stack gap={2}>
            <Row justify="between">
              <Txt field="body" desk="body">
                {t('m4n.taxable')}
              </Txt>
              <Money value={totals.subtotalPaise} size="cell" />
            </Row>
            {totals.igstPaise > 0 ? (
              <Row justify="between">
                <Txt field="body" desk="body">
                  {t('m4n.igst')}
                </Txt>
                <Money value={totals.igstPaise} size="cell" />
              </Row>
            ) : (
              <>
                <Row justify="between">
                  <Txt field="body" desk="body">
                    {t('m4n.cgst')}
                  </Txt>
                  <Money value={totals.cgstPaise} size="cell" />
                </Row>
                <Row justify="between">
                  <Txt field="body" desk="body">
                    {t('m4n.sgst')}
                  </Txt>
                  <Money value={totals.sgstPaise} size="cell" />
                </Row>
              </>
            )}
            {totals.cessPaise > 0 ? (
              <Row justify="between">
                <Txt field="body" desk="body">
                  {t('m4n.cess')}
                </Txt>
                <Money value={totals.cessPaise} size="cell" />
              </Row>
            ) : null}
            <Row justify="between">
              <Txt field="body" desk="body">
                {t('m4n.roundOff')}
              </Txt>
              <Money value={totals.roundOffPaise} size="cell" />
            </Row>
            <Row justify="between">
              <Txt field="title" desk="section">
                {t('m4n.billTotal')}
              </Txt>
              <Money value={totals.totalPaise} size="moneyM" />
            </Row>
          </Stack>
        </Panel>
      </Stack>

      {/* ------------------------------------------------------------ the line sheet */}
      <Sheet
        open={editing !== null}
        onClose={() => {
          setEditing(null)
        }}
        title={editingIsNew ? t('m4n.addLine') : t('m4n.editLine')}
        testID="bill-line-sheet"
      >
        {editing === null ? null : (
          <Stack gap={4}>
            {editing.variantId === null ? (
              <Stack gap={1}>
                <Search
                  testID="bill-item-search"
                  value={itemQuery}
                  onChange={setItemQuery}
                  placeholder={t('m4n.pickItem')}
                  state={
                    itemQuery.trim().length < 2
                      ? 'idle'
                      : itemHits.isFetching
                        ? 'typing'
                        : (itemHits.data?.items.length ?? 0) === 0
                          ? 'noResults'
                          : 'results'
                  }
                >
                  {(itemHits.data?.items ?? []).map((row) => (
                    <ListRow
                      key={row.variantId}
                      testID={`bill-item-${row.variantId}`}
                      primary={row.name}
                      secondary={[
                        row.brandName ?? row.manufacturerName,
                        t('m4n.hsn', { hsn: row.hsnCode }),
                      ].join(' · ')}
                      onPress={() => {
                        const pack = packs.data?.items.find((p) => p.variantId === row.variantId)
                        setEditing({
                          ...editing,
                          variantId: row.variantId,
                          name: row.name,
                          hsnCode: row.hsnCode,
                          variantMrpPaise: row.mrpPaise,
                          mrpPaise: row.mrpPaise,
                          caseSize: pack?.pcsPerCase ?? row.defaultCaseSize,
                        })
                      }}
                    />
                  ))}
                </Search>
                {lineError('item') === undefined ? null : (
                  <Txt field="label" desk="meta" color={colors.status.brick.fg}>
                    {lineError('item')}
                  </Txt>
                )}
              </Stack>
            ) : (
              <Stack gap={2}>
                <Field label={t('m4n.item')}>{editing.name}</Field>
                <Txt
                  field="label"
                  desk="meta"
                  color={colors.text.secondary}
                  testID="bill-item-facts"
                >
                  {t('m4n.itemFacts', {
                    hsn: editing.hsnCode ?? '—',
                    size: editing.caseSize,
                  })}
                </Txt>
                <Button
                  label={t('m4n.changeItem')}
                  variant="ghost"
                  onPress={() => {
                    setEditing({ ...editing, variantId: null })
                  }}
                  testID="bill-item-change"
                />
              </Stack>
            )}

            <Stack gap={4}>
              <TextInput
                label={t('m4n.batch')}
                value={editing.batchNo}
                onChange={(value) => {
                  setEditing({ ...editing, batchNo: value })
                }}
                maxLength={40}
                testID="bill-line-batch"
              />

              <TextInput
                label={t('m4n.expiry')}
                value={editing.expiry}
                onChange={(value) => {
                  setEditing({ ...editing, expiry: value })
                }}
                maxLength={10}
                {...(lineError('expiry') === undefined
                  ? (() => {
                      const life = shelfLifeDays(editing, billIso)
                      return {
                        helper:
                          life === null
                            ? t('m4n.dateHelper')
                            : life <= 0
                              ? t('m4n.expired')
                              : t('m4n.lifeLeft', { days: life }),
                      }
                    })()
                  : { error: lineError('expiry') })}
                testID="bill-line-expiry"
              />
            </Stack>

            <Stack gap={2}>
              <Segments
                testID="bill-line-unit"
                value={editing.unit}
                onChange={(id) => {
                  setEditing({ ...editing, unit: id as 'pcs' | 'cs' })
                }}
                items={[
                  { id: 'cs', label: t('m4n.inCases') },
                  { id: 'pcs', label: t('m4n.inPieces') },
                ]}
              />
              <Stack gap={4}>
                <TextInput
                  label={editing.unit === 'cs' ? t('m4n.qtyCases') : t('m4n.qtyPieces')}
                  value={editing.qty}
                  onChange={(value) => {
                    setEditing({ ...editing, qty: value })
                  }}
                  keyboard="decimal"
                  maxLength={7}
                  {...(lineError('qty') === undefined
                    ? {
                        helper:
                          editing.unit === 'cs'
                            ? t('m4n.pieces', {
                                pieces: lineFigures(editing, undefined, null, null).pieces,
                              })
                            : '',
                      }
                    : { error: lineError('qty') })}
                  testID="bill-line-qty"
                />

                <TextInput
                  label={t('m4n.free')}
                  value={editing.freePcs}
                  onChange={(value) => {
                    setEditing({ ...editing, freePcs: value })
                  }}
                  keyboard="decimal"
                  maxLength={7}
                  {...(lineError('free') === undefined ? {} : { error: lineError('free') })}
                  testID="bill-line-free"
                />
              </Stack>
            </Stack>

            <Stack gap={2}>
              <Segments
                testID="bill-line-basis"
                value={editing.rateBasis}
                onChange={(id) => {
                  setEditing({ ...editing, rateBasis: id as 'piece' | 'case' })
                }}
                items={[
                  { id: 'case', label: t('m4n.perCase') },
                  { id: 'piece', label: t('m4n.perPiece') },
                ]}
              />
              <Stack gap={4}>
                <RupeeInput
                  label={editing.rateBasis === 'case' ? t('m4n.rateCase') : t('m4n.ratePiece')}
                  value={editing.ratePaise}
                  onChange={(value) => {
                    setEditing({ ...editing, ratePaise: value })
                  }}
                  {...((lineError('rate') ?? lineError('caseRate'))
                    ? { error: lineError('rate') ?? lineError('caseRate') }
                    : { helper: t('m4n.rateHelper') })}
                  testID="bill-line-rate"
                />

                <TextInput
                  label={t('m4n.gst')}
                  value={editing.gstText}
                  onChange={(value) => {
                    setEditing({ ...editing, gstText: value })
                  }}
                  keyboard="decimal"
                  maxLength={6}
                  placeholder={(() => {
                    const rate = rateFor(editing, rates)
                    return rate === undefined ? '' : bpsToPercent(rate.gstBps)
                  })()}
                  {...(lineError('gst') === undefined
                    ? {
                        helper: (() => {
                          const rate = rateFor(editing, rates)
                          if (editing.hsnCode === null) return ''
                          if (hsn.isLoading) return t('m4n.gstLoading')
                          return rate === undefined
                            ? t('m4n.gstNoRate', { hsn: editing.hsnCode })
                            : t('m4n.gstFromHsn', {
                                hsn: editing.hsnCode,
                                rate: bpsToPercent(rate.gstBps),
                              })
                        })(),
                      }
                    : {
                        error:
                          editing.hsnCode === null
                            ? lineError('gst')
                            : t('m4n.gstNoRate', { hsn: editing.hsnCode }),
                      })}
                  testID="bill-line-gst"
                />
              </Stack>
            </Stack>

            <RupeeInput
              label={t('m4n.mrp')}
              value={editing.mrpPaise}
              onChange={(value) => {
                setEditing({ ...editing, mrpPaise: value })
              }}
              {...(lineError('mrp') === undefined
                ? { helper: t('m4n.mrpHelper') }
                : { error: lineError('mrp') })}
              testID="bill-line-mrp"
            />

            {(() => {
              const f = lineFigures(editing, rateFor(editing, rates), supplierState, ourState)
              return (
                <Row justify="between" align="center" gap={3} wrap testID="bill-line-figures">
                  <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                    {t('m4n.lineFigures', {
                      pieces: f.pieces,
                      taxable: (f.taxablePaise / 100).toFixed(2),
                      tax: (f.taxPaise / 100).toFixed(2),
                    })}
                  </Txt>
                  <Money value={f.lineTotalPaise} size="moneyM" />
                </Row>
              )
            })()}

            <Row gap={3} wrap>
              <Button
                label={t('m4n.keepLine')}
                variant="primary"
                onPress={keepLine}
                testID="bill-line-keep"
              />
              {editingIsNew ? null : (
                <Button
                  label={t('m4n.removeLine')}
                  variant="destructive"
                  onPress={() => {
                    setLines((held) => held.filter((line) => line.id !== editing.id))
                    setEditing(null)
                  }}
                  testID="bill-line-remove"
                />
              )}
            </Row>
            {lineTried && editingProblems.length > 0 ? (
              <Txt
                field="label"
                desk="meta"
                color={colors.status.brick.fg}
                testID="bill-line-problems"
              >
                {editingProblems.map((problem) => t(LINE_PROBLEM_KEY[problem])).join(' · ')}
              </Txt>
            ) : null}
          </Stack>
        )}
      </Sheet>

      {/* ------------------------------------------------------------ what will be written */}
      <Dialog
        open={confirming}
        onClose={() => {
          setConfirming(false)
        }}
        title={t('m4n.book')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body" testID="bill-confirm-summary">
              {t('m4n.confirm', {
                no: billNo.trim(),
                supplier: supplier?.name ?? '—',
                lines: lines.length,
                godown: godown?.name ?? '—',
              })}
            </Txt>
            <Money value={totals.totalPaise} size="moneyM" />
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('m4n.confirmBody')}
            </Txt>
            <Refusal of={[create, openGrn]} testID="bill-refusal" />
          </Stack>
        }
        confirmLabel={t('m4n.book')}
        busy={create.status === 'pending' || openGrn.status === 'pending'}
        onConfirm={book}
        testID="bill-dialog"
      />
    </Screen>
  )
}
