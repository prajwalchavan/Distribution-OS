/**
 * D9 — Send the papers (docs/23 §5.1): the bill, the credit note and the receipt, on WhatsApp or the
 * shop's printer, plus what the office has already sent by itself.
 *
 * EVERY DOCUMENT IS THE SERVER'S PDF, never a client-side re-draw of the same figures
 * (`@dos/core/documents`, scale rule 3). `billing.invoices.pdf` and `receivables.receipts.document`
 * answer either a signed read URL or `{ status: 'queued' }` — the renderer runs in the worker — and
 * "the office is still making this" is a normal state, not an error. A credit note carries its
 * rendered `pdfObjectKey` (`billing.creditNotes.get`), which `files.readUrl` signs; null means the
 * worker has not written it yet. A raw object key is never opened: only a signed URL is.
 *
 * The signed URL is SERVICE-RELATIVE on the local storage driver (`/storage/…`), so `PaperActions`
 * runs every one through `absoluteUrl()` before the platform sees it — a browser would otherwise open
 * this app's own page and a phone would refuse the path (DOS-057).
 *
 * The hand-off itself is the platform's: a new tab in a browser, the OS share sheet on a phone, where
 * WhatsApp is one tap away — which is how a bill actually reaches a shopkeeper in this trade. "Send on
 * WhatsApp" hands over the PDF FILE (`documents.share`), never a link that dies with its 15-minute
 * signature.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  Money,
  Row,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  Toast,
  Txt,
  useColors,
  wordFor,
  useStrings,
} from '@dos/ui'
import { documents } from '@dos/ui/platform'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { absoluteUrl } from '../../src/config'
import { instantWithClock, longDate } from '../../src/lib/dates'
import { Async, Panel } from '../../src/lib/ui'

/** The credit note or receipt whose paper the sheet is showing. */
interface SelectedPaper {
  kind: 'credit_note' | 'receipt'
  id: string
  /** Its number, which titles the sheet and names the file. */
  label: string
}

export default function ShareDocuments(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null
  const params = useLocalSearchParams<{ invoiceId: string }>()
  const invoiceId = typeof params.invoiceId === 'string' ? params.invoiceId : null

  const [toast, setToast] = useState<string | null>(null)
  const [selected, setSelected] = useState<SelectedPaper | null>(null)

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

  // The receipt's paper: rendered on first ask when it was not queued at issue (R13's pattern).
  const receiptId = selected?.kind === 'receipt' ? selected.id : null
  const receiptPaper = useQuery(
    ['receipt-document', receiptId],
    () => api.api.receivables.receipts.document({ id: receiptId ?? '', format: 'a5' }),
    { enabled: signedIn && receiptId !== null },
  )

  // The credit note's paper: its rendered key, then a signed URL for that key.
  const creditNoteId = selected?.kind === 'credit_note' ? selected.id : null
  const creditNote = useQuery(
    ['credit-note', creditNoteId],
    () => api.api.billing.creditNotes.get({ id: creditNoteId ?? '' }),
    { enabled: signedIn && creditNoteId !== null },
  )
  const creditNoteKey = creditNoteId === null ? null : (creditNote.data?.item.pdfObjectKey ?? null)
  const creditNotePaper = useQuery(
    ['file-read-url', creditNoteKey],
    () => api.api.files.readUrl({ objectKey: creditNoteKey ?? '' }),
    { enabled: signedIn && creditNoteKey !== null },
  )

  const distributor = session?.tenant.displayName ?? ''
  const billNo = bill?.invoiceNo ?? ''
  const sent = (handedOver: boolean): void => {
    setToast(handedOver ? t('d9.shared') : t('d9.notShared'))
  }
  const selectedUrl =
    selected === null
      ? null
      : selected.kind === 'receipt'
        ? (receiptPaper.data?.url ?? null)
        : (creditNotePaper.data?.url ?? null)

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
              <PaperActions
                testID="d9"
                signedUrl={pdf.data?.url ?? null}
                filename={`${bill?.invoiceNo ?? 'invoice'}.pdf`}
                title={distributor}
                message={`${billNo} · ${distributor}`}
                onSent={sent}
              />
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
                    onPress={() => {
                      setSelected({
                        kind: 'credit_note',
                        id: note.id,
                        label: note.creditNoteNo ?? note.id.slice(0, 8),
                      })
                    }}
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
                  onPress={() => {
                    setSelected({
                      kind: 'receipt',
                      id: receipt.id,
                      label: receipt.receiptNo ?? receipt.id.slice(0, 8),
                    })
                  }}
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

      <Sheet
        testID="d9-paper-sheet"
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={selected?.label}
      >
        <Async
          state={selected?.kind === 'receipt' ? [receiptPaper] : [creditNote, creditNotePaper]}
          rows={1}
        >
          <PaperActions
            testID="d9-paper"
            signedUrl={selectedUrl}
            filename={`${selected?.label ?? 'paper'}.pdf`}
            title={distributor}
            message={`${selected?.label ?? ''} · ${distributor}`}
            onSent={(handedOver) => {
              // The phone's sheet is a modal the toast would sit under: close it so the answer shows.
              setSelected(null)
              sent(handedOver)
            }}
          />
        </Async>
      </Sheet>

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

/**
 * Open, Print and Send on WhatsApp for ONE paper. The signed URL is absolutised here, so no button can
 * hand the platform a service-relative `/storage/…` path.
 *
 * ONE SENTENCE, NOT FOUR. Three disabled buttons each carrying the same reason, over a line that
 * already said it, printed "The office is still making this PDF" four times on one card. A control
 * that cannot exist yet is better not drawn: the reason is stated once and the buttons appear when
 * there is something to open.
 */
function PaperActions({
  signedUrl,
  filename,
  title,
  message,
  onSent,
  testID,
}: {
  signedUrl: string | null
  filename: string
  title: string
  message: string
  onSent: (handedOver: boolean) => void
  testID: string
}): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const url = absoluteUrl(signedUrl)

  if (url === null) {
    return (
      <Txt field="body" desk="body" color={colors.text.secondary} testID={`${testID}-pdf-pending`}>
        {t('d9.pdfPending')}
      </Txt>
    )
  }
  return (
    <Row gap={8} wrap>
      <Button
        testID={`${testID}-open`}
        label={t('d9.open')}
        variant="secondary"
        onPress={() => {
          void documents.open(url, { filename })
        }}
      />
      <Button
        testID={`${testID}-print`}
        label={t('d9.print')}
        variant="secondary"
        disabled={!documents.canPrint}
        disabledReason={t('d9.needsSignal')}
        onPress={() => {
          void documents.print(url, { filename })
        }}
      />
      <Button
        testID={`${testID}-share`}
        label={t('d9.share')}
        variant="primary"
        disabled={!documents.canShare}
        disabledReason={t('d9.needsSignal')}
        onPress={() => {
          void documents.share(url, { filename, title, message }).then(onSent, () => {
            onSent(false)
          })
        }}
      />
    </Row>
  )
}
