/**
 * M19 — the gate count, on a phone (docs/23 §2.1, docs/22 §5).
 *
 * This is the ONE place in the whole product where a person types a number that is not already on a
 * document: "zero manual entry except the blind gate count". Everything about the screen follows from
 * the word BLIND — the expected pieces are not shown while the count is being taken, because a
 * figure on the screen is a figure the counter will agree with. `procurement.grns.get` does carry
 * `expectedQtyPcs`, and this screen deliberately does not print it until the line has a count.
 *
 * The pad is `<NumberPad>` in `count` mode (UX-00 §6.3): digits are appended, never parsed from a
 * float, and the target is the app's touch floor because the person is standing at a lorry.
 *
 * `procurement.grns.count` is owner + manager + warehouse — an accountant never reaches this route.
 */
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  ListRow,
  NumberPad,
  QtyStepper,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useState } from 'react'

import { Async, Field, PageTabs, Panel, useNames } from '../../src/lib/ui'
import { instantWithClock } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

interface Counted {
  received: number
  damaged: number
}

export default function GateCount(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()

  const [grnId, setGrnId] = useState<string | null>(null)
  const [counts, setCounts] = useState<Readonly<Record<string, Counted>>>({})
  const [padFor, setPadFor] = useState<string | null>(null)
  const [padValue, setPadValue] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)

  const open = useQuery(['procurement', 'grns', 'counting'], () =>
    api.api.procurement.grns.list({ status: 'counting', limit: 50 }),
  )
  /*
   * WHICH LORRY IS THIS? A goods receipt has no number of its own until it is posted, so the list
   * fell back to the godown name and the time it was opened: fifty rows reading "Not numbered yet
   * / Godown · 5 Sep, 10:32 pm", one under the next, on a phone, at a lorry. The person counting is
   * holding the supplier's BILL, and every open receipt carries the id of exactly that bill, so the
   * bill number and the supplier's name are what name the row.
   */
  const invoices = useQuery(
    ['procurement', 'supplierInvoices', 'forGate'],
    () => api.api.procurement.supplierInvoices.list({ limit: 200 }),
    { staleTime: 300_000 },
  )
  const billFor = (id: string): { no: string | null; supplierId: string | null } | undefined => {
    const hit = invoices.data?.items.find((row) => row.id === id)
    return hit === undefined ? undefined : { no: hit.invoiceNo, supplierId: hit.supplierId }
  }
  const detail = useQuery(
    ['procurement', 'grns', 'get', grnId ?? 'none'],
    () => api.api.procurement.grns.get({ id: grnId ?? '' }),
    { enabled: grnId !== null },
  )
  const grn = detail.data?.item

  const record = useMutation(
    (
      input: {
        id: string
        lines: readonly { grnLineId: string; countedQtyPcs: number; damagedQtyPcs: number }[]
      },
      meta,
    ) =>
      api.api.procurement.grns.count({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
        lines: input.lines.map((line) => ({ ...line })),
      }),
    { invalidates: [['procurement']] },
  )

  const lines = grn?.lines ?? []
  const done = lines.filter(
    (line) => counts[line.id] !== undefined || line.countedQtyPcs !== null,
  ).length
  const pending = Object.entries(counts)

  const commit = (): void => {
    if (grnId === null) return
    void record
      .mutateAsync({
        id: grnId,
        lines: pending.map(([grnLineId, value]) => ({
          grnLineId,
          countedQtyPcs: value.received,
          damagedQtyPcs: value.damaged,
        })),
      })
      .then(
        () => {
          setCounts({})
          setConfirming(false)
        },
        () => {
          setConfirming(false)
        },
      )
  }

  return (
    <Screen
      title={t('m19.title')}
      chips={<PageTabs group="/inbound" active="/inbound/gate" />}
      bottomBar={
        pending.length > 0 ? (
          <Button
            label={t('m19.save')}
            variant="primary"
            fullWidth
            onPress={() => {
              setConfirming(true)
            }}
            testID="gate-save"
          />
        ) : undefined
      }
    >
      <Stack gap={6}>
        <Txt field="body" desk="body" color={colors.text.secondary}>
          {t('m19.hint')}
        </Txt>

        <Panel title={t('m19.pick')} testID="gate-grns">
          <Async
            state={[open]}
            rows={4}
            empty={(open.data?.items.length ?? 0) === 0}
            emptyMessage={t('m19.empty')}
          >
            <Stack gap={2}>
              {(open.data?.items ?? []).map((row) => {
                const bill = billFor(row.supplierInvoiceId)
                return (
                  <ListRow
                    key={row.id}
                    primary={
                      row.grnNo ??
                      (bill?.no != null && bill.no !== ''
                        ? t('m19.againstBill', { no: bill.no })
                        : t('m19.unnumbered'))
                    }
                    /*
                     * The supplier only when we HAVE the bill: `supplierInvoices.list` is a page,
                     * and a receipt opened against an older bill is not on it — printing a bare
                     * em dash where a supplier's name belongs is worse than not printing one.
                     */
                    secondary={[
                      bill === undefined ? null : names.supplier(bill.supplierId),
                      names.location(row.locationId),
                      instantWithClock(row.createdAt),
                    ]
                      .filter((part): part is string => part !== null)
                      .join(' · ')}
                    state={grnId === row.id ? 'selected' : 'default'}
                    trailing={<StatusChip label={word(row.status)} family="ochre" />}
                    onPress={() => {
                      setGrnId(row.id)
                      setCounts({})
                    }}
                  />
                )
              })}
            </Stack>
          </Async>
        </Panel>

        {grnId === null ? null : (
          <Panel
            title={
              grn?.grnNo ??
              (grn === undefined
                ? t('m4.receipts')
                : (() => {
                    const bill = billFor(grn.supplierInvoiceId)
                    return bill?.no != null && bill.no !== ''
                      ? t('m19.againstBill', { no: bill.no })
                      : t('m4.receipts')
                  })())
            }
            meta={t('m19.countedLines', { done, total: lines.length })}
            testID="gate-lines"
          >
            <Async state={[detail]} rows={6} empty={lines.length === 0}>
              <Stack gap={4}>
                {lines.map((line) => {
                  const mine = counts[line.id]
                  const already = line.countedQtyPcs
                  const shown = mine?.received ?? already
                  return (
                    <Stack key={line.id} gap={2} border="bottom" borderTone="faint" padY={3}>
                      <Txt field="body" desk="body" numberOfLines={1}>
                        {names.variant(line.variantId)}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                        {/*
                         * The expected figure appears only ONCE the line has a count. Before that the
                         * line says what it is asking for and nothing else — that is what blind means.
                         */}
                        {shown === null
                          ? t('m19.received')
                          : t('m19.expectedAfter', { count: line.expectedQtyPcs })}
                      </Txt>
                      <Button
                        label={
                          shown === null
                            ? t('m19.received')
                            : `${t('m19.received')} ${String(shown)}`
                        }
                        variant={shown === null ? 'primary' : 'secondary'}
                        onPress={() => {
                          setPadFor(line.id)
                          setPadValue(mine?.received ?? null)
                        }}
                        testID={`count-${line.id}`}
                      />
                      {shown === null ? null : (
                        <Stack gap={1}>
                          <Txt field="label" desk="meta" color={colors.text.secondary}>
                            {t('m19.damaged')}
                          </Txt>
                          <QtyStepper
                            testID={`damaged-${line.id}`}
                            pieces={mine?.damaged ?? line.damagedQtyPcs}
                            caseSize={1}
                            onChange={(pieces) => {
                              setCounts((current) => ({
                                ...current,
                                [line.id]: {
                                  received: current[line.id]?.received ?? shown,
                                  damaged: pieces,
                                },
                              }))
                            }}
                          />
                        </Stack>
                      )}
                    </Stack>
                  )
                })}
              </Stack>
            </Async>
          </Panel>
        )}
      </Stack>

      <Sheet
        open={padFor !== null}
        onClose={() => {
          setPadFor(null)
        }}
        title={t('m19.received')}
        testID="gate-pad"
      >
        <NumberPad
          testID="gate-numberpad"
          label={t('m19.received')}
          mode="count"
          value={padValue}
          onChange={setPadValue}
          doneLabel={t('m19.save')}
          onDone={() => {
            if (padFor !== null && padValue !== null) {
              const id = padFor
              setCounts((current) => ({
                ...current,
                [id]: { received: padValue, damaged: current[id]?.damaged ?? 0 },
              }))
            }
            setPadFor(null)
            setPadValue(null)
          }}
        />
      </Sheet>

      <Dialog
        open={confirming}
        onClose={() => {
          setConfirming(false)
        }}
        title={t('m19.save')}
        body={
          <Stack gap={3}>
            <Field label={t('m19.countedLines', { done: pending.length, total: lines.length })}>
              {grn?.grnNo ?? t('m4.receipts')}
            </Field>
          </Stack>
        }
        confirmLabel={t('m19.save')}
        busy={record.status === 'pending'}
        onConfirm={commit}
        testID="gate-dialog"
      />
    </Screen>
  )
}
