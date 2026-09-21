/**
 * S12b · One bill, opened from a shop's Bills tab (DOS-091).
 *
 * The rep could LIST a shop's pending bills and do nothing with any of them: no tap target, no
 * document, nothing to turn around and show a shopkeeper who says "which bill?". The backend half
 * was never the problem — `billing.invoices.get` and `billing.invoices.pdf` are `ANY_MEMBER` and the
 * `billing` key has been on sales-service since e934e8e — so this is the screen that was missing.
 *
 * ONLINE, AND IT SAYS SO. A bill is not in the salesperson's manifest beyond its header, and the
 * amount still open moves every time the office takes money, so this screen asks the service and
 * shows the offline sentence rather than a stale figure at a counter.
 *
 * THE DOCUMENT IS ALWAYS THE SERVER'S PDF (docs/22 §9, the same rule the retailer's R4 keeps): a
 * signed read URL from `invoices.pdf`, or `{ status: 'queued' }` while the worker renders it, which
 * is a normal state and not an error. The screen never re-draws the same figures as a second
 * document — two renderings of one bill is two bills.
 *
 * NOT ONE COST OR MARGIN. Everything here is sell-side: the rate on the bill, its taxes, its total
 * and what is still due. `tenant_product_costs` is not in this role's manifest and nothing on this
 * screen asks for it.
 */
import { useApi, useQuery } from '@dos/api-client/react'
import {
  Button,
  Group,
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
import { useLocalSearchParams } from 'expo-router'

import { absoluteUrl } from '../../../src/config'
import { longDate } from '../../../src/groups/sales/lib/dates'
import { useLocalState } from '../../../src/groups/sales/lib/local'
import { Async, Field, Panel } from '../../../src/groups/sales/lib/ui'
import { useWord } from '../../../src/groups/sales/lib/words'

export default function BillDetail(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const colors = useColors()
  const local = useLocalState()
  const params = useLocalSearchParams<{ id: string }>()
  const billId = typeof params.id === 'string' ? params.id : ''

  const invoice = useQuery(
    ['invoice', billId],
    () => api.api.billing.invoices.get({ id: billId }),
    { enabled: billId !== '' && local.online, staleTime: 60_000 },
  )
  const bill = invoice.data?.item

  const pdf = useQuery(
    ['invoice-pdf', billId],
    () => api.api.billing.invoices.pdf({ id: billId, copy: 'original', format: 'a4' }),
    { enabled: billId !== '' && local.online, staleTime: 60_000 },
  )

  /*
   * Service-relative on the local storage driver: a browser would resolve a bare `/storage/…`
   * against THIS app's origin and a phone has no origin to resolve it against at all (DOS-099).
   */
  const url = absoluteUrl(pdf.data?.url)
  const filename = `${bill?.invoiceNo ?? 'bill'}.pdf`
  const settled = bill === undefined ? 0 : bill.totalPaise - bill.amountDuePaise

  if (!local.online) {
    return (
      <Screen title={t('s12b.title', { no: '—' })}>
        <Txt field="body" desk="body" color={colors.status.ochre.fg}>
          {t('s12b.needsSignal')}
        </Txt>
      </Screen>
    )
  }

  return (
    <Screen
      testID="bill-detail"
      title={t('s12b.title', { no: bill?.invoiceNo ?? bill?.externalInvoiceNo ?? '—' })}
      context={bill?.buyerName ?? ''}
      chips={
        bill === undefined ? undefined : (
          <Row gap={2} wrap>
            <StatusChip label={word(bill.state)} family="neutral" />
            <StatusChip label={longDate(bill.invoiceDate)} family="neutral" figure />
          </Row>
        )
      }
      bottomBar={
        bill === undefined ? undefined : (
          <Row gap={3} justify="between" align="center" padX={4} padY={2} wrap>
            <Stack gap={1}>
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {bill.amountDuePaise > 0 ? t('s12b.stillDue') : t('s12b.settled')}
              </Txt>
              <Money
                value={bill.amountDuePaise > 0 ? bill.amountDuePaise : settled}
                size="moneyL"
                tone={bill.amountDuePaise > 0 ? 'critical' : 'positive'}
              />
            </Stack>
            {url === null ? null : (
              <Button
                testID="open-bill-pdf"
                label={t('s12b.openPdf')}
                variant="primary"
                onPress={() => {
                  void documents.open(url, { filename })
                }}
              />
            )}
          </Row>
        )
      }
    >
      <Async state={[invoice]} rows={6}>
        {bill === undefined ? null : (
          <Stack gap={6}>
            <Panel title={t('s12b.lines')}>
              <Group>
                {bill.lines.map((line) => (
                  <ListRow
                    key={line.id}
                    primary={line.description}
                    secondary={`${billLineQty(line, t)} · ${t('s12b.rate', {
                      rate: formatMoney(line.ratePaise),
                    })}${line.discountPaise > 0 ? ` · −${formatMoney(line.discountPaise)}` : ''}`}
                    trailingMoney={line.lineTotalPaise}
                  />
                ))}
              </Group>
            </Panel>

            <Panel title={t('s12b.taxes')}>
              <Stack gap={2}>
                <Line label={t('s12b.taxable')} value={bill.taxablePaise} />
                {bill.cgstPaise > 0 ? <Line label={t('s12b.cgst')} value={bill.cgstPaise} /> : null}
                {bill.sgstPaise > 0 ? <Line label={t('s12b.sgst')} value={bill.sgstPaise} /> : null}
                {bill.igstPaise > 0 ? <Line label={t('s12b.igst')} value={bill.igstPaise} /> : null}
                {bill.cessPaise > 0 ? <Line label={t('s12b.cess')} value={bill.cessPaise} /> : null}
                {bill.roundOffPaise === 0 ? null : (
                  <Line label={t('s12b.roundOff')} value={bill.roundOffPaise} />
                )}
                <Line label={t('s12b.total')} value={bill.totalPaise} strong />
              </Stack>
            </Panel>

            <Panel title={t('s12b.credits')}>
              {bill.creditNotes.length === 0 ? (
                <Txt field="body" desk="body" color={colors.text.secondary}>
                  {t('s12b.noCredits')}
                </Txt>
              ) : (
                <Group>
                  {bill.creditNotes.map((note) => (
                    <ListRow
                      key={note.id}
                      primary={note.creditNoteNo ?? note.id.slice(0, 8)}
                      secondary={`${word(note.reason)} · ${longDate(note.noteDate)}`}
                      trailingMoney={note.totalPaise}
                    />
                  ))}
                </Group>
              )}
            </Panel>

            <Panel title={t('s12b.for', { name: bill.buyerName })}>
              <Row gap={4} wrap>
                <Field label={t('s2.gstin')}>{bill.buyerGstin ?? '—'}</Field>
                <Field label={t('s5.placedAt')}>{longDate(bill.invoiceDate)}</Field>
              </Row>
            </Panel>

            {/* "Still being made" is a normal state for a queued render, never an error panel. */}
            {url === null ? (
              <Txt field="body" desk="body" color={colors.text.secondary} testID="bill-pdf-pending">
                {t('s12b.pdfPending')}
              </Txt>
            ) : documents.canPrint ? (
              <Button
                testID="print-bill-pdf"
                label={t('s12b.printPdf')}
                variant="secondary"
                onPress={() => {
                  void documents.print(url, { filename })
                }}
              />
            ) : null}
          </Stack>
        )}
      </Async>
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
