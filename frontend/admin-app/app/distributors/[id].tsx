/**
 * P4 — one distributorship.
 *
 * Everything the console does to a customer is on this page: what we know about them (counts, never
 * trade), what they pay us, whether they are allowed to sign in at all, and the support window — the
 * only door into their own data, and one this app cannot open by itself.
 *
 * Suspension is deliberately loud. `admin.tenants.suspend` stops every sign-in to this
 * distributorship from the next token refresh, so the reason is mandatory, the dialog says what will
 * happen in the words it will happen in, and nothing is deleted: reactivating puts it back as it was
 * (the `admin` contract's own note — "never-list item 3's append-only instinct applied to a customer
 * relationship").
 */
import { usePlatformApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  KpiStrip,
  Money,
  Row,
  Screen,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { uuidv7 } from '@dos/domain'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { Async, Columns, Field, Half, Note, Panel, subscriptionFamily } from '../../src/lib/ui'
import { AskForAccess, InsidePanel } from '../../src/lib/support'
import { SubscriptionEditor } from '../../src/lib/subscription'
import { daysFromToday, formatBytes, instantWithClock, longDate } from '../../src/lib/dates'
import { stateName, useWord } from '../../src/lib/words'

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString('en-IN')
}

export default function Distributor(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = usePlatformApi()
  const router = useRouter()
  const params = useLocalSearchParams<{ id: string }>()
  const id = typeof params.id === 'string' ? params.id : ''

  const [asking, setAsking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [suspending, setSuspending] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [reason, setReason] = useState('')

  const tenant = useQuery(['admin', 'tenant', id], () => api.api.admin.tenants.get({ id }), {
    enabled: id !== '',
  })
  const item = tenant.data?.item

  const suspend = useMutation(
    (why: string) =>
      api.api.admin.tenants.suspend({ idempotencyKey: uuidv7(), id, reason: why.trim() }),
    {
      invalidates: [
        ['admin', 'tenant'],
        ['admin', 'tenants'],
        ['admin', 'metrics'],
        ['admin', 'audit'],
      ],
      onSuccess: () => {
        setSuspending(false)
        setReason('')
      },
    },
  )
  const reactivate = useMutation(
    (note: string) =>
      api.api.admin.tenants.reactivate({
        idempotencyKey: uuidv7(),
        id,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      }),
    {
      invalidates: [
        ['admin', 'tenant'],
        ['admin', 'tenants'],
        ['admin', 'metrics'],
        ['admin', 'audit'],
      ],
      onSuccess: () => {
        setReactivating(false)
        setReason('')
      },
    },
  )

  const name = item?.legalName ?? ''

  return (
    <Screen
      title={name === '' ? t('p2.title') : name}
      context={t('p2.title')}
      chips={
        item === undefined ? null : (
          <Row gap={2} wrap>
            <StatusChip
              testID="tenant-status"
              label={word(item.status)}
              family={item.status === 'active' ? 'moss' : 'brick'}
              solid={item.status !== 'active'}
            />
            <StatusChip label={word(item.plan)} family="neutral" />
            <StatusChip
              testID="tenant-subscription"
              /*
               * "Active · Pro · Active" was the chip row before this: the distributorship's own
               * state and its subscription's state are different facts that share a word, and side
               * by side they read as a repetition. The subscription chip names what it is about.
               */
              label={
                item.subscriptionStatus === null
                  ? t('p2.noSubscription')
                  : t('p4.subscriptionChip', { state: word(item.subscriptionStatus) })
              }
              family={subscriptionFamily(item.subscriptionStatus)}
              solid={item.subscriptionStatus === 'past_due'}
            />
          </Row>
        )
      }
      actions={
        item === undefined ? null : item.status === 'active' ? (
          <Button
            label={t('p4.suspend')}
            variant="destructive"
            testID="suspend"
            onPress={() => {
              setSuspending(true)
            }}
          />
        ) : (
          <Button
            label={t('p4.reactivate')}
            variant="primary"
            testID="reactivate"
            onPress={() => {
              setReactivating(true)
            }}
          />
        )
      }
    >
      <Async state={[tenant]} rows={8}>
        {item === undefined ? null : (
          <Stack gap={6}>
            {item.status === 'suspended' ? (
              <Note testID="suspended-notice">{t('p4.suspendedSince')}</Note>
            ) : item.status === 'closed' ? (
              <Note testID="closed-notice">{t('p4.closedNotice')}</Note>
            ) : null}

            <KpiStrip
              testID="tenant-size"
              items={[
                { label: t('p4.staff'), value: count(item.staffCount) },
                { label: t('p4.shops'), value: count(item.retailerCount) },
                { label: t('p4.orders30d'), value: count(item.orders30d) },
                { label: t('p4.invoices30d'), value: count(item.invoices30d) },
                { label: t('p4.storage'), value: formatBytes(item.storageBytes) },
              ]}
            />
            <Note testID="counts-only">{t('app.countsOnly')}</Note>

            <Columns>
              <Half>
                <Panel title={t('p4.identity')} testID="identity">
                  <Stack gap={3}>
                    <Field label={t('p2.name')}>{item.legalName}</Field>
                    <Field label={t('p4.handle')}>{item.slug}</Field>
                    <Field label={t('p4.gstin')}>{item.gstin ?? '—'}</Field>
                    <Field label={t('p4.stateName')}>{stateName(item.stateCode)}</Field>
                    <Field label={t('p4.onPlatform')}>
                      {longDate(item.createdAt.slice(0, 10))}
                    </Field>
                    <Field label={t('p4.lastActivity')}>
                      {item.lastActivityAt === null
                        ? t('app.never')
                        : instantWithClock(item.lastActivityAt)}
                    </Field>
                  </Stack>
                </Panel>
              </Half>
              <Half>
                <Panel
                  title={t('p4.subscription')}
                  testID="subscription"
                  actions={
                    <Button
                      label={t('p4.editSubscription')}
                      variant="secondary"
                      testID="edit-subscription"
                      onPress={() => {
                        setEditing(true)
                      }}
                    />
                  }
                >
                  {item.subscription === null ? (
                    <Txt field="body" desk="body" color={colors.text.secondary}>
                      {t('p2.noSubscription')}
                    </Txt>
                  ) : (
                    <Stack gap={3}>
                      <Field label={t('p5.plan')}>{word(item.subscription.plan)}</Field>
                      <Field label={t('p5.state')}>{word(item.subscription.status)}</Field>
                      <Field label={t('p5.price')}>
                        <Row gap={2} align="center">
                          <Money value={item.subscription.amountPaise} size="moneyM" />
                          <Txt field="label" desk="meta" color={colors.text.secondary}>
                            {word(item.subscription.billingInterval)}
                          </Txt>
                        </Row>
                      </Field>
                      <Field label={t('p5.seats')}>
                        {item.subscription.seats === null ? '—' : item.subscription.seats}
                      </Field>
                      <Field label={t('p5.period')}>
                        {`${longDate(item.subscription.currentPeriodStart)} — ${longDate(item.subscription.currentPeriodEnd)}`}
                      </Field>
                      {/*
                        PAST TENSE for a date that has passed. Two of the founder's three demo
                        distributors carry a trial end of 25 Jan 2018 under a subscription still
                        reading "On trial" (an old seed's arithmetic, recorded with the gate), and
                        "Trial ends 25 Jan 2018" is a promise about a day eight years gone.
                      */}
                      <Field
                        label={
                          item.subscription.trialEndDate !== null &&
                          daysFromToday(item.subscription.trialEndDate) < 0
                            ? t('p5.trialEnded')
                            : t('p5.trialEnds')
                        }
                      >
                        {item.subscription.trialEndDate === null
                          ? '—'
                          : longDate(item.subscription.trialEndDate)}
                      </Field>
                      {item.subscription.note === null ? null : (
                        <Field label={t('p5.note')}>{item.subscription.note}</Field>
                      )}
                    </Stack>
                  )}
                </Panel>
              </Half>
            </Columns>

            <InsidePanel
              testID="inside-panel"
              tenantId={item.id}
              tenantName={item.legalName}
              grants={item.supportGrants.map((grant) => ({
                ...grant,
                tenantId: item.id,
                tenantSlug: item.slug,
                tenantName: item.legalName,
              }))}
              onAsk={() => {
                setAsking(true)
              }}
            />

            <Button
              label={t('p6.title')}
              variant="ghost"
              testID="all-support"
              onPress={() => {
                router.push('/support')
              }}
            />
          </Stack>
        )}
      </Async>

      {item === undefined ? null : (
        <>
          <AskForAccess
            open={asking}
            onClose={() => {
              setAsking(false)
            }}
            tenantId={item.id}
            tenantName={item.legalName}
            testID="ask-sheet"
          />
          <SubscriptionEditor
            open={editing}
            onClose={() => {
              setEditing(false)
            }}
            tenantId={item.id}
            tenantName={item.legalName}
            current={item.subscription}
            testID="subscription-sheet"
          />
          <Dialog
            open={suspending}
            onClose={() => {
              setSuspending(false)
            }}
            title={t('p4.suspendTitle', { name: item.legalName })}
            body={
              <Stack gap={3}>
                <Txt field="body" desk="body">
                  {t('p4.suspendBody', { name: item.legalName })}
                </Txt>
                <TextInput
                  label={t('p4.suspendReason')}
                  value={reason}
                  onChange={setReason}
                  capitalize="sentences"
                  maxLength={500}
                  testID="suspend-reason"
                />
              </Stack>
            }
            confirmLabel={t('p4.suspend')}
            destructive
            busy={suspend.status === 'pending'}
            onConfirm={() => {
              if (reason.trim() === '') return
              suspend.mutate(reason)
            }}
            testID="suspend-dialog"
          />
          <Dialog
            open={reactivating}
            onClose={() => {
              setReactivating(false)
            }}
            title={t('p4.reactivateTitle', { name: item.legalName })}
            body={
              <Stack gap={3}>
                <Txt field="body" desk="body">
                  {t('p4.reactivateBody')}
                </Txt>
                <TextInput
                  label={t('p4.reactivateNote')}
                  value={reason}
                  onChange={setReason}
                  capitalize="sentences"
                  maxLength={500}
                  testID="reactivate-note"
                />
              </Stack>
            }
            confirmLabel={t('p4.reactivate')}
            busy={reactivate.status === 'pending'}
            onConfirm={() => {
              reactivate.mutate(reason)
            }}
            testID="reactivate-dialog"
          />
        </>
      )}
    </Screen>
  )
}
