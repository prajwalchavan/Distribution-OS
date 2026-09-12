/**
 * M7 — load-out and challans, and the founder's own decision about where the PIN is given
 * (docs/22 §8, 2026-09-05: "the manager approves the load sheet from their own phone or desk; the
 * warehouse device waits for it", NOT typed on the warehouse phone).
 *
 * How that decision is actually built (warehouse contract §2b): `loadSheets.approve` is PIN_HOLDERS
 * (owner + manager) and stamps `approvedBy` / `approvedAt`; `loadSheets.confirm` — which the
 * warehouse phone may call — refuses an unapproved sheet with 409 `approval_required`, and when the
 * crew's count differs from `expectedPackages` it records `pinVerifiedBy = approvedBy`. So the
 * MANAGER WHO APPROVES OWNS THE VARIANCE, and there is no PIN field anywhere: the manager's own
 * signed-in identity is the PIN. `auth.stepUp` was deliberately not built, so this screen must not
 * draw a PIN box it would have to invent a value for.
 *
 * The sheet is built last-stop-first — the order ids are used in the order the caller supplies — so
 * the first shop of the round is loaded last and comes off the tail of the van first.
 *
 * The e-way bill number is TYPED from the government portal (`challans.recordEwb`); nothing here
 * calls the portal.
 */
import type { DeliveryChallanSummary, LoadSheetSummary } from '@dos/contracts'
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
  useColors,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { documents } from '@dos/ui/platform'
import { useState } from 'react'

import {
  Async,
  Field,
  PageTabs,
  Panel,
  countText,
  moneyColumn,
  pagedCount,
  textColumn,
  useCan,
  useNames,
} from '../../src/lib/ui'
import { absoluteUrl } from '../../src/config'
import { shortDate, shortInstant } from '../../src/lib/dates'
import { loadOutHistory, loadOutQueue } from '../../src/lib/load-out'
import { useWord } from '../../src/lib/words'

const SHEET_FAMILY: Readonly<Record<string, StatusFamily>> = {
  draft: 'ochre',
  confirmed: 'moss',
  cancelled: 'neutral',
}

