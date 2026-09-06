/**
 * S13 · Inbox — what shops sent us, and what we sent them.
 *
 * Two different things behind one word, so they are two segments and never one list. **From shops**
 * is `notifications.inbound.list`, which the service scopes to the shops on this rep's own beats, and
 * a row there is WORK: somebody has to answer it, and marking it handled is what says somebody did.
 * **Sent** is `notifications.messages.list` — the order confirmation, the bill, the reminder the
 * office sent to a shop on this beat, so a rep is never told something by a shopkeeper they should
 * have known.
 *
 * A photograph a shop sent (a payment screenshot) is shown through the signed URL the service
 * returns; a raw object key never reaches a client (docs/20 rule 3).
 */
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Group,
  Img,
  ListRow,
  Row,
  Screen,
  Segments,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { absoluteUrl } from '../../src/config'
import { instantWithClock } from '../../src/lib/dates'
import { useLocalState } from '../../src/lib/local'
import { Async, PageTabs, Panel } from '../../src/lib/ui'
import { useWord } from '../../src/lib/words'

export default function Inbox(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const router = useRouter()
  const word = useWord()
  const local = useLocalState()
  const [view, setView] = useState<'inbound' | 'sent'>('inbound')

  const inbound = useQuery(
    ['notifications', 'inbound'],
    () => api.api.notifications.inbound.list({ limit: 40 }),
    { staleTime: 60_000 },
  )
  const sent = useQuery(
    ['notifications', 'messages'],
    () => api.api.notifications.messages.list({ limit: 40 }),
    { staleTime: 60_000, enabled: view === 'sent' },
  )

  const handled = useMutation(
    (input: { id: string }, meta) =>
      api.api.notifications.inbound.markHandled({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['notifications', 'inbound']] },
  )

  const unhandled = inbound.data?.unhandledCount ?? 0

  return (
    <Screen
      title={t('s13.title')}
      chips={
        <Row gap={2} wrap>
          <StatusChip
            label={t('s13.unhandled', { count: unhandled })}
            family={unhandled === 0 ? 'neutral' : 'ochre'}
            figure
          />
          {local.online ? null : <StatusChip label={t('s0.offlineChip')} family="ochre" />}
        </Row>
      }
    >
      <Stack gap={4}>
        <PageTabs group="/me" active="/me/inbox" />

        <Segments
          testID="inbox-view"
          value={view}
          onChange={(id) => {
            setView(id as 'inbound' | 'sent')
          }}
          items={[
            { id: 'inbound', label: t('s13.fromShops') },
            { id: 'sent', label: t('s13.sent') },
          ]}
        />

        {view === 'inbound' ? (
          <Panel title={t('s13.fromShops')} meta={t('s13.fromShopsMeta')}>
            <Async
              state={[inbound]}
              rows={4}
              empty={(inbound.data?.items.length ?? 0) === 0}
              emptyMessage={t('s13.noInbound')}
            >
              <Stack gap={4} testID="inbox-inbound">
                {(inbound.data?.items ?? []).map((message) => (
                  <Group key={message.id}>
                    <ListRow
                      primary={message.body ?? t('s13.photoOnly')}
                      secondary={[
                        message.retailerName ?? message.fromPhone,
                        word(message.channel),
                        instantWithClock(message.receivedAt),
                      ].join(' · ')}
                      state={message.handled ? 'default' : 'needsAttention'}
                      trailing={
                        <StatusChip
                          label={message.handled ? t('s13.handled') : t('s13.open')}
                          family={message.handled ? 'moss' : 'ochre'}
                        />
                      }
                    />
                    {message.mediaUrl === null ? null : (
                      <Row padX={3} padY={2}>
                        <Img
                          source={absoluteUrl(message.mediaUrl) ?? ''}
                          alt={t('s13.photoAlt', { shop: message.retailerName ?? '' })}
                          width={220}
                          height={160}
                          radius="md"
                          fit="cover"
                        />
                      </Row>
                    )}
                    <Row gap={2} padX={3} padY={2} wrap>
                      {message.retailerId === null ? null : (
                        <Button
                          label={t('s13.openShop')}
                          variant="secondary"
                          onPress={() => {
                            router.push(`/shops/${message.retailerId ?? ''}`)
                          }}
                        />
                      )}
                      {message.handled ? null : (
                        <Button
                          label={t('s13.markHandled')}
                          variant="ghost"
                          disabled={!local.online}
                          disabledReason={local.online ? undefined : t('s0.needsSignal')}
                          onPress={() => {
                            handled.mutate({ id: message.id })
                          }}
                        />
                      )}
                    </Row>
                  </Group>
                ))}
              </Stack>
            </Async>
          </Panel>
        ) : (
          <Panel title={t('s13.sent')} meta={t('s13.sentMeta')}>
            <Async
              state={[sent]}
              rows={4}
              empty={(sent.data?.items.length ?? 0) === 0}
              emptyMessage={t('s13.noSent')}
            >
              <Group>
                {(sent.data?.items ?? []).map((message) => (
                  <ListRow
                    key={message.id}
                    primary={message.body}
                    secondary={[
                      message.retailerName ?? message.destination,
                      word(message.channel),
                      instantWithClock(message.createdAt),
                    ].join(' · ')}
                    trailing={
                      <StatusChip
                        label={word(message.status)}
                        family={
                          message.status === 'delivered' || message.status === 'read'
                            ? 'moss'
                            : message.status === 'failed'
                              ? 'brick'
                              : 'ochre'
                        }
                      />
                    }
                  />
                ))}
              </Group>
            </Async>
          </Panel>
        )}

        {handled.error === undefined ? null : (
          <Txt field="label" desk="meta" color={colors.status.brick.fg}>
            {handled.error.message}
          </Txt>
        )}
      </Stack>
    </Screen>
  )
}
