/**
 * M20 — pick and pack, the manager's phone surface on the godown floor (docs/23 §2.1).
 *
 * The warehouse app owns this loop; the manager has the same two procedures because on a small
 * distributorship the manager IS sometimes the person on the floor, and because a stuck sheet has to
 * be movable by someone. Two steps, in order:
 *
 *   1. Record what was actually picked, line by line, against the FEFO lot the sheet suggested.
 *      A short pick WARNS and never blocks (`warehouse.picklists.pick` answers with warnings).
 *   2. Pack the order — `warehouse.packs.confirm` is the hand-over: stock leaves the godown, the
 *      order moves to `packed` and the bill is issued in the same transaction. There is no undo,
 *      which is why the dialog spells out all three.
 *
 * Quantities are integer PIECES with the line's own case size; `<QtyStepper>` is the control UX-00
 * §6.4 names for exactly this and the only one that speaks cases and pieces at once.
 */
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  ListRow,
  QtyStepper,
  Screen,
  Segments,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import { Async, Field, PageTabs, Panel, useCan, useNames } from '../../src/lib/ui'
import { shortDate, shortInstant } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const PICK_FAMILY: Readonly<Record<string, StatusFamily>> = {
  open: 'ochre',
  picking: 'ochre',
  picked: 'moss',
  /* `packed` means every order on the wave has a pack confirmation — the sheet is finished. */
  packed: 'moss',
  cancelled: 'neutral',
}

