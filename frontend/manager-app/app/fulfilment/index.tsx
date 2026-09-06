/**
 * M5 — the fulfilment desk: the queue of confirmed orders, and the waves made from it (docs/23 §2.1).
 *
 * The manager picks the orders that go out together — by beat, by trip, or by hand — and
 * `warehouse.picklists.create` turns them into ONE picking sheet with FEFO-suggested lots. From then
 * on the sheet is the godown's; this screen watches its progress and can cancel a wave that has not
 * started, which frees its orders back to the queue.
 *
 * The queue carries **quantities only, never money**: `warehouse.queue.list` is the warehouse's own
 * read and does not serve a rupee. This screen does not add one.
 *
 * `warehouse.*` is owner + manager + warehouse in the matrix, so an accountant never reaches this
 * route and the rail does not offer it.
 */
import type { FulfilmentQueueItem, PicklistSummary } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Dialog,
  Register,
  Screen,
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
  pageTotal,
  pagedCount,
  textColumn,
  useCan,
  useNames,
} from '../../src/lib/ui'
import { shortDate, shortInstant, today } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const PICK_FAMILY: Readonly<Record<string, StatusFamily>> = {
  open: 'ochre',
  picking: 'ochre',
  picked: 'moss',
  /* `packed` means every order on the wave has a pack confirmation — the sheet is finished. */
  packed: 'moss',
  cancelled: 'neutral',
}

