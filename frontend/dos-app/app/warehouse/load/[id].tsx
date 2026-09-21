/**
 * W7 — one load sheet: what goes on the vehicle, and the check-out that WAITS for the manager.
 *
 * THE FOUNDER'S DECISION OF 2026-09-05 (docs/22 §8, docs/23 §4.3, §8.20 item 2), drawn: the manager
 * approves the sheet from the MANAGER app (`loadSheets.approve` is PIN_HOLDERS, and warehouse-service
 * answers 403 to an owner or manager token before any business logic, so the PIN cannot be typed
 * here at all) and the warehouse phone then confirms it (`loadSheets.confirm` is STOCK_KEEPERS, and
 * refuses an unapproved sheet with 409 `approval_required`). There is no `auth.stepUp`.
 *
 * So this screen has two states, and the difference between them is one field on the row:
 * `approvedBy === null` is "waiting for the manager" with the count locked, and the moment approval
 * lands the crew's blind carton count and the check-out button unlock. Nothing is typed on this phone
 * but that count.
 *
 * Check-out is one transaction: the e-way bill gate, the count (a variance needs a note and records
 * `pinVerifiedBy = approvedBy`), a `transfer_out` + `transfer_in` per lot, the Rule 55 challan, and
 * every packed order `packed → dispatched`.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Group,
  ListRow,
  Money,
  NumberPad,
  Row,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  useColors,
  useGo,
  useStrings,
} from '@dos/ui'
import { caseLine } from '@dos/ui'
import type { LoadSheetLot } from '@dos/contracts'
import { newId } from '@dos/api-client'
import { documents, haptics } from '@dos/ui/platform'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { absoluteUrl } from '../../../src/config'
import { GROUP } from '../../../src/groups/warehouse/nav'
import { instantWithClock, shortDate } from '../../../src/groups/warehouse/lib/dates'
import {
  Async,
  DeskOnly,
  ExpiryChip,
  Panel,
  pl,
  workFamily,
} from '../../../src/groups/warehouse/lib/ui'

export default function LoadSheet(): React.JSX.Element {
  const t = useStrings()
  const go = useGo()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const params = useLocalSearchParams<{ id: string }>()
  const sheetId = typeof params.id === 'string' ? params.id : ''
  const signedIn = session !== null

  const sheet = useQuery(
    ['loadSheet', sheetId],
    () => api.api.warehouse.loadSheets.get({ id: sheetId }),
    { enabled: signedIn && sheetId !== '', staleTime: 5000 },
  )
  const item = sheet.data?.item ?? null

  const [counted, setCounted] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [ask, setAsk] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  /** The crew's count per van-stock lot, in pieces. A lot absent from this map has not been counted. */
  const [vanCounts, setVanCounts] = useState<Record<string, number>>({})
  const [countingLot, setCountingLot] = useState<LoadSheetLot | null>(null)
  const [vanPieces, setVanPieces] = useState<number | null>(null)

  const approved = item?.approvedBy !== null && item?.approvedBy !== undefined
  const draft = item?.status === 'draft'
  const expected = item?.expectedPackages ?? 0
  const variance = counted !== null && counted !== expected
  /*
   * DOS-121. Since DOS-039 the check-out moves the VAN STOCK THE CREW COUNTED and nothing else — the
   * packed orders' pieces left the rack as `sale` at pack. This screen used to send
   * `countedVanStock: []` on every sheet, so a van-sales trip would have driven away with its van
   * stock still booked in the godown and none of it on the vehicle. So: one count per `source = 'van'`
   * lot, blind like the carton count (nothing to copy off the screen), and no vehicle leaves until
   * every one of them has a figure — 0 included, which simply means that lot is not going.
   */
  const vanLots = item?.lots.filter((lot) => lot.source === 'van') ?? []
  const vanCounted = vanLots.every((lot) => vanCounts[lot.lotId] !== undefined)
  /*
   * DOS-049. "Blind count: what the bill says is not on this screen" stood two inches above ORDERS ON
   * THIS SHEET — Cartons 7 / 12 / 12 / 4 / 3 — and 7 + 12 + 12 + 4 + 3 is the 38 the pad is asking
   * for. A crew three cartons short types 38 and the count is theatre. So the per-order figure waits
   * for the crew's own: once a number is keyed it comes back, and on a confirmed sheet it is simply
   * the record of what went out.
   */
  const cartonsVisible = !draft || counted !== null
  const blocked = !approved || counted === null || !vanCounted || (variance && note.trim() === '')

  const confirm = useMutation(
    (_input: { go: true }, meta) =>
      api.api.warehouse.loadSheets.confirm({
        id: sheetId,
        idempotencyKey: meta.idempotencyKey,
        countedPackages: counted ?? 0,
        // `LoadSheetVanStockInput.qtyPcs` is positive: a lot counted zero is simply left off.
        countedVanStock: vanLots
          .map((lot) => ({ lotId: lot.lotId, qtyPcs: vanCounts[lot.lotId] ?? 0 }))
          .filter((line) => line.qtyPcs > 0),
        challanId: newId(),
        ...(variance && note.trim() !== '' ? { varianceNote: note.trim() } : {}),
      }),
    {
      invalidates: [['loadSheet'], ['loadSheets'], ['packs']],
      onSuccess: () => {
        haptics.success()
        setAsk(false)
        setToast(t('w7.confirmed'))
      },
      onError: () => {
        haptics.error()
        setAsk(false)
      },
    },
  )

  const print = useMutation(
    (input: { id: string }) => api.api.warehouse.challans.pdf({ id: input.id }),
    {
      onSuccess: (result) => {
        const url = absoluteUrl(GROUP, result.url)
        if (result.status === 'ready' && url !== null) void documents.print(url)
        else setToast(t('w7.challanQueued'))
      },
    },
  )

  return (
    <Screen
      title={item?.vehicleRegNo ?? t('w7.title')}
      context={item === null ? undefined : shortDate(item.sheetDate)}
      chips={
        item === null ? undefined : (
          <StatusChip
            label={draft && !approved ? t('w7.waitingApproval') : item.status}
            family={draft && !approved ? 'ochre' : workFamily(item.status)}
          />
        )
      }
      testID="w7-sheet-screen"
      bottomBar={
        draft ? (
          <Row justify="between" align="center" gap={4} wrap>
            {/*
             * NOT the expected carton count. `ConfirmLoadSheetInput` calls this "the crew's BLIND
             * package count", and a bar that prints "Expected 1" two inches under the keypad is not
             * a blind count, it is a prompt — measured on this very screen before this line changed.
             * The expectation is the server's; the variance it finds is what a manager owns
             * (`pinVerifiedBy = approvedBy`). Expected against counted is printed AFTER the
             * check-out, on a confirmed sheet, where it is a record rather than a hint.
             */}
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {approved ? (item?.vehicleRegNo ?? t('w7.countPackages')) : t('w7.waitingApproval')}
            </Txt>
            <Button
              label={t('w7.confirm')}
              variant="primary"
              loading={confirm.status === 'pending'}
              disabled={blocked}
              {...(blocked
                ? {
                    disabledReason: !approved
                      ? t('w7.waitingBody')
                      : counted === null
                        ? t('w7.countPackages')
                        : !vanCounted
                          ? t('w7.countVanFirst')
                          : t('w7.variance'),
                  }
                : {})}
              onPress={() => {
                setAsk(true)
              }}
              testID="w7-confirm"
            />
          </Row>
        ) : undefined
      }
    >
      <Stack gap={6}>
        <Async state={sheet} empty={item === null} emptyMessage={t('w7.sheetsEmpty')}>
          {item === null ? null : (
            <Stack gap={6}>
              {draft && !approved ? (
                <Stack gap={3} pad={4} background="sunken" radius="md" testID="w7-waiting">
                  <Txt field="title" desk="section" as="h2">
                    {t('w7.waitingApproval')}
                  </Txt>
                  <Txt field="body" desk="body" color={colors.text.secondary}>
                    {t('w7.waitingBody')}
                  </Txt>
                </Stack>
              ) : null}

              {approved && item.approvedAt !== null ? (
                <StatusChip
                  label={t('w7.approvedBy', { when: instantWithClock(item.approvedAt) })}
                  family="moss"
                  testID="w7-approved"
                />
              ) : null}

              {item.ewbRequired && item.ewbNo === null ? (
                <DeskOnly>{t('w7.ewbRequired')}</DeskOnly>
              ) : null}
              {item.ewbNo === null ? null : (
                <StatusChip label={t('w7.ewbNo', { no: item.ewbNo })} family="neutral" />
              )}

              {draft && approved ? (
                <Panel title={t('w7.countPackages')} meta={t('w3.blind')} testID="w7-count">
                  <Stack gap={4}>
                    <NumberPad
                      testID="w7-count-pad"
                      mode="count"
                      label={t('w7.countLabel')}
                      value={counted}
                      onChange={setCounted}
                      doneLabel={t('action.done')}
                      onDone={() => {
                        haptics.tap()
                      }}
                    />
                    {variance ? (
                      <TextInput
                        label={t('w7.varianceNote')}
                        value={note}
                        onChange={setNote}
                        helper={t('w7.variance')}
                        capitalize="sentences"
                        testID="w7-variance"
                      />
                    ) : null}
                  </Stack>
                </Panel>
              ) : null}

              {/*
               * While the sheet is being COUNTED the expected carton figure is off this screen
               * entirely — the panel names the orders instead. It comes back on a confirmed sheet
               * (the "Counted / Expected" pair above), where it is the record of what happened
               * rather than a number to copy into the pad.
               */}
              <Panel
                title={t('w7.orders')}
                meta={
                  draft
                    ? pl(t, 'w.ordersN', item.orders.length)
                    : t('w7.expected', { count: item.expectedPackages })
                }
                testID="w7-orders"
              >
                <Group>
                  {item.orders.map((order) => (
                    <ListRow
                      key={order.orderId}
                      testID={`w7-order-${order.orderId}`}
                      primary={order.retailerName}
                      secondary={
                        cartonsVisible
                          ? `${order.orderNo ?? order.orderId.slice(0, 8)} · ${t(
                              'w6.packages',
                            )} ${String(order.packages)}`
                          : (order.orderNo ?? order.orderId.slice(0, 8))
                      }
                      trailing={
                        order.invoiceNo === null ? (
                          <StatusChip label={t('w6.noBill')} family="ochre" />
                        ) : (
                          <StatusChip label={order.invoiceNo} family="moss" />
                        )
                      }
                    />
                  ))}
                </Group>
              </Panel>

              <Panel
                title={t('w7.lots')}
                {...(draft && approved && vanLots.length > 0 ? { meta: t('w3.blind') } : {})}
                testID="w7-lots"
              >
                <Group>
                  {item.lots.map((lot) => {
                    // A van lot on a draft the crew may still count: blind until the figure is keyed,
                    // and pressable so it can be. Everything else is the sheet as it stands.
                    const counting = draft && approved && lot.source === 'van'
                    const keyed = vanCounts[lot.lotId]
                    return (
                      <ListRow
                        key={`${lot.lotId}-${lot.source}`}
                        testID={counting ? `w7-van-${lot.lotId}` : `w7-lot-${lot.lotId}`}
                        primary={lot.variantName}
                        secondary={
                          !counting
                            ? caseLine(lot.qtyPcs, lot.caseSize ?? 1, t)
                            : keyed === undefined
                              ? t('w7.vanUncounted')
                              : t('w7.countedWas', { count: keyed })
                        }
                        trailing={<ExpiryChip expiryDate={lot.expiryDate} />}
                        reason={lot.source === 'van' ? t('w7.sourceVan') : t('w7.sourceOrder')}
                        {...(counting
                          ? {
                              onPress: () => {
                                setCountingLot(lot)
                                setVanPieces(keyed ?? null)
                              },
                            }
                          : {})}
                      />
                    )
                  })}
                </Group>
              </Panel>

              {draft ? null : (
                <Panel title={t('w7.countPackages')} testID="w7-counted">
                  <Row gap={4} wrap align="center">
                    <StatusChip
                      label={t('w7.expected', { count: item.expectedPackages })}
                      family="neutral"
                      figure
                    />
                    <StatusChip
                      label={t('w7.countedWas', { count: item.countedPackages ?? 0 })}
                      family={item.countedPackages === item.expectedPackages ? 'moss' : 'ochre'}
                      figure
                    />
                  </Row>
                  {item.varianceNote === null ? null : (
                    <Txt field="body" desk="body" color={colors.text.secondary}>
                      {item.varianceNote}
                    </Txt>
                  )}
                </Panel>
              )}

              <Panel title={t('w7.loadValue')} testID="w7-value">
                <Row justify="between" align="center" gap={4} wrap>
                  <Money value={item.loadValuePaise} size="moneyM" testID="w7-load-value" />
                  {item.challanNo === null ? null : (
                    <Button
                      label={t('w7.printChallan')}
                      variant="secondary"
                      loading={print.status === 'pending'}
                      onPress={() => {
                        if (item.challan !== null) print.mutate({ id: item.challan.id })
                      }}
                      testID="w7-print"
                    />
                  )}
                </Row>
              </Panel>

              <DeskOnly>{t('w7.cancelIsManager')}</DeskOnly>

              {confirm.error === undefined ? null : (
                <Txt field="body" desk="body" color={colors.status.brick.fg}>
                  {confirm.error.message}
                </Txt>
              )}

              <Button
                label={t('w.close')}
                variant="ghost"
                onPress={() => {
                  router.push(go.href('/load'))
                }}
                testID="w7-close"
              />
            </Stack>
          )}
        </Async>
      </Stack>

      <Sheet
        open={countingLot !== null}
        onClose={() => {
          setCountingLot(null)
        }}
        title={countingLot?.variantName ?? ''}
        testID="w7-van-sheet"
      >
        <Stack gap={4}>
          <NumberPad
            testID="w7-van-pad"
            mode="count"
            label={t('w7.vanPieces')}
            value={vanPieces}
            onChange={setVanPieces}
            doneLabel={t('action.done')}
            onDone={() => {
              if (countingLot === null || vanPieces === null) return
              const lotId = countingLot.lotId
              setVanCounts((was) => ({ ...was, [lotId]: vanPieces }))
              haptics.tap()
              setCountingLot(null)
            }}
          />
          <Button
            label={t('w.close')}
            variant="ghost"
            onPress={() => {
              setCountingLot(null)
            }}
            testID="w7-van-cancel"
          />
        </Stack>
      </Sheet>

      <Dialog
        open={ask}
        onClose={() => {
          setAsk(false)
        }}
        title={t('w7.confirmTitle', { vehicle: item?.vehicleRegNo ?? '' })}
        body={t('w7.confirmBody', {
          counted: counted ?? 0,
          vehicle: item?.vehicleRegNo ?? '',
        })}
        confirmLabel={t('w7.confirm')}
        busy={confirm.status === 'pending'}
        onConfirm={() => {
          confirm.mutate({ go: true })
        }}
        testID="w7-dialog"
      />
      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="w7-toast"
      />
    </Screen>
  )
}