export default function PickAndPack(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const mayPack = can('warehouse.packs.confirm')
  const [view, setView] = useState<'pick' | 'pack'>('pick')
  const [sheetId, setSheetId] = useState<string | null>(null)
  /** Pieces the person has counted, per pick line. Absent = untouched, so nothing is sent for it. */
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({})
  const [packing, setPacking] = useState<string | null>(null)
  const [packages, setPackages] = useState('1')
  const [confirming, setConfirming] = useState<'pick' | 'pack' | null>(null)

  /*
   * One read per live status, asked of the server (DOS-023), as the warehouse home does. Filtering
   * one unfiltered page of 50 here dropped every live sheet that page left out, and the tab said
   * "Nothing to pick or pack" while a wave was being picked.
   */
  const pickingSheets = useQuery(['warehouse', 'picklists', 'status', 'picking'], () =>
    api.api.warehouse.picklists.list({ status: 'picking', limit: 50 }),
  )
  const openSheets = useQuery(['warehouse', 'picklists', 'status', 'open'], () =>
    api.api.warehouse.picklists.list({ status: 'open', limit: 50 }),
  )
  const pickedSheets = useQuery(['warehouse', 'picklists', 'status', 'picked'], () =>
    api.api.warehouse.picklists.list({ status: 'picked', limit: 50 }),
  )
  const detail = useQuery(
    ['warehouse', 'picklists', 'get', sheetId ?? 'none'],
    () => api.api.warehouse.picklists.get({ id: sheetId ?? '' }),
    { enabled: sheetId !== null },
  )
  const sheet = detail.data?.item

  const packs = useQuery(['warehouse', 'packs'], () => api.api.warehouse.packs.list({ limit: 50 }))

  const recordPick = useMutation(
    (
      input: {
        id: string
        lines: readonly { id: string; orderLineId: string; lotId: string; pickedQtyPcs: number }[]
      },
      meta,
    ) =>
      api.api.warehouse.picklists.pick({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
        lines: input.lines.map((line) => ({
          /*
           * The sheet's OWN row id, so the count updates the row this screen shows and the server holds
           * it to that row's ask (DOS-041). A fresh id inserted an ask-0 split row beside it on every
           * record, left the shown row at its old count, and slipped past the per-row rule.
           */
          id: line.id,
          orderLineId: line.orderLineId,
          lotId: line.lotId,
          pickedQtyPcs: line.pickedQtyPcs,
        })),
      }),
    { invalidates: [['warehouse'], ['orders'], ['inventory']] },
  )
  const pack = useMutation(
    (orderId: string, meta) =>
      api.api.warehouse.packs.confirm({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        orderId,
        packages: Math.max(1, Number.parseInt(packages, 10) || 1),
        issueInvoice: true,
      }),
    { invalidates: [['warehouse'], ['orders'], ['billing'], ['inventory'], ['reporting']] },
  )

  const activeSheets = [...(pickingSheets.data?.items ?? []), ...(openSheets.data?.items ?? [])]
  /**
   * "Ready to pack" is a sheet that has been PICKED and not yet packed. `packed` means every order
   * on the wave already has a pack confirmation, so it belongs in the history below, not the queue.
   */
  const readyToPack = pickedSheets.data?.items ?? []

  const lines = sheet?.lines ?? []
  const touched = lines.filter((line) => counts[line.id] !== undefined && line.lotId !== null)

  const commit = (): void => {
    const done = (): void => {
      setConfirming(null)
    }
    if (confirming === 'pick' && sheetId !== null)
      void recordPick
        .mutateAsync({
          id: sheetId,
          lines: touched.map((line) => ({
            id: line.id,
            orderLineId: line.orderLineId,
            lotId: line.lotId as string,
            pickedQtyPcs: counts[line.id] ?? 0,
          })),
        })
        .then(() => {
          setCounts({})
          done()
        }, done)
    if (confirming === 'pack' && packing !== null)
      void pack.mutateAsync(packing).then(() => {
        setPacking(null)
        done()
      }, done)
  }

  return (
    <Screen
      title={t('m20.title')}
      chips={<PageTabs group="/fulfilment" active="/fulfilment/pack" />}
      actions={
        <Segments
          testID="pack-view"
          value={view}
          onChange={(id) => {
            setView(id as 'pick' | 'pack')
          }}
          items={[
            { id: 'pick', label: t('m20.sheet') },
            { id: 'pack', label: t('m20.packOrder') },
          ]}
        />
      }
      bottomBar={
        view === 'pick' && touched.length > 0 ? (
          <Button
            label={t('m20.recordPick')}
            variant="primary"
            fullWidth
            onPress={() => {
              setConfirming('pick')
            }}
            testID="record-pick"
          />
        ) : undefined
      }
    >
      {view === 'pick' ? (
        <Stack gap={6}>
          <Panel title={t('m20.sheet')} testID="pack-sheets">
            <Async
              state={[pickingSheets, openSheets]}
              rows={4}
              empty={activeSheets.length === 0}
              emptyMessage={t('m20.empty')}
            >
              <Stack gap={2}>
                {activeSheets.map((row) => (
                  <ListRow
                    key={row.id}
                    primary={row.picklistNo ?? ''}
                    secondary={`${names.location(row.locationId)} · ${shortDate(row.pickDate)}`}
                    state={sheetId === row.id ? 'selected' : 'default'}
                    trailing={
                      <StatusChip
                        label={word(row.status)}
                        family={PICK_FAMILY[row.status] ?? 'neutral'}
                      />
                    }
                    onPress={() => {
                      setSheetId(row.id)
                      setCounts({})
                    }}
                  />
                ))}
              </Stack>
            </Async>
          </Panel>

          {sheetId === null ? null : (
            <Panel
              title={sheet?.picklistNo ?? ''}
              meta={
                sheet === undefined
                  ? undefined
                  : `${String(sheet.pickedQtyPcs)} / ${String(sheet.requestedQtyPcs)} ${word('pcs')}`
              }
              testID="pack-lines"
            >
              <Async state={[detail]} rows={6} empty={lines.length === 0}>
                <Stack gap={4}>
                  {lines.map((line) => (
                    <Stack key={line.id} gap={2} border="bottom" borderTone="faint" padY={3}>
                      <Txt field="body" desk="body" numberOfLines={1}>
                        {line.variantName}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                        {`${t('m20.lot')} ${line.batchNo ?? t('app.none')} · ${t('m20.askedPcs')} ${String(line.requestedQtyPcs)}`}
                      </Txt>
                      {/*
                        `availablePieces` means AVAILABLE STOCK (`sellable_stock`), and passing the
                        asked quantity into it made the stepper say "2 cs available" under a line
                        that had asked for 180 pieces — a claim about the godown that this read does
                        not make. The asked figure is already stated on the line above.
                      */}
                      <QtyStepper
                        testID={`pick-${line.id}`}
                        pieces={counts[line.id] ?? line.pickedQtyPcs}
                        /* A lot with no case size is loose stock: one piece IS the case. */
                        caseSize={line.caseSize ?? 1}
                        disabled={!mayPack || line.lotId === null}
                        onChange={(pieces) => {
                          setCounts((current) => ({ ...current, [line.id]: pieces }))
                        }}
                      />
                    </Stack>
                  ))}
                </Stack>
              </Async>
            </Panel>
          )}
        </Stack>
      ) : (
        <Stack gap={6}>
          <Panel title={t('m20.readyToPack')} testID="pack-ready">
            <Async
              state={[pickedSheets]}
              rows={4}
              empty={readyToPack.length === 0}
              emptyMessage={t('m20.empty')}
            >
              <Stack gap={2}>
                {readyToPack.map((row) => (
                  <ListRow
                    key={row.id}
                    primary={row.picklistNo ?? ''}
                    secondary={`${String(row.orderCount)} · ${names.location(row.locationId)}`}
                    state={sheetId === row.id ? 'selected' : 'default'}
                    onPress={() => {
                      setSheetId(row.id)
                    }}
                  />
                ))}
              </Stack>
            </Async>
          </Panel>

          {sheet === undefined ? null : (
            <Panel title={t('m20.packOrder')} testID="pack-orders">
              <Stack gap={4}>
                <TextInput
                  label={t('m20.packages')}
                  value={packages}
                  onChange={setPackages}
                  keyboard="decimal"
                  testID="pack-packages"
                />
                <Stack gap={2}>
                  {sheet.orders.map((order) => (
                    <ListRow
                      key={order.orderId}
                      primary={`${order.orderNo ?? ''} · ${order.retailerName}`}
                      secondary={word(order.state)}
                      trailing={
                        <StatusChip
                          label={word(order.state)}
                          family={order.state === 'packed' ? 'moss' : 'ochre'}
                        />
                      }
                      onPress={
                        mayPack && order.state !== 'packed'
                          ? () => {
                              setPacking(order.orderId)
                              setConfirming('pack')
                            }
                          : undefined
                      }
                    />
                  ))}
                </Stack>
              </Stack>
            </Panel>
          )}

          <Panel title={t('m20.packed')} testID="pack-recent">
            <Async
              state={[packs]}
              rows={4}
              empty={(packs.data?.items.length ?? 0) === 0}
              emptyMessage={t('m20.empty')}
            >
              <Stack gap={2}>
                {(packs.data?.items ?? []).slice(0, 12).map((row) => (
                  <ListRow
                    key={row.id}
                    primary={`${row.orderNo ?? ''} · ${row.retailerName}`}
                    secondary={`${row.invoiceNo ?? t('m7.noBill')} · ${shortInstant(row.packedAt)}`}
                    trailing={
                      row.shortPacked ? (
                        <StatusChip label={t('m20.shortPick')} family="clay" />
                      ) : undefined
                    }
                  />
                ))}
              </Stack>
            </Async>
          </Panel>
        </Stack>
      )}

      <Dialog
        open={confirming !== null}
        onClose={() => {
          setConfirming(null)
        }}
        title={confirming === 'pick' ? t('m20.recordPick') : t('m20.packOrder')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body" numeric>
              {confirming === 'pick'
                ? t('app.rows', { count: touched.length })
                : (sheet?.orders.find((order) => order.orderId === packing)?.retailerName ?? '')}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {confirming === 'pack' ? t('m20.packBody') : ''}
            </Txt>
          </Stack>
        }
        confirmLabel={confirming === 'pick' ? t('m20.recordPick') : t('m20.packOrder')}
        busy={recordPick.status === 'pending' || pack.status === 'pending'}
        onConfirm={commit}
        testID="pack-dialog"
      />

      {recordPick.data === undefined || recordPick.data.warnings.length === 0 ? null : (
        <Field label={t('m20.pickedOk')}>
          {recordPick.data.warnings.map((warning) => word(warning.code)).join(' · ')}
        </Field>
      )}
    </Screen>
  )
}