export default function LoadOut(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const mayApprove = can('warehouse.loadSheets.approve')
  const mayRecordEwb = can('warehouse.challans.recordEwb')
  const [view, setView] = useState<'sheets' | 'challans'>('sheets')
  const [selected, setSelected] = useState<string | null>(null)
  const [acting, setActing] = useState<'approve' | 'cancel' | null>(null)
  const [note, setNote] = useState('')
  const [ewbFor, setEwbFor] = useState<string | null>(null)
  const [ewbNo, setEwbNo] = useState('')

  const sheets = useQuery(['warehouse', 'loadSheets'], () =>
    api.api.warehouse.loadSheets.list({ limit: 100 }),
  )
  /*
   * DOS-025: the sheets not out of the godown yet are their own read. `desc(id)` sinks a draft under
   * any sheet built after it, and one older than the newest hundred is never on the page above. The
   * key starts with 'warehouse', so approving or cancelling a sheet refetches this read too.
   */
  const waiting = useQuery(['warehouse', 'loadSheets', 'draft'], () =>
    api.api.warehouse.loadSheets.list({ status: 'draft', limit: 100 }),
  )
  const detail = useQuery(
    ['warehouse', 'loadSheets', 'get', selected ?? 'none'],
    () => api.api.warehouse.loadSheets.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const sheet = detail.data?.item

  const challans = useQuery(
    ['warehouse', 'challans'],
    () => api.api.warehouse.challans.list({ limit: 100 }),
    { enabled: view === 'challans' },
  )

  const approve = useMutation(
    (input: { id: string; note: string }, meta) =>
      api.api.warehouse.loadSheets.approve({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
        ...(input.note === '' ? {} : { note: input.note }),
      }),
    { invalidates: [['warehouse']] },
  )
  const cancelSheet = useMutation(
    (input: { id: string; reason: string }, meta) =>
      api.api.warehouse.loadSheets.cancel({
        id: input.id,
        reason: input.reason,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['warehouse'], ['orders']] },
  )
  const recordEwb = useMutation(
    (input: { id: string; ewbNo: string }, meta) =>
      api.api.warehouse.challans.recordEwb({
        id: input.id,
        ewbNo: input.ewbNo,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['warehouse']] },
  )

  const rows = sheets.data?.items ?? []
  const queue = loadOutQueue(waiting.data?.items ?? [])
  const history = loadOutHistory(rows)

  const sheetColumns: readonly RegisterColumn<LoadSheetSummary>[] = [
    textColumn('date', t('m7.sheetDate'), (row) => shortDate(row.sheetDate), {
      priority: 'identity',
    }),
    textColumn('vehicle', t('m7.vehicle'), (row) => row.vehicleRegNo),
    {
      key: 'status',
      head: t('m7.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={
            row.status === 'draft' && row.approvedAt === null
              ? t('m7.waitingForYou')
              : row.status === 'draft'
                ? t('m7.approved')
                : word(row.status)
          }
          family={
            row.status === 'draft' && row.approvedAt === null
              ? 'clay'
              : (SHEET_FAMILY[row.status] ?? 'neutral')
          }
        />
      ),
    },
    textColumn('orders', t('m7.orders'), (row) => row.orderCount, { align: 'right' }),
    textColumn('packages', t('m7.packages'), (row) => row.expectedPackages, { align: 'right' }),
    textColumn('counted', t('m7.counted'), (row) => row.countedPackages, { align: 'right' }),
    moneyColumn('value', t('m7.loadValue'), (row) => row.loadValuePaise),
    textColumn('challan', t('m7.challanNo'), (row) => row.challanNo),
  ]

  const challanColumns: readonly RegisterColumn<DeliveryChallanSummary>[] = [
    textColumn('challanNo', t('m7.challanNo'), (row) => row.challanNo, { priority: 'identity' }),
    textColumn('date', t('m7.sheetDate'), (row) => shortDate(row.challanDate)),
    textColumn('vehicle', t('m7.vehicle'), (row) => row.vehicleNo),
    textColumn('ewb', t('m7.ewbNo'), (row) => row.ewbNo, { priority: 'chip' }),
    moneyColumn('value', t('m7.loadValue'), (row) => row.valuePaise),
  ]

  const commit = (): void => {
    if (selected === null || acting === null) return
    const done = (): void => {
      setActing(null)
      setNote('')
    }
    if (acting === 'approve')
      void approve.mutateAsync({ id: selected, note: note.trim() }).then(done, done)
    if (acting === 'cancel')
      void cancelSheet.mutateAsync({ id: selected, reason: note.trim() }).then(done, done)
  }

  return (
    <Screen
      title={t('m7.title')}
      chips={<PageTabs group="/fulfilment" active="/fulfilment/load-out" />}
      actions={
        <Segments
          testID="loadout-view"
          value={view}
          onChange={(id) => {
            setView(id as 'sheets' | 'challans')
          }}
          items={[
            { id: 'sheets', label: t('m7.sheets') },
            { id: 'challans', label: t('m7.challans') },
          ]}
        />
      }
    >
      <Stack gap={4}>
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('m7.pinHint')}
        </Txt>

        {view === 'sheets' ? (
          <Stack gap={6}>
            <Panel title={t('m7.waiting')} testID="loadout-waiting">
              <Async
                state={[waiting]}
                rows={3}
                empty={queue.length === 0}
                emptyMessage={t('m7.waitingEmpty')}
              >
                <Register
                  testID="loadsheet-waiting-register"
                  columns={sheetColumns}
                  rows={queue}
                  rowKey={(row) => row.id}
                  frozen="date"
                  selectedKey={selected}
                  onSelect={(row) => {
                    setSelected(row.id)
                  }}
                  state="ready"
                  totals={{ date: countText(pagedCount(waiting), t('app.none')) }}
                />
              </Async>
            </Panel>

            <Panel title={t('m7.history')}>
              <Async
                state={[sheets]}
                rows={8}
                empty={history.length === 0}
                emptyMessage={t('m7.empty')}
              >
                <Register
                  testID="loadsheet-register"
                  columns={sheetColumns}
                  rows={history}
                  rowKey={(row) => row.id}
                  frozen="date"
                  selectedKey={selected}
                  onSelect={(row) => {
                    setSelected(row.id)
                  }}
                  state="ready"
                  totals={{ date: t('app.rows', { count: history.length }) }}
                />
              </Async>
            </Panel>
          </Stack>
        ) : (
          <Async
            state={[challans]}
            rows={8}
            empty={(challans.data?.items.length ?? 0) === 0}
            emptyMessage={t('m7.empty')}
          >
            <Register
              testID="challan-register"
              columns={challanColumns}
              rows={challans.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="challanNo"
              onSelect={
                mayRecordEwb
                  ? (row) => {
                      setEwbFor(row.id)
                      setEwbNo(row.ewbNo ?? '')
                    }
                  : undefined
              }
              state="ready"
            />
          </Async>
        )}
      </Stack>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={
          sheet === undefined
            ? undefined
            : t('m7.detail', { vehicle: sheet.vehicleRegNo ?? t('app.none') })
        }
        testID="loadsheet-panel"
      >
        <Async state={[detail]} rows={6}>
          {sheet === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('m7.status')}>
                <StatusChip
                  label={
                    sheet.status === 'draft' && sheet.approvedAt === null
                      ? t('m7.waitingForYou')
                      : sheet.status === 'draft'
                        ? t('m7.approved')
                        : word(sheet.status)
                  }
                  family={
                    sheet.status === 'draft' && sheet.approvedAt === null
                      ? 'clay'
                      : (SHEET_FAMILY[sheet.status] ?? 'neutral')
                  }
                />
              </Field>
              <Field label={t('m7.from')}>{names.location(sheet.fromLocationId)}</Field>
              <Field label={t('m7.to')}>{names.location(sheet.toLocationId)}</Field>
              <Field label={t('m7.packages')}>{String(sheet.expectedPackages)}</Field>
              <Field label={t('m7.orders')}>{String(sheet.orderCount)}</Field>
              <Field label={t('m7.loadValue')}>
                <Money value={sheet.loadValuePaise} size="moneyM" />
              </Field>
              {sheet.approvedAt === null ? null : (
                <Field label={t('m7.approvedBy', { name: names.staff(sheet.approvedBy) })}>
                  {shortInstant(sheet.approvedAt)}
                </Field>
              )}
              {sheet.confirmedAt === null ? null : (
                <Field label={t('m7.confirmedAt')}>{shortInstant(sheet.confirmedAt)}</Field>
              )}
              {sheet.ewbRequired ? (
                <Field label={t('m7.ewbRequired')}>{sheet.ewbNo ?? t('app.none')}</Field>
              ) : null}

              <Panel title={t('m7.orders')}>
                <Stack gap={2}>
                  {sheet.orders.map((order) => (
                    <Stack key={order.orderId} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {`${String(order.stopSequence)}. ${order.retailerName}`}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary}>
                        {/* An order on a draft sheet may not be billed yet; that is a state, not
                            the billing desk's empty message. */}
                        {`${order.orderNo ?? ''} · ${order.invoiceNo ?? t('m7.noBill')}`}
                      </Txt>
                    </Stack>
                  ))}
                </Stack>
              </Panel>

              {mayApprove ? (
                <Stack gap={3}>
                  <Button
                    label={t('m7.approve')}
                    variant="primary"
                    disabled={sheet.status !== 'draft' || sheet.approvedAt !== null}
                    disabledReason={t('m7.alreadyApproved')}
                    onPress={() => {
                      setActing('approve')
                    }}
                    testID="loadsheet-approve"
                  />
                  <Button
                    label={t('m7.cancelSheet')}
                    variant="destructive"
                    disabled={sheet.status !== 'draft'}
                    disabledReason={t('m7.onlyDraft')}
                    onPress={() => {
                      setActing('cancel')
                    }}
                    testID="loadsheet-cancel"
                  />
                </Stack>
              ) : (
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {t('app.accountantRead')}
                </Txt>
              )}

              {sheet.challan === null ? null : (
                <Button
                  label={t('m7.printChallan')}
                  variant="secondary"
                  onPress={() => {
                    void api.api.warehouse.challans
                      .pdf({ id: sheet.challan?.id ?? '' })
                      .then((result) => {
                        const url = absoluteUrl(result.url)
                        if (url !== null) void documents.open(url)
                      })
                  }}
                  testID="challan-print"
                />
              )}
            </Stack>
          )}
        </Async>
      </Sheet>

      <Dialog
        open={acting !== null}
        onClose={() => {
          setActing(null)
        }}
        title={acting === 'approve' ? t('m7.approveTitle') : t('m7.cancelSheet')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {sheet?.vehicleRegNo ?? ''}
            </Txt>
            <Txt field="body" desk="body" numeric>
              {`${String(sheet?.expectedPackages ?? 0)} ${t('m7.packages')}`}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {acting === 'approve' ? t('m7.pinBody') : ''}
            </Txt>
            <TextInput
              label={acting === 'approve' ? t('m7.approveNote') : t('m7.cancelReason')}
              value={note}
              onChange={setNote}
              capitalize="sentences"
              testID="loadsheet-note"
            />
          </Stack>
        }
        confirmLabel={acting === 'approve' ? t('m7.approve') : t('m7.cancelSheet')}
        destructive={acting === 'cancel'}
        busy={approve.status === 'pending' || cancelSheet.status === 'pending'}
        onConfirm={commit}
        testID="loadsheet-dialog"
      />

      <Dialog
        open={ewbFor !== null}
        onClose={() => {
          setEwbFor(null)
        }}
        title={t('m7.recordEwb')}
        body={
          <Stack gap={3}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('m7.ewbHint')}
            </Txt>
            <TextInput
              label={t('m7.ewbNo')}
              value={ewbNo}
              onChange={setEwbNo}
              keyboard="decimal"
              capitalize="none"
              testID="ewb-number"
            />
          </Stack>
        }
        confirmLabel={t('m7.recordEwb')}
        busy={recordEwb.status === 'pending'}
        onConfirm={() => {
          if (ewbFor === null) return
          void recordEwb.mutateAsync({ id: ewbFor, ewbNo: ewbNo.trim() }).then(
            () => {
              setEwbFor(null)
            },
            () => {
              setEwbFor(null)
            },
          )
        }}
        testID="ewb-dialog"
      />
    </Screen>
  )
}