export default function Fulfilment(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const mayWave = can('warehouse.picklists.create')
  const [picked, setPicked] = useState<readonly string[]>([])
  const [beat, setBeat] = useState<string | null>(null)
  const [openSheet, setOpenSheet] = useState<string | null>(null)
  const [acting, setActing] = useState<'wave' | 'start' | 'cancel' | null>(null)
  const [reason, setReason] = useState('')

  const queue = useQuery(['warehouse', 'queue'], () => api.api.warehouse.queue.list({ limit: 200 }))
  const sheets = useQuery(['warehouse', 'picklists'], () =>
    api.api.warehouse.picklists.list({ limit: 50 }),
  )
  const detail = useQuery(
    ['warehouse', 'picklists', 'get', openSheet ?? 'none'],
    () => api.api.warehouse.picklists.get({ id: openSheet ?? '' }),
    { enabled: openSheet !== null },
  )
  const sheet = detail.data?.item

  const createWave = useMutation(
    (input: { orderIds: readonly string[]; beatId: string | null }, meta) =>
      api.api.warehouse.picklists.create({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        orderIds: [...input.orderIds],
        pickDate: today(),
        ...(input.beatId === null ? {} : { beatId: input.beatId }),
      }),
    { invalidates: [['warehouse'], ['orders']] },
  )
  const startPick = useMutation(
    (id: string, meta) =>
      api.api.warehouse.picklists.start({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['warehouse'], ['orders']] },
  )
  const cancelWave = useMutation(
    (input: { id: string; reason: string }, meta) =>
      api.api.warehouse.picklists.cancel({
        id: input.id,
        reason: input.reason,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['warehouse'], ['orders']] },
  )

  const queueRows = (queue.data?.items ?? []).filter((row) => beat === null || row.beatId === beat)
  /*
   * The beat filter is applied to THIS PAGE, so the count is the rows in front of you and the `+`
   * is the queue's own cap: "12+" reads as "twelve here and more behind the page", which is what a
   * wave is built out of. The piece total only appears once the whole queue fits (`pageTotal`).
   */
  const queuePage = { count: queueRows.length, more: pagedCount(queue).more }
  const beats = [
    ...new Map(
      (queue.data?.items ?? [])
        .filter((row) => row.beatId !== null)
        .map((row) => [row.beatId as string, row.beatName ?? names.beat(row.beatId)]),
    ),
  ]

  const selectedPieces = queueRows
    .filter((row) => picked.includes(row.orderId))
    .reduce((sum, row) => sum + row.totalQtyPcs, 0)

  const queueColumns: readonly RegisterColumn<FulfilmentQueueItem>[] = [
    textColumn('orderNo', t('m5.orderNo'), (row) => row.orderNo, { priority: 'identity' }),
    textColumn('shop', t('m5.shop'), (row) => row.retailerName),
    textColumn('beat', t('m5.beat'), (row) => row.beatName),
    textColumn('lines', t('m5.linesCount'), (row) => row.lineCount, { align: 'right' }),
    {
      key: 'pieces',
      head: t('m5.pieces'),
      align: 'right',
      priority: 'value',
      cell: (row) => (
        <Txt field="body" desk="cell" numeric>
          {String(row.totalQtyPcs)}
        </Txt>
      ),
    },
    textColumn('confirmed', t('m5.confirmedAt'), (row) => shortInstant(row.confirmedAt)),
    {
      key: 'ticked',
      head: t('m5.onSheet'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={picked.includes(row.orderId) ? t('word.yes') : t('word.no')}
          family={picked.includes(row.orderId) ? 'moss' : 'neutral'}
        />
      ),
    },
  ]

  const sheetColumns: readonly RegisterColumn<PicklistSummary>[] = [
    textColumn('pickNo', t('m5.pickNo'), (row) => row.picklistNo, { priority: 'identity' }),
    {
      key: 'status',
      head: t('m5.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.status)} family={PICK_FAMILY[row.status] ?? 'neutral'} />
      ),
    },
    textColumn('orders', t('m5.orders'), (row) => row.orderCount, { align: 'right' }),
    textColumn('requested', t('m5.requested'), (row) => row.requestedQtyPcs, { align: 'right' }),
    textColumn('picked', t('m5.picked'), (row) => row.pickedQtyPcs, {
      align: 'right',
      priority: 'value',
    }),
    textColumn('assigned', t('m5.assigned'), (row) => names.staff(row.assignedTo)),
    textColumn('pickDate', t('m5.pickDate'), (row) => shortDate(row.pickDate)),
  ]

  const commit = (): void => {
    const done = (): void => {
      setActing(null)
      setReason('')
    }
    if (acting === 'wave')
      void createWave.mutateAsync({ orderIds: picked, beatId: beat }).then(() => {
        setPicked([])
        done()
      }, done)
    if (acting === 'start' && openSheet !== null)
      void startPick.mutateAsync(openSheet).then(done, done)
    if (acting === 'cancel' && openSheet !== null)
      void cancelWave.mutateAsync({ id: openSheet, reason: reason.trim() }).then(done, done)
  }

  return (
    <Screen
      title={t('m5.title')}
      chips={<PageTabs group="/fulfilment" active="/fulfilment" />}
      bottomBar={
        mayWave && picked.length > 0 ? (
          <Stack gap={2}>
            <Txt field="body" desk="body" numeric>
              {t('m5.selected', { count: picked.length, pieces: selectedPieces })}
            </Txt>
            <Button
              label={t('m5.createWave')}
              variant="primary"
              onPress={() => {
                setActing('wave')
              }}
              testID="make-wave"
            />
          </Stack>
        ) : undefined
      }
    >
      <Stack gap={6}>
        <Panel title={t('m5.queue')} testID="fulfil-queue">
          <Stack gap={4}>
            {beats.length === 0 ? null : (
              <Chips
                testID="fulfil-beats"
                items={beats.map(([id, name]) => ({ id, label: name, selected: beat === id }))}
                onToggle={(id) => {
                  setBeat((current) => (current === id ? null : id))
                }}
              />
            )}
            <Async
              state={[queue]}
              rows={8}
              empty={queueRows.length === 0}
              emptyMessage={t('m5.empty')}
            >
              <Register
                testID="fulfil-queue-register"
                columns={queueColumns}
                rows={queueRows}
                rowKey={(row) => row.orderId}
                frozen="orderNo"
                onSelect={
                  mayWave
                    ? (row) => {
                        setPicked((current) =>
                          current.includes(row.orderId)
                            ? current.filter((id) => id !== row.orderId)
                            : [...current, row.orderId],
                        )
                      }
                    : undefined
                }
                state="ready"
                filters={
                  beat === null
                    ? []
                    : [{ id: beat, label: beats.find(([id]) => id === beat)?.[1] ?? beat }]
                }
                onClearFilters={() => {
                  setBeat(null)
                }}
                totals={{
                  orderNo: countText(queuePage, t('app.none')),
                  pieces: pageTotal(
                    queuePage,
                    <Txt field="body" desk="cell" numeric>
                      {String(queueRows.reduce((sum, row) => sum + row.totalQtyPcs, 0))}
                    </Txt>,
                  ),
                }}
              />
            </Async>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('m5.waveBody')}
            </Txt>
          </Stack>
        </Panel>

        <Panel title={t('m5.picklists')} testID="fulfil-sheets">
          <Async
            state={[sheets]}
            rows={6}
            empty={(sheets.data?.items.length ?? 0) === 0}
            emptyMessage={t('m5.noWaves')}
          >
            <Register
              testID="fulfil-sheets-register"
              columns={sheetColumns}
              rows={sheets.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="pickNo"
              selectedKey={openSheet}
              onSelect={(row) => {
                setOpenSheet(row.id)
              }}
              state="ready"
            />
          </Async>
        </Panel>
      </Stack>

      <Sheet
        open={openSheet !== null}
        onClose={() => {
          setOpenSheet(null)
        }}
        title={sheet === undefined ? undefined : t('m5.detail', { no: sheet.picklistNo ?? '' })}
        testID="sheet-panel"
      >
        <Async state={[detail]} rows={6}>
          {sheet === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('m5.status')}>
                <StatusChip
                  label={word(sheet.status)}
                  family={PICK_FAMILY[sheet.status] ?? 'neutral'}
                />
              </Field>
              <Field label={t('m16.location')}>{names.location(sheet.locationId)}</Field>
              <Field label={t('m5.assigned')}>{names.staff(sheet.assignedTo)}</Field>
              <Field label={t('m5.pickDate')}>{shortDate(sheet.pickDate)}</Field>

              <Panel title={t('m5.orders')}>
                <Stack gap={2}>
                  {sheet.orders.map((order) => (
                    <Stack key={order.orderId} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {`${order.orderNo ?? ''} · ${order.retailerName}`}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary}>
                        {word(order.state)}
                      </Txt>
                    </Stack>
                  ))}
                </Stack>
              </Panel>

              <Panel title={t('m5.consolidated')}>
                <Stack gap={2}>
                  {sheet.lines.map((line) => (
                    <Stack key={line.id} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {line.variantName}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                        {`${line.batchNo ?? t('app.none')} · ${String(line.pickedQtyPcs)} / ${String(line.requestedQtyPcs)} ${word('pcs')}`}
                      </Txt>
                    </Stack>
                  ))}
                </Stack>
              </Panel>

              {mayWave ? (
                <Stack gap={3}>
                  <Button
                    label={t('m5.startPick')}
                    variant="primary"
                    disabled={sheet.status !== 'open'}
                    disabledReason={t('m5.onlyOpen')}
                    onPress={() => {
                      setActing('start')
                    }}
                    testID="sheet-start"
                  />
                  <Button
                    label={t('m5.cancelWave')}
                    variant="destructive"
                    disabled={sheet.status !== 'open'}
                    disabledReason={t('m5.onlyOpen')}
                    onPress={() => {
                      setActing('cancel')
                    }}
                    testID="sheet-cancel"
                  />
                </Stack>
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
          acting === 'wave'
            ? t('m5.createWave')
            : acting === 'start'
              ? t('m5.startPick')
              : t('m5.cancelWave')
        }
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body" numeric>
              {acting === 'wave'
                ? t('m5.selected', { count: picked.length, pieces: selectedPieces })
                : (sheet?.picklistNo ?? '')}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {acting === 'wave' ? t('m5.waveBody') : acting === 'cancel' ? t('m5.cancelBody') : ''}
            </Txt>
            {acting === 'cancel' ? (
              <TextInput
                label={t('app.reason')}
                value={reason}
                onChange={setReason}
                capitalize="sentences"
                testID="wave-reason"
              />
            ) : null}
          </Stack>
        }
        confirmLabel={
          acting === 'wave'
            ? t('m5.createWave')
            : acting === 'start'
              ? t('m5.startPick')
              : t('m5.cancelWave')
        }
        destructive={acting === 'cancel'}
        busy={
          createWave.status === 'pending' ||
          startPick.status === 'pending' ||
          cancelWave.status === 'pending'
        }
        onConfirm={commit}
        testID="wave-dialog"
      />
    </Screen>
  )
}
