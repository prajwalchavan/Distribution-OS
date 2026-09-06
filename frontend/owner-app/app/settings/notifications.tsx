/**
 * O23 — messages and templates (docs/23 §1.1).
 *
 * Every WhatsApp, SMS, push and in-app line this distributorship has sent, what it cost, and the
 * templates it was sent from. A failed message can be sent again; an inbound reply can be marked
 * handled. The sender identity is the distributor's own (UX-00 §11), which is why the template body
 * carries `{{distributorName}}` rather than a product name.
 */
import type { InboundMessage, Message, Template } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Money,
  Register,
  Screen,
  Segments,
  Stack,
  StatusChip,
  Txt,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import { Async, PageTabs, moneyColumn, textColumn } from '../../src/lib/ui'
import { instantWithClock, rangeOf } from '../../src/lib/dates'

const MESSAGE_FAMILY: Readonly<Record<string, StatusFamily>> = {
  queued: 'neutral',
  sent: 'ochre',
  delivered: 'moss',
  read: 'moss',
  failed: 'brick',
  skipped: 'neutral',
}

type View = 'messages' | 'templates' | 'inbound'

export default function Notifications(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const [view, setView] = useState<View>('messages')

  const span = rangeOf('d30')
  const messages = useQuery(['notifications', 'messages', span.from, span.to], () =>
    api.api.notifications.messages.list({ from: span.from, to: span.to, limit: 200 }),
  )
  const templates = useQuery(
    ['notifications', 'templates'],
    () => api.api.notifications.templates.list({}),
    { enabled: view === 'templates' },
  )
  const inbound = useQuery(
    ['notifications', 'inbound'],
    () => api.api.notifications.inbound.list({ limit: 100 }),
    { enabled: view === 'inbound' },
  )

  const resend = useMutation(
    (id: string, meta) =>
      api.api.notifications.messages.resend({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['notifications']] },
  )
  const markHandled = useMutation(
    (id: string, meta) =>
      api.api.notifications.inbound.markHandled({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['notifications', 'inbound']] },
  )

  const messageColumns: readonly RegisterColumn<Message>[] = [
    textColumn('channel', t('o23.channel'), (row) => row.channel, { priority: 'detail' }),
    textColumn('to', t('o23.destination'), (row) => row.retailerName ?? row.destination, {
      priority: 'identity',
    }),
    textColumn('template', t('o23.key'), (row) => row.templateKey),
    textColumn('body', t('o23.body'), (row) => row.body),
    moneyColumn('cost', t('o23.cost'), (row) => row.costPaise ?? null),
    {
      key: 'status',
      head: t('o23.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.status}
          family={MESSAGE_FAMILY[row.status] ?? 'neutral'}
          solid={row.status === 'failed'}
        />
      ),
    },
    textColumn('sent', t('o23.sent'), (row) => instantWithClock(row.sentAt)),
    {
      key: 'action',
      head: t('o23.resend'),
      cell: (row) =>
        row.status === 'failed' ? (
          <Button
            label={t('o23.resend')}
            variant="ghost"
            size="desk"
            onPress={() => {
              resend.mutate(row.id)
            }}
          />
        ) : (
          <Txt field="body" desk="cell">
            {row.error ?? '—'}
          </Txt>
        ),
    },
  ]

  const templateColumns: readonly RegisterColumn<Template>[] = [
    textColumn('key', t('o23.key'), (row) => row.key, { priority: 'identity' }),
    textColumn('channel', t('o23.channel'), (row) => row.channel),
    textColumn('locale', t('o24.stateCode'), (row) => row.locale),
    textColumn('body', t('o23.body'), (row) => row.body),
    {
      key: 'override',
      head: t('word.active'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.isOverride ? t('word.yes') : t('word.no')}
          family={row.isOverride ? 'ochre' : 'neutral'}
        />
      ),
    },
  ]

  const inboundColumns: readonly RegisterColumn<InboundMessage>[] = [
    textColumn('from', t('o23.destination'), (row) => row.retailerName ?? row.fromPhone, {
      priority: 'identity',
    }),
    textColumn('body', t('o23.body'), (row) => row.body),
    textColumn('when', t('o23.sent'), (row) => instantWithClock(row.receivedAt)),
    {
      key: 'handled',
      head: t('o23.markHandled'),
      cell: (row) =>
        row.handled ? (
          <StatusChip label={t('word.yes')} family="moss" />
        ) : (
          <Button
            label={t('o23.markHandled')}
            variant="ghost"
            size="desk"
            onPress={() => {
              markHandled.mutate(row.id)
            }}
          />
        ),
    },
  ]

  return (
    <Screen
      title={t('o23.title')}
      chips={<PageTabs group="/settings" active="/settings/notifications" />}
      actions={
        <Segments
          size="desk"
          value={view}
          onChange={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'messages', label: t('o23.messages') },
            { id: 'templates', label: t('o23.templates') },
            { id: 'inbound', label: t('o23.inbound') },
          ]}
          testID="notifications-view"
        />
      }
    >
      <Stack gap={4}>
        {view === 'messages' ? (
          <Async
            state={[messages]}
            rows={10}
            empty={(messages.data?.items.length ?? 0) === 0}
            emptyMessage={t('o23.empty')}
          >
            <Register
              testID="messages-register"
              columns={messageColumns}
              rows={messages.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="to"
              state="ready"
              totals={{
                to: t('word.total'),
                cost: (
                  <Money
                    value={(messages.data?.items ?? []).reduce(
                      (sum, row) => sum + (row.costPaise ?? 0),
                      0,
                    )}
                    size="cell"
                    symbol={false}
                  />
                ),
              }}
            />
          </Async>
        ) : null}

        {view === 'templates' ? (
          <Async state={[templates]} rows={8} empty={(templates.data?.items.length ?? 0) === 0}>
            <Register
              testID="templates-register"
              columns={templateColumns}
              rows={templates.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="key"
              state="ready"
            />
          </Async>
        ) : null}

        {view === 'inbound' ? (
          <Async state={[inbound]} rows={8} empty={(inbound.data?.items.length ?? 0) === 0}>
            <Register
              testID="inbound-register"
              columns={inboundColumns}
              rows={inbound.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="from"
              state="ready"
            />
          </Async>
        ) : null}
      </Stack>
    </Screen>
  )
}
