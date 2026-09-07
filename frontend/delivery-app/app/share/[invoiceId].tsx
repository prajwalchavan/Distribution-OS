/**
 * D9 — Send the papers (docs/23 §5.1): the bill, the credit note and the receipt, on WhatsApp or the
 * shop's printer, plus what the office has already sent by itself.
 *
 * EVERY DOCUMENT IS THE SERVER'S PDF, never a client-side re-draw of the same figures
 * (`@dos/core/documents`, scale rule 3). `billing.invoices.pdf` answers either a signed read URL or
 * `{ status: 'queued' }` — the renderer runs in the worker — and "the office is still making this"
 * is a normal state, not an error. A raw object key never reaches this screen; only a signed URL does.
 *
 * The hand-off itself is the platform's: a new tab in a browser, the OS share sheet on a phone, where
 * WhatsApp is one tap away — which is how a bill actually reaches a shopkeeper in this trade.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  Money,
  Row,
  Screen,
  Stack,
  StatusChip,
  Toast,
  Txt,
  useColors,
  wordFor,
  useStrings,
} from '@dos/ui'
import { documents, share } from '@dos/ui/platform'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { instantWithClock, longDate } from '../../src/lib/dates'
import { Async, Panel } from '../../src/lib/ui'

export default function ShareDocuments(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null
  const params = useLocalSearchParams<{ invoiceId: string }>()
  const invoiceId = typeof params.invoiceId === 'string' ? params.invoiceId : null

  const [toast, setToast] = useState<string | null>(null)

  const invoice = useQuery(
    ['invoice', invoiceId],
    () => api.api.billing.invoices.get({ id: invoiceId ?? '' }),
    { enabled: signedIn && invoiceId !== null },
  )
  const bill = invoice.data?.item
  const retailerId = bill?.retailerId ?? null

  const pdf = useQuery(
    ['invoice-pdf', invoiceId],
    () => api.api.billing.invoices.pdf({ id: invoiceId ?? '', copy: 'original', format: 'a4' }),
    { enabled: signedIn && invoiceId !== null },
  )

  const receipts = useQuery(
    ['receipts', retailerId],
    () => api.api.receivables.receipts.list({ retailerId: retailerId ?? '', limit: 10 }),
    { enabled: signedIn && retailerId !== null },
  )

  const messages = useQuery(
    ['messages', retailerId],
    () => api.api.notifications.messages.list({ retailerId: retailerId ?? '', limit: 20 }),
    { enabled: signedIn && retailerId !== null },
  )

  const url = pdf.data?.url ?? null
  const filename = `${bill?.invoiceNo ?? 'invoice'}.pdf`

  const open = (): void => {
    if (url === null) return
    void documents.open(url, { filename })
  }
  const print = (): void => {
    if (url === null) return
    void documents.print(url, { filename })
  }
  const send = (): void => {
    if (url === null) return
    void share
      .share({
        title: session?.tenant.displayName ?? '',
        message: `${bill?.invoiceNo ?? ''} · ${session?.tenant.displayName ?? ''}`,
        url,
      })
      .then((sent) => {
        setToast(sent ? t('d9.shared') : t('d9.notShared'))
      })
  }

  return (
    <Screen
      title={t('d9.title')}
      context={bill?.buyerName ?? undefined}
      chips={
        bill === undefined ? undefined : (
          <Row gap={2} wrap>
            <StatusChip label={bill.invoiceNo ?? t('d.bill')} family="neutral" />
            <StatusChip label={wordFor(t, bill.state)} family="neutral" />
          </Row>
        )
      }
      testID="d9-screen"
    >
      <Stack gap={6}>
        <Async state={invoice} rows={3}>
          <Panel
            title={t('d9.invoice')}
            meta={bill === undefined ? undefined : longDate(bill.invoiceDate)}
            testID="d9-invoice"
          >
            <Stack gap={4}>
              <Row justify="between" align="center" gap={3} wrap>
                <Txt field="bodyStrong" desk="cell">
                  {bill?.invoiceNo ?? t('d.bill')}
                </Txt>
                <Money value={bill?.totalPaise ?? null} size="moneyL" />
              </Row>
              {/*
               * ONE SENTENCE, NOT FOUR. Three disabled buttons each carrying the same reason, over
               * a line that already said it, printed "The office is still making this PDF" four
               * times on one card. A control that cannot exist yet is better not drawn: the reason
               * is stated once and the buttons appear when there is something to open.
               */}
              {url === null ? (
                <Txt field="body" desk="body" color={colors.text.secondary} testID="d9-pdf-pending">
                  {t('d9.pdfPending')}
                </Txt>
              ) : (
                <Row gap={8} wrap>
                  <Button
                    testID="d9-open"
                    label={t('d9.open')}
                    variant="secondary"
                    onPress={open}
                  />
                  <Button
                    testID="d9-print"
                    label={t('d9.print')}
                    variant="secondary"
                    disabled={!documents.canPrint}
                    disabledReason={t('d9.needsSignal')}
                    onPress={print}
                  />
                  <Button
                    testID="d9-share"
                    label={t('d9.share')}
                    variant="primary"
                    disabled={!share.available}
                    disabledReason={t('d9.needsSignal')}
                    onPress={send}
                  />
                </Row>
              )}
            </Stack>
          </Panel>

          {(bill?.creditNotes.length ?? 0) === 0 ? null : (
            <Panel title={t('d9.creditNote')} testID="d9-credit-notes">
              <Group>
                {(bill?.creditNotes ?? []).map((note) => (
                  <ListRow
                    key={note.id}
                    testID={`d9-cn-${note.id}`}
                    primary={note.creditNoteNo ?? note.id.slice(0, 8)}
                    secondary={longDate(note.noteDate)}
                    trailingMoney={note.totalPaise}
                    trailingSize="moneyM"
                  />
                ))}
              </Group>
            </Panel>
          )}
        </Async>

        <Panel title={t('d9.receipt')} testID="d9-receipts">
          <Async
            state={receipts}
            empty={(receipts.data?.items.length ?? 0) === 0}
            emptyMessage={t('d.nothingHere')}
          >
            <Group>
              {(receipts.data?.items ?? []).map((receipt) => (
                <ListRow
                  key={receipt.id}
                  testID={`d9-receipt-${receipt.id}`}
                  primary={receipt.receiptNo ?? receipt.id.slice(0, 8)}
                  secondary={`${wordFor(t, receipt.mode)} · ${instantWithClock(receipt.receivedAt)}`}
                  trailingMoney={receipt.amountPaise}
                  trailingSize="moneyM"
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('d9.alreadySent')} testID="d9-messages">
          <Async
            state={messages}
            empty={(messages.data?.items.length ?? 0) === 0}
            emptyMessage={t('d9.noMessages')}
          >
            <Group>
              {(messages.data?.items ?? []).map((message) => (
                <ListRow
                  key={message.id}
                  testID={`d9-message-${message.id}`}
                  primary={message.body}
                  secondary={instantWithClock(message.createdAt)}
                  trailing={<StatusChip label={message.channel} family="neutral" />}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Button
          testID="d9-back"
          label={t('d1.title')}
          variant="ghost"
          onPress={() => {
            router.push('/')
          }}
        />
      </Stack>

      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
      />
    </Screen>
  )
}
