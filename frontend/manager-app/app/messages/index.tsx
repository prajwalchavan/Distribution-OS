/**
 * M18 — messages: what we sent, what shops wrote to us, and the wording we send (docs/23 §2.1).
 *
 * Four views of the notifications module:
 *   SENT — the message log with its delivery state; a failed one can be requeued (a delivered one
 *          never is: `messages.resend` refuses it, and the button says so by being absent).
 *   INBOUND — texts and photographs shops sent us, for triage. The text itself is never edited; the
 *          only write is "handled".
 *   WORDING — the platform's default templates plus this distributor's own overrides, per key and
 *          channel. The body shows `{{variables}}` because that IS the template's source text —
 *          an editor that hid them would be editing something else.
 *   BROADCAST — one template to every shop on a beat, queued per shop.
 *
 * Reading is BACK_OFFICE; `templates.upsert` and `broadcasts.create` are owner + manager, so the
 * accountant reads this screen and sends nothing from it.
 */
import type { InboundMessage, Message, Template } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Register,
  Screen,
  Chips,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import { Async, Field, Panel, Refusal, stayOpen, textColumn, useCan } from '../../src/lib/ui'
import { shortInstant } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const MESSAGE_FAMILY: Readonly<Record<string, StatusFamily>> = {
  queued: 'neutral',
  sent: 'ochre',
  delivered: 'moss',
  read: 'moss',
  failed: 'brick',
  skipped: 'neutral',
}

type View = 'outbox' | 'inbound' | 'templates'

