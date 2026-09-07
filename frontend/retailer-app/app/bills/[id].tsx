/**
 * R4 — one bill, as the shop needs it: who issued it, what is on it, what has been paid against it,
 * what was returned, and the proof it was delivered (docs/23 §6.1 R4).
 *
 * THE DOCUMENT IS ALWAYS THE SERVER'S PDF. `billing.invoices.pdf` answers a signed read URL or
 * `{ status: 'queued' }` — the worker renders it — and "still being made" is a normal state, not an
 * error. The screen never re-draws the same figures as a second document: two renderings of one bill
 * is two bills.
 *
 * THE POD PHOTO comes from `delivery.deliveries.get`, which is the only procedure that mints a
 * short-lived read URL for it. A raw object key never reaches a client (docs/22 §9).
 *
 * The quantity on each line is `billLineQty`: what was TYPED, with the pack size that applied on the
 * day, then the piece total, then free goods — never recomputed from today's case size, because a
 * reissued bill has to read the way it was issued (docs/17 A3).
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  Img,
  ListRow,
  Money,
  Row,
  Screen,
  Stack,
  StatusChip,
  Txt,
  billLineQty,
  formatMoney,
  useColors,
  useStrings,
} from '@dos/ui'
import { documents } from '@dos/ui/platform'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { instantWithClock, longDate } from '../../src/lib/dates'
import { addressLine } from '../../src/lib/shop'
import { Async, Field, Panel, billFamily } from '../../src/lib/ui'
import { useWord } from '../../src/lib/words'

export default function BillDetail(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null
  const distributor = session?.tenant.displayName ?? ''
  const params = useLocalSearchParams<{ id: string }>()
  const billId = typeof params.id === 'string' ? params.id : null

  const invoice = useQuery(
    ['invoice', billId],
    () => api.api.billing.invoices.get({ id: billId ?? '' }),
    { enabled: signedIn && billId !== null },
  )
  const bill = invoice.data?.item

  const pdf = useQuery(
    ['invoice-pdf', billId],
    () => api.api.billing.invoices.pdf({ id: billId ?? '', copy: 'original', format: 'a4' }),
    { enabled: signedIn && billId !== null },
  )
  const deliveries = useQuery(
    ['deliveries', billId],
    () => api.api.delivery.deliveries.list({ invoiceId: billId ?? '', limit: 5 }),
    { enabled: signedIn && billId !== null },
  )
  const deliveryId = deliveries.data?.items[0]?.id ?? null
  const delivery = useQuery(
    ['delivery', deliveryId],
    () => api.api.delivery.deliveries.get({ id: deliveryId ?? '' }),
    { enabled: signedIn && deliveryId !== null },
  )

  const url = pdf.data?.url ?? null
  const filename = `${bill?.invoiceNo ?? 'bill'}.pdf`
  const proofs = delivery.data?.item.pod ?? []

  return (
    <Screen
      title={t('r4.detailTitle', { no: bill?.invoiceNo ?? bill?.externalInvoiceNo ?? '—' })}
      context={distributor}
      chips={
        bill === undefined ? undefined : (
          <Row gap={2} wrap>
            <StatusChip label={word(bill.state)} family={billFamily(bill.state)} />
            <StatusChip label={longDate(bill.invoiceDate)} family="neutral" />
          </Row>
        )
      }
      testID="r4-detail"
      bottomBar={
        bill === undefined ? undefined : (
          <Row gap={4} justify="between" align="center" wrap>
            <Stack gap={1}>
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {bill.amountDuePaise > 0 ? t('r4.due') : t('r4.paid')}
              </Txt>
              <Money
                value={bill.amountDuePaise}
                size="moneyL"
                tone={bill.amountDuePaise > 0 ? 'critical' : 'positive'}
              />
            </Stack>
            {bill.amountDuePaise > 0 ? (
              <Button
                label={t('r3.payBill')}
                variant="primary"
                onPress={() => {
                  router.push('/pay')
                }}
                testID="r4-pay"
              />
            ) : null}
          </Row>
        )
      }
    >
      <Stack gap={6}>
        <Async state={[invoice]} rows={6}>
          {bill === undefined ? null : (
            <Stack gap={6}>
              {/* --- who issued it (white-label: the distributor's own block) ------------------ */}
              <Panel title={t('r4.from')} testID="r4-seller">
                <Stack gap={2}>
                  <Txt field="bodyStrong" desk="body">
                    {bill.seller.displayName}
                  </Txt>
                  {bill.seller.address === null ? null : (
                    <Txt field="label" desk="meta" color={colors.text.secondary}>
                      {addressLine(bill.seller.address)}
                    </Txt>
                  )}
                  <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                    {bill.seller.gstin}
                  </Txt>
                </Stack>
              </Panel>

              {/* --- the document ------------------------------------------------------------- */}
              {url === null ? (
                <Txt field="body" desk="body" color={colors.text.secondary} testID="r4-pdf-pending">
                  {t('r4.pdfPending', { name: distributor })}
                </Txt>
              ) : (
                <Row gap={8} wrap>
                  <Button
                    label={t('r4.openPdf')}
                    variant="secondary"
                    onPress={() => {
                      void documents.open(url, { filename })
                    }}
                    testID="r4-open-pdf"
                  />
                  {documents.canPrint ? (
                    <Button
                      label={t('r4.printPdf')}
                      variant="ghost"
                      onPress={() => {
                        void documents.print(url, { filename })
                      }}
                      testID="r4-print-pdf"
                    />
                  ) : null}
                </Row>
              )}

              {/* --- the lines ---------------------------------------------------------------- */}
              <Panel title={t('r4.lines')} testID="r4-lines">
                <Group>
                  {bill.lines.map((line) => (
                    <ListRow
                      key={line.id}
                      primary={line.description}
                      secondary={`${billLineQty(line, t)} · ${t('r4.rate', {
                        rate: formatMoney(line.ratePaise),
                      })}${line.discountPaise > 0 ? ` · −${formatMoney(line.discountPaise)}` : ''}`}
                      trailingMoney={line.lineTotalPaise}
                    />
                  ))}
                </Group>
              </Panel>

              {/* --- the totals --------------------------------------------------------------- */}
              <Panel title={t('r4.taxes')} testID="r4-totals">
                <Stack gap={2}>
                  <Line label={t('r4.taxable')} value={bill.taxablePaise} />
                  {bill.cgstPaise > 0 ? <Line label={t('r4.cgst')} value={bill.cgstPaise} /> : null}
                  {bill.sgstPaise > 0 ? <Line label={t('r4.sgst')} value={bill.sgstPaise} /> : null}
                  {bill.igstPaise > 0 ? <Line label={t('r4.igst')} value={bill.igstPaise} /> : null}
                  {bill.cessPaise > 0 ? <Line label={t('r4.cess')} value={bill.cessPaise} /> : null}
                  {bill.roundOffPaise === 0 ? null : (
                    <Line label={t('r4.roundOff')} value={bill.roundOffPaise} />
                  )}
                  <Line label={t('r4.total')} value={bill.totalPaise} strong />
                </Stack>
              </Panel>

              {/* --- returns against it -------------------------------------------------------- */}
              <Panel title={t('r4.credits')} testID="r4-credits">
                {bill.creditNotes.length === 0 ? (
                  <Txt field="body" desk="body" color={colors.text.secondary}>
                    {t('r4.noCredits')}
                  </Txt>
                ) : (
                  <Group>
                    {bill.creditNotes.map((note) => (
                      <ListRow
                        key={note.id}
                        primary={t('rt.no', { no: note.creditNoteNo ?? '—' })}
                        secondary={`${word(note.reason)} · ${longDate(note.noteDate)}`}
                        trailingMoney={note.totalPaise}
                        trailing={<StatusChip label={word(note.state)} family="neutral" />}
                      />
                    ))}
                  </Group>
                )}
              </Panel>

              {/*
                --- what has been paid ON THIS BILL --------------------------------------------

                THE ONLY MONEY THIS PANEL MAY NAME IS THE MONEY THAT PAID THIS BILL.

                It used to list `receipts.list({ retailerId })` — the shop's last eight receipts,
                whatever they were against. Measured on the founder's data, INV/0031 (₹13,554, paid
                in full on 27 August) showed eight receipts under "WHAT YOU HAVE PAID", not one of
                which touched it: five ₹1 receipts from 5 September, a −₹13,554 reversal, a −₹40 and
                a +₹40 — adding to MINUS ₹13,549 — while the receipt that actually paid the bill was
                not on the list at all. A bill screen that prints somebody else's payments as if
                they were this bill's is worse than a bill screen that prints none.

                The figures below are the invoice's own: `totalPaise − amountDuePaise` is what has
                been settled against it (receipts, credit notes and write-offs alike). The receipts
                themselves, each with the bills it went against, live one tap away. Naming which
                receipt paid which bill needs an `invoiceId` filter on `receipts.list` (or the
                allocations on `invoices.get`); neither is in the contract — recorded as a gap.
              */}
              <Panel title={t('r4.receipts')} testID="r4-receipts">
                <Stack gap={3}>
                  {bill.totalPaise - bill.amountDuePaise <= 0 ? (
                    <Txt field="body" desk="body" color={colors.text.secondary}>
                      {t('r4.noReceipts')}
                    </Txt>
                  ) : (
                    <Line
                      label={t('r4.paidOnThisBill')}
                      value={bill.totalPaise - bill.amountDuePaise}
                      strong
                    />
                  )}
                  {bill.amountDuePaise > 0 ? (
                    <Line label={t('r4.stillOnThisBill')} value={bill.amountDuePaise} />
                  ) : null}
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {t('r4.receiptsElsewhere', { name: distributor })}
                  </Txt>
                  <Button
                    label={t('r4.seeReceipts')}
                    variant="secondary"
                    onPress={() => {
                      router.push('/receipts')
                    }}
                    testID="r4-see-receipts"
                  />
                </Stack>
              </Panel>

              {/* --- proof of delivery ----------------------------------------------------------- */}
              <Panel title={t('r4.pod')} testID="r4-pod">
                <Async state={[deliveries, delivery]} rows={2}>
                  {delivery.data === undefined ? (
                    <Txt field="body" desk="body" color={colors.text.secondary}>
                      {t('r4.noPod')}
                    </Txt>
                  ) : (
                    <Stack gap={3}>
                      <Field label={t('r4.deliveredLabel')}>
                        {delivery.data.item.deliveredAt === null
                          ? word(delivery.data.item.outcome)
                          : `${word(delivery.data.item.outcome)} · ${instantWithClock(
                              delivery.data.item.deliveredAt,
                            )}`}
                      </Field>
                      {delivery.data.item.receiverName === null ? null : (
                        <Txt field="body" desk="body">
                          {t('r4.podSigned', { name: delivery.data.item.receiverName })}
                        </Txt>
                      )}
                      {proofs
                        .filter((proof) => proof.readUrl !== null)
                        .map((proof) => (
                          <Img
                            key={proof.id}
                            source={proof.readUrl ?? ''}
                            alt={t('r4.podPhoto')}
                            height={220}
                            radius="md"
                            fit="cover"
                            testID={`r4-pod-${proof.id}`}
                          />
                        ))}
                    </Stack>
                  )}
                </Async>
              </Panel>
            </Stack>
          )}
        </Async>
      </Stack>
    </Screen>
  )
}

function Line({
  label,
  value,
  strong = false,
}: {
  label: string
  value: number
  strong?: boolean
}): React.JSX.Element {
  const colors = useColors()
  return (
    <Row justify="between" align="center" gap={4}>
      <Txt
        field={strong ? 'bodyStrong' : 'body'}
        desk="body"
        color={strong ? undefined : colors.text.secondary}
      >
        {label}
      </Txt>
      <Money value={value} size={strong ? 'moneyM' : 'cell'} />
    </Row>
  )
}
