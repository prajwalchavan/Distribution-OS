/**
 * R12 — the messages the distributor has sent this shop (docs/23 §6.1 R12).
 *
 * `notifications.messages.list` for a retailer caller is implicitly "mine": RLS narrows to rows whose
 * `recipientRetailerId` is this shop, and the `retailerId` filter is ignored for this role. The
 * `senderName` on every row is the DISTRIBUTOR's display name frozen when the message was queued —
 * so an inbox still reads correctly after a rebrand, and never carries our name (docs/23 §6.5).
 *
 * READ IS EXPLICIT, NEVER INFERRED. `markRead` only accepts `push` / `in_app` rows — a WhatsApp or an
 * SMS was read on the phone's own messaging app and this product has no business claiming otherwise —
 * so the button appears on those rows alone and the screen says why.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'

import { instantWithClock } from '../src/lib/dates'
import { Async, Panel } from '../src/lib/ui'
import { useWord } from '../src/lib/words'

/** The two channels whose "read" this app owns. Everything else was read somewhere we cannot see. */
const IN_APP = new Set(['push', 'in_app'])

export default function Inbox(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const colors = useColors()
  const { session } = useSession()
  const distributor = session?.tenant.displayName ?? ''

  const messages = useQuery(
    ['messages'],
    () => api.api.notifications.messages.list({ limit: 50 }),
    { enabled: session !== null },
  )
  const markRead = useMutation(
    (input: { id: string }, meta) =>
      api.api.notifications.messages.markRead({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['messages'], ['notifications']] },
  )

  const rows = messages.data?.items ?? []
  const unread = messages.data?.unreadCount ?? 0

  return (
    <Screen
      title={t('r12.title', { name: distributor })}
      context={distributor}
      chips={
        unread > 0 ? (
          <StatusChip label={t('r12.unread', { count: String(unread) })} family="ochre" />
        ) : undefined
      }
      testID="r12-screen"
    >
      <Stack gap={5}>
        <Panel testID="r12-list">
          <Async state={[messages]} rows={5} empty={rows.length === 0} emptyMessage={t('r12.none')}>
            <Group>
              {rows.map((message) => (
                <Stack key={message.id} gap={2} padY={2} border="bottom" borderTone="faint">
                  <ListRow
                    primary={message.body ?? word(message.templateKey)}
                    secondary={`${t('r12.channel', {
                      channel: word(message.channel),
                    })} · ${instantWithClock(message.sentAt ?? message.createdAt)}`}
                    trailing={
                      message.readAt === null && IN_APP.has(message.channel) ? (
                        <StatusChip label={word(message.status)} family="ochre" />
                      ) : (
                        <StatusChip label={word(message.status)} family="neutral" />
                      )
                    }
                    testID={`r12-row-${message.id}`}
                  />
                  {message.readAt === null && IN_APP.has(message.channel) ? (
                    <Button
                      label={t('r12.markRead')}
                      variant="ghost"
                      loading={markRead.status === 'pending'}
                      onPress={() => {
                        void markRead.mutateAsync({ id: message.id })
                      }}
                      testID={`r12-read-${message.id}`}
                    />
                  ) : null}
                </Stack>
              ))}
            </Group>
          </Async>
        </Panel>
        <Txt field="label" desk="meta" color={colors.text.secondary} testID="r12-only-push">
          {t('r12.onlyPush')}
        </Txt>
      </Stack>
    </Screen>
  )
}
