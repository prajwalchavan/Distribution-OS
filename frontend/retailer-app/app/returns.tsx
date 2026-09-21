/**
 * Returns and help — every credit note in this shop's name, and the way to ask for one.
 *
 * A RETURN IN THIS TRADE IS A CREDIT NOTE. Goods go back at the door or on a later visit, the crew or
 * the desk raises a credit note against the original bill at the ORIGINAL rate, and the shop's dues
 * come down by exactly that. So the list below is `billing.creditNotes.list` — the record of what was
 * actually credited — and not a second, parallel notion of "a return" that the books would not know
 * about.
 *
 * WHAT THE SHOP CAN NOW DO (DOS-103). It can ASK. `notifications.inbound.create` files a report — a
 * return request, a complaint or a question — into the office's own inbound queue, beside the WhatsApp
 * texts the desk already triages, carrying the bill or delivery it is about. The words are stored
 * exactly as typed and never edited; the desk decides, and the credit note is raised as it always was
 * (at the door or by the office). The shop reads its own reports back below, with "Waiting" until the
 * desk marks one seen — it triages nothing itself.
 *
 * Still NOT possible for a shop, and the screen does not pretend otherwise: raising the credit note
 * itself (`billing.creditNotes.create` is back-office) and attaching a photograph of the damaged
 * carton (`files.uploadUrl` is STAFF).
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  Screen,
  Segments,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { instantWithClock, longDate } from '../src/lib/dates'
import { useMyShop } from '../src/lib/shop'
import { Async, Panel } from '../src/lib/ui'
import { useCreditNoteWord, useWord } from '../src/lib/words'

/** The three things a shop asks the office for. Everything else is one of these three in other words. */
const KINDS = ['return_request', 'complaint', 'question'] as const
type Kind = (typeof KINDS)[number]

export default function Returns(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const creditNoteWord = useCreditNoteWord()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const distributor = session?.tenant.displayName ?? ''
  const my = useMyShop()
  /** R4's "Report a problem with this bill" lands here with the bill already chosen. */
  const params = useLocalSearchParams<{ invoiceId?: string }>()
  const invoiceId = typeof params.invoiceId === 'string' ? params.invoiceId : null

  const [kind, setKind] = useState<Kind>(invoiceId === null ? 'question' : 'return_request')
  const [body, setBody] = useState('')
  const [sent, setSent] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const notes = useQuery(['credit-notes'], () => api.api.billing.creditNotes.list({ limit: 50 }), {
    enabled: session !== null,
  })
  const rows = notes.data?.items ?? []

  const reports = useQuery(['inbound'], () => api.api.notifications.inbound.list({ limit: 20 }), {
    enabled: session !== null,
  })
  const mine = reports.data?.items ?? []

  const file = useMutation(
    (input: { retailerId: string; kind: Kind; body: string }, meta) =>
      api.api.notifications.inbound.create({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        retailerId: input.retailerId,
        kind: input.kind,
        body: input.body,
        ...(invoiceId === null ? {} : { refType: 'invoice' as const, refId: invoiceId }),
      }),
    { invalidates: [['inbound']] },
  )

  const send = (): void => {
    if (my.retailerId === null || body.trim() === '') return
    setFailure(null)
    void file.mutateAsync({ retailerId: my.retailerId, kind, body: body.trim() }).then(
      () => {
        setBody('')
        setSent(true)
      },
      (error: unknown) => {
        setFailure(error instanceof Error ? error.message : t('rt.askFailed'))
      },
    )
  }

  return (
    <Screen title={t('rt.title')} context={distributor} testID="rt-screen">
      <Stack gap={6}>
        {/* --- ask the office ----------------------------------------------------------- */}
        <Panel
          title={t('rt.ask', { name: distributor })}
          meta={
            invoiceId === null
              ? t('rt.askBody', { name: distributor })
              : t('rt.askAboutBill', { name: distributor })
          }
          testID="rt-ask"
        >
          {my.unlinked ? (
            <Txt field="body" desk="body" color={colors.text.secondary}>
              {t('r2.noShopBody', { name: distributor })}
            </Txt>
          ) : (
            <Stack gap={4}>
              <Segments
                items={KINDS.map((id) => ({ id, label: t(`rt.kind.${id}`) }))}
                value={kind}
                onChange={(id) => {
                  setKind(KINDS.find((k) => k === id) ?? 'question')
                }}
                testID="rt-ask-kind"
              />
              <TextInput
                label={t('rt.askWhat')}
                value={body}
                onChange={setBody}
                capitalize="sentences"
                maxLength={1000}
                testID="rt-ask-body"
              />
              {failure === null ? null : (
                <Txt field="body" desk="body" color={colors.status.brick.fg} testID="rt-ask-failed">
                  {failure}
                </Txt>
              )}
              <Button
                label={t('rt.askSend')}
                variant="primary"
                loading={file.status === 'pending'}
                disabled={body.trim() === ''}
                disabledReason={body.trim() === '' ? t('rt.askWhat') : undefined}
                onPress={send}
                testID="rt-ask-send"
              />
            </Stack>
          )}
        </Panel>

        {/* --- what the shop has asked for ------------------------------------------------ */}
        <Panel title={t('rt.mine')} testID="rt-mine">
          <Async
            state={[reports]}
            rows={2}
            empty={mine.length === 0}
            emptyMessage={t('rt.mineNone')}
          >
            <Group>
              {mine.map((row) => (
                <ListRow
                  key={row.id}
                  primary={row.body ?? t('app.none')}
                  secondary={`${row.kind === null ? t('rt.kind.question') : t(`rt.kind.${row.kind}`)} · ${instantWithClock(
                    row.receivedAt,
                  )}`}
                  trailing={
                    <StatusChip
                      label={
                        row.handled ? t('rt.askSeen', { name: distributor }) : t('rt.askWaiting')
                      }
                      family={row.handled ? 'moss' : 'clay'}
                    />
                  }
                  testID={`rt-mine-${row.id}`}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        {/* --- what was actually credited -------------------------------------------------- */}
        <Panel title={t('rt.notes')} testID="rt-list">
          <Async state={[notes]} rows={4} empty={rows.length === 0} emptyMessage={t('rt.none')}>
            <Group>
              {rows.map((note) => (
                <ListRow
                  key={note.id}
                  primary={t('rt.no', { no: note.creditNoteNo ?? '—' })}
                  secondary={`${t('rt.against', { no: note.invoiceNo ?? '—' })} · ${t('rt.reason', {
                    reason: word(note.reason),
                  })} · ${longDate(note.noteDate)}`}
                  trailingMoney={note.totalPaise}
                  trailing={<StatusChip label={creditNoteWord(note.state)} family="moss" />}
                  onPress={() => {
                    router.push(`/bills/${note.invoiceId}`)
                  }}
                  testID={`rt-row-${note.id}`}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('rt.howTo')} testID="rt-howto">
          <Txt field="body" desk="body" color={colors.text.secondary}>
            {t('rt.howToBody', { name: distributor })}
          </Txt>
        </Panel>
      </Stack>

      <Toast
        open={sent}
        message={t('rt.askSent', { name: distributor })}
        onDismiss={() => {
          setSent(false)
        }}
        testID="rt-ask-toast"
      />
    </Screen>
  )
}
