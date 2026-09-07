/**
 * Returns and credits — every credit note in this shop's name, with the bill it corrects.
 *
 * A RETURN IN THIS TRADE IS A CREDIT NOTE. Goods go back at the door or on a later visit, the crew or
 * the desk raises a credit note against the original bill at the ORIGINAL rate, and the shop's dues
 * come down by exactly that. So this screen is `billing.creditNotes.list` — the record of what was
 * actually credited — and not a second, parallel notion of "a return" that the books would not know
 * about.
 *
 * WHAT A SHOP CANNOT DO HERE, AND WHY THE SCREEN SAYS SO. There is no procedure in this contract for
 * a SHOP to raise a return request or a claim: `delivery.deliveries.record` and `billing.creditNotes.
 * create` are DOORSTEP / back-office, and `files.uploadUrl` is STAFF, so a shopkeeper cannot even
 * attach a photograph of the damaged carton. Rather than draw a form that would 403, the screen tells
 * the shop the two ways that do work today — the delivery crew at the door, or a message to the
 * distributor — and the gap is written up for the backend slice.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import { Group, ListRow, Screen, Stack, StatusChip, Txt, useColors, useStrings } from '@dos/ui'
import { useRouter } from 'expo-router'

import { longDate } from '../src/lib/dates'
import { Async, Panel } from '../src/lib/ui'
import { useWord } from '../src/lib/words'

export default function Returns(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const distributor = session?.tenant.displayName ?? ''

  const notes = useQuery(['credit-notes'], () => api.api.billing.creditNotes.list({ limit: 50 }), {
    enabled: session !== null,
  })
  const rows = notes.data?.items ?? []

  return (
    <Screen title={t('rt.title')} context={distributor} testID="rt-screen">
      <Stack gap={6}>
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
                  trailing={<StatusChip label={word(note.state)} family="moss" />}
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
    </Screen>
  )
}