export default function Messages(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const can = useCan()

  const mayEdit = can('notifications.templates.upsert')
  const mayBroadcast = can('notifications.broadcasts.create')
  const mayTriage = can('notifications.inbound.markHandled')
  const [view, setView] = useState<View>('outbox')
  const [editing, setEditing] = useState<Template | null>(null)
  const [body, setBody] = useState('')
  const [broadcasting, setBroadcasting] = useState(false)
  const [beatId, setBeatId] = useState<string | null>(null)
  const [templateKey, setTemplateKey] = useState<string | null>(null)

  const outbox = useQuery(
    ['notifications', 'messages'],
    () => api.api.notifications.messages.list({ limit: 200 }),
    { enabled: view === 'outbox' },
  )
  const inbound = useQuery(
    ['notifications', 'inbound'],
    () => api.api.notifications.inbound.list({ limit: 200 }),
    { enabled: view === 'inbound' && can('notifications.inbound.list') },
  )
  const templates = useQuery(
    ['notifications', 'templates'],
    () => api.api.notifications.templates.list({ limit: 200 }),
    { enabled: view === 'templates' || broadcasting },
  )
  const beats = useQuery(['names', 'beats'], () => api.api.retailers.beats.list({}), {
    staleTime: 300_000,
    enabled: broadcasting,
  })

  const resend = useMutation(
    (id: string, meta) =>
      api.api.notifications.messages.resend({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['notifications']] },
  )
  const markHandled = useMutation(
    (id: string, meta) =>
      api.api.notifications.inbound.markHandled({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['notifications']] },
  )
  const saveTemplate = useMutation(
    (input: { template: Template; body: string }, meta) =>
      api.api.notifications.templates.upsert({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        key: input.template.key,
        channel: input.template.channel,
        locale: input.template.locale,
        body: input.body,
      }),
    { invalidates: [['notifications']] },
  )
  const broadcast = useMutation(
    (input: { beatId: string; templateKey: string }, meta) =>
      api.api.notifications.broadcasts.create({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        channel: 'whatsapp',
        templateKey: input.templateKey,
        audience: { kind: 'beat', beatId: input.beatId },
      }),
    { invalidates: [['notifications']] },
  )

  const messageColumns: readonly RegisterColumn<Message>[] = [
    textColumn('template', t('m18.template'), (row) => word(row.templateKey), {
      priority: 'identity',
    }),
    textColumn('channel', t('m18.channel'), (row) => word(row.channel)),
    textColumn('shop', t('m18.shop'), (row) => row.retailerName ?? row.destination ?? null),
    {
      key: 'status',
      head: t('m18.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.status)} family={MESSAGE_FAMILY[row.status] ?? 'neutral'} />
      ),
    },
    textColumn('sent', t('m18.sentAt'), (row) => shortInstant(row.sentAt ?? row.createdAt)),
    textColumn('error', t('m18.failed'), (row) => row.error ?? null),
  ]

  const inboundColumns: readonly RegisterColumn<InboundMessage>[] = [
    textColumn('shop', t('m18.shop'), (row) => row.retailerName ?? row.fromPhone, {
      priority: 'identity',
    }),
    textColumn('text', t('m18.text'), (row) => row.body),
    textColumn('channel', t('m18.channel'), (row) => word(row.channel)),
    textColumn('at', t('m18.received'), (row) => shortInstant(row.receivedAt)),
    {
      key: 'handled',
      head: t('m18.markHandled'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.handled ? t('word.yes') : t('word.no')}
          family={row.handled ? 'moss' : 'ochre'}
        />
      ),
    },
  ]

  const templateColumns: readonly RegisterColumn<Template>[] = [
    textColumn('key', t('m18.template'), (row) => word(row.key), { priority: 'identity' }),
    textColumn('channel', t('m18.channel'), (row) => word(row.channel)),
    textColumn('locale', t('m18.language'), (row) => word(row.locale)),
    textColumn('body', t('m18.body'), (row) => row.body),
    {
      key: 'override',
      head: t('m18.ownWording'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.isOverride ? t('m18.ownWording') : t('m18.defaultWording')}
          family={row.isOverride ? 'moss' : 'neutral'}
        />
      ),
    },
  ]

  return (
    <Screen
      title={t('m18.title')}
      actions={
        <>
          <Segments
            testID="messages-view"
            value={view}
            onChange={(id) => {
              setView(id as View)
            }}
            items={[
              { id: 'outbox', label: t('m18.outbox') },
              { id: 'inbound', label: t('m18.inbound') },
              { id: 'templates', label: t('m18.templates') },
            ]}
          />
          {mayBroadcast ? (
            <Button
              label={t('m18.broadcast')}
              variant="primary"
              onPress={() => {
                setBroadcasting(true)
              }}
              testID="open-broadcast"
            />
          ) : null}
        </>
      }
    >
      <Stack gap={4}>
        {view === 'outbox' ? (
          <Async
            state={[outbox]}
            rows={12}
            empty={(outbox.data?.items.length ?? 0) === 0}
            emptyMessage={t('m18.empty')}
          >
            <Stack gap={2}>
              {/* A row press is the write here, so its refusal sits above the register (DOS-029). */}
              <Refusal of={[resend]} testID="outbox-refusal" />
              <Register
                testID="outbox-register"
                columns={messageColumns}
                rows={outbox.data?.items ?? []}
                rowKey={(row) => row.id}
                frozen="template"
                onSelect={
                  can('notifications.messages.resend')
                    ? (row) => {
                        if (row.status === 'failed') resend.mutate(row.id)
                      }
                    : undefined
                }
                state="ready"
                totals={{ template: t('app.rows', { count: outbox.data?.items.length ?? 0 }) }}
              />
            </Stack>
          </Async>
        ) : view === 'inbound' ? (
          <Async
            state={[inbound]}
            rows={10}
            empty={(inbound.data?.items.length ?? 0) === 0}
            emptyMessage={t('m18.empty')}
          >
            <Stack gap={2}>
              <Refusal of={[markHandled]} testID="inbound-refusal" />
              <Register
                testID="inbound-register"
                columns={inboundColumns}
                rows={inbound.data?.items ?? []}
                rowKey={(row) => row.id}
                frozen="shop"
                onSelect={
                  mayTriage
                    ? (row) => {
                        if (!row.handled) markHandled.mutate(row.id)
                      }
                    : undefined
                }
                state="ready"
              />
            </Stack>
          </Async>
        ) : (
          <Async
            state={[templates]}
            rows={10}
            empty={(templates.data?.items.length ?? 0) === 0}
            emptyMessage={t('m18.empty')}
          >
            <Register
              testID="templates-register"
              columns={templateColumns}
              rows={templates.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="key"
              onSelect={
                mayEdit
                  ? (row) => {
                      setEditing(row)
                      setBody(row.body)
                    }
                  : undefined
              }
              state="ready"
            />
          </Async>
        )}
      </Stack>

      <Sheet
        open={editing !== null}
        onClose={() => {
          setEditing(null)
        }}
        title={editing === null ? undefined : word(editing.key)}
        testID="template-panel"
      >
        {editing === null ? null : (
          <Stack gap={4}>
            <Field label={t('m18.channel')}>{word(editing.channel)}</Field>
            <Field label={t('m18.language')}>{word(editing.locale)}</Field>
            <TextInput
              label={t('m18.body')}
              value={body}
              onChange={setBody}
              capitalize="sentences"
              helper={editing.variables.join(' · ')}
              testID="template-body"
            />
            <Panel>
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {editing.isOverride ? t('m18.ownWording') : t('m18.defaultWording')}
              </Txt>
            </Panel>
            <Refusal of={[saveTemplate]} testID="template-refusal" />
            <Button
              label={t('m18.saveTemplate')}
              variant="primary"
              disabled={body === editing.body}
              disabledReason={t('app.nothingChanged')}
              loading={saveTemplate.status === 'pending'}
              onPress={() => {
                void saveTemplate.mutateAsync({ template: editing, body }).then(() => {
                  setEditing(null)
                }, stayOpen)
              }}
              testID="template-save"
            />
          </Stack>
        )}
      </Sheet>

      <Dialog
        open={broadcasting}
        onClose={() => {
          setBroadcasting(false)
        }}
        title={t('m18.broadcastTitle')}
        body={
          <Stack gap={3}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('m18.pickBeat')}
            </Txt>
            {/*
             * EVERY beat, and every WhatsApp template below — chip rows, not segmented controls.
             *
             * A segmented control is three options wide (UX-00 §6.10) and the kit slices to three,
             * so a broadcast could only ever be sent to the first three of the pilot's ELEVEN
             * beats, using the first three of its EIGHT WhatsApp templates. The rest of the round
             * simply had no way to be messaged.
             */}
            <Chips
              testID="broadcast-beat"
              items={(beats.data?.items ?? []).map((beat) => ({
                id: beat.id,
                label: beat.name,
                selected: (beatId ?? beats.data?.items[0]?.id ?? '') === beat.id,
              }))}
              onToggle={setBeatId}
            />
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('m18.pickTemplate')}
            </Txt>
            <Chips
              testID="broadcast-template"
              items={[
                ...new Map(
                  (templates.data?.items ?? [])
                    .filter((row) => row.channel === 'whatsapp')
                    .map((row) => [
                      row.key,
                      {
                        id: row.key,
                        label: word(row.key),
                        selected:
                          (templateKey ??
                            templates.data?.items.find((first) => first.channel === 'whatsapp')
                              ?.key ??
                            '') === row.key,
                      },
                    ]),
                ).values(),
              ]}
              onToggle={setTemplateKey}
            />
            <Refusal of={[broadcast]} testID="broadcast-refusal" />
          </Stack>
        }
        confirmLabel={t('m18.broadcast')}
        busy={broadcast.status === 'pending'}
        onConfirm={() => {
          const beat = beatId ?? beats.data?.items[0]?.id
          const key = templateKey ?? templates.data?.items[0]?.key
          if (beat === undefined || key === undefined) return
          void broadcast.mutateAsync({ beatId: beat, templateKey: key }).then(() => {
            setBroadcasting(false)
          }, stayOpen)
        }}
        testID="broadcast-dialog"
      />
    </Screen>
  )
}
