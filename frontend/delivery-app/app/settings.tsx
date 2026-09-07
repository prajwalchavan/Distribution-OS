/**
 * D12 / X4 — Me: who is signed in, on what, what this phone is holding, and the inbox.
 *
 * It also answers the one question a crew phone raises that a desk browser does not — "what is
 * actually on this device, and is any of it still waiting?" — from the sync engine's own status
 * rather than from a claim, and it says out loud whether the store survives a restart.
 *
 * The DPDP answer lives here too, because withdrawing it is not something to bury: a crew member who
 * agreed to location tracking can see that they did, and refuse it from the same screen. The trip
 * stops being tracked immediately; `trips.depart` will refuse the next trip until they agree again,
 * which is exactly what the notice promised.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import { useSyncEngine, useSyncStatus } from '@dos/offline/react'
import {
  Button,
  Dialog,
  Group,
  KpiStrip,
  ListRow,
  Row,
  Screen,
  Stack,
  StatusChip,
  Txt,
  formatCount,
  formatINR,
  useColors,
  useStrings,
} from '@dos/ui'
import { paise } from '@dos/domain'
import { isMoneyMetric } from '@dos/contracts'
import type { TargetMetric } from '@dos/contracts'

/** `isMoneyMetric` is the ONE place that decides whether a figure is paise (docs/23, incentives). */
const money = (metric: TargetMetric): boolean => isMoneyMetric(metric)
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'

import { deviceId } from '../src/api'
import { GPS_NOTICE_VERSION } from '../src/config'
import { instantWithClock } from '../src/lib/dates'
import { Async, Panel } from '../src/lib/ui'

export default function Me(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session, signOut } = useSession()
  const signedIn = session !== null
  const engine = useSyncEngine()
  const status = useSyncStatus()
  const [tables, setTables] = useState(0)
  const [revoking, setRevoking] = useState<string | null>(null)

  useEffect(() => {
    setTables(engine?.tables().length ?? 0)
  }, [engine, status.schemaVersion])

  const me = useQuery(['auth', 'me'], () => api.auth.me(), { enabled: signedIn })
  const sessions = useQuery(['auth', 'sessions'], () => api.auth.sessions(), { enabled: signedIn })
  const inbox = useQuery(
    ['messages', 'mine'],
    () => api.api.notifications.messages.list({ limit: 20 }),
    {
      enabled: signedIn,
    },
  )
  const consent = useQuery(['consent', 'mine'], () => api.api.delivery.consents.get({}), {
    enabled: signedIn,
  })
  const targets = useQuery(['incentives', 'mine'], () => api.api.incentives.progress.mine({}), {
    enabled: signedIn,
  })

  const revoke = useMutation(
    (input: { sessionId: string }) => api.auth.revokeSession({ sessionId: input.sessionId }),
    { invalidates: [['auth', 'sessions']] },
  )

  const withdraw = useMutation(
    (_input: Record<string, never>, meta) =>
      api.api.delivery.consents.grant({
        idempotencyKey: meta.idempotencyKey,
        id: meta.id,
        granted: false,
        noticeVersion: GPS_NOTICE_VERSION,
        locale: 'en-IN',
        deviceId: deviceId(),
      }),
    { invalidates: [['consent']] },
  )

  const granted = consent.data?.item?.granted === true

  return (
    <Screen title={t('d12.title')} context={session?.tenant.displayName} testID="d12-screen">
      <Stack gap={6}>
        <KpiStrip
          testID="d12-kpis"
          items={[
            { label: t('app.person'), value: me.data?.user.name ?? session?.user.name ?? '—' },
            { label: t('app.role'), value: session?.role ?? '—' },
            { label: t('app.distributor'), value: session?.tenant.displayName ?? '—' },
            { label: t('d12.tablesLabel'), value: String(tables) },
          ]}
        />

        <Panel
          title={t('d12.thisDevice')}
          meta={status.persistent ? t('tray.storeDisk') : t('tray.storeMemory')}
          testID="d12-device"
        >
          <Row gap={3} wrap align="center">
            <StatusChip
              label={t('d12.pending', { count: status.pending })}
              family={status.pending === 0 ? 'moss' : 'ochre'}
              figure
            />
            <StatusChip
              label={t('tray.rejectedCount', { count: status.rejected })}
              family={status.rejected === 0 ? 'neutral' : 'brick'}
              solid={status.rejected > 0}
              figure
            />
            <Button
              testID="d12-tray"
              label={t('tray.title')}
              variant="ghost"
              onPress={() => {
                router.push('/attention')
              }}
            />
          </Row>
        </Panel>

        <Panel title={t('d12.consent')} testID="d12-consent">
          <Stack gap={3}>
            <StatusChip
              testID="d12-consent-state"
              label={
                granted
                  ? t('d2.consentGiven', {
                      when: instantWithClock(consent.data?.item?.grantedAt ?? null),
                    })
                  : t('d2.consentRefused')
              }
              family={granted ? 'moss' : 'neutral'}
            />
            {granted ? (
              <Button
                testID="d12-withdraw"
                label={t('d2.consentRefuse')}
                variant="destructive"
                loading={withdraw.status === 'pending'}
                onPress={() => {
                  withdraw.mutate({})
                }}
              />
            ) : (
              <Button
                testID="d12-grant"
                label={t('d2.consentAgree')}
                variant="secondary"
                onPress={() => {
                  router.push('/trip/start')
                }}
              />
            )}
          </Stack>
        </Panel>

        <Panel title={t('d12.target')} testID="d12-targets">
          <Async
            state={targets}
            empty={(targets.data?.items.length ?? 0) === 0}
            emptyMessage={t('d12.noTarget')}
          >
            <Group>
              {(targets.data?.items ?? []).map((target) => (
                <ListRow
                  key={target.id}
                  testID={`d12-target-${target.id}`}
                  primary={target.name}
                  /*
                   * A `value` metric IS PAISE (`isMoneyMetric` in `@dos/contracts` is the one place
                   * that decides). Printed through `formatCount` the caption read
                   * "1,54,10,538 of 9,00,00,000" — a hundred times the rupees, right under a
                   * trailing figure that said ₹1,54,105.38. Two numbers for one fact, disagreeing.
                   */
                  secondary={t('d12.targetProgress', {
                    achieved: money(target.metric)
                      ? formatINR(paise(target.achievement?.achievedValue ?? 0))
                      : formatCount(target.achievement?.achievedValue ?? 0),
                    target: money(target.metric)
                      ? formatINR(paise(target.targetValue))
                      : formatCount(target.targetValue),
                  })}
                  {...(money(target.metric)
                    ? {
                        trailingMoney: target.achievement?.achievedValue ?? null,
                        trailingSize: 'moneyM' as const,
                      }
                    : {})}
                  trailing={
                    <StatusChip
                      label={`${String(Math.round((target.achievement?.achievedPct ?? 0) / 100))}%`}
                      family={(target.achievement?.achievedPct ?? 0) >= 10000 ? 'moss' : 'ochre'}
                      figure
                    />
                  }
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('d12.devices')} testID="d12-sessions">
          <Async
            state={sessions}
            empty={(sessions.data?.items.length ?? 0) === 0}
            emptyMessage={t('d12.noDevices')}
          >
            <Group>
              {(sessions.data?.items ?? []).map((one) => (
                <ListRow
                  key={one.id}
                  testID={`d12-session-${one.id}`}
                  primary={one.deviceName ?? one.platform ?? t('d12.device')}
                  secondary={instantWithClock(one.lastUsedAt)}
                  trailing={
                    <StatusChip
                      label={one.current ? t('d12.thisDevice') : t('d12.otherDevice')}
                      family={one.current ? 'moss' : 'neutral'}
                    />
                  }
                  {...(one.current
                    ? {}
                    : {
                        onPress: () => {
                          setRevoking(one.id)
                        },
                      })}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('d12.inbox')} testID="d12-inbox">
          <Async
            state={inbox}
            empty={(inbox.data?.items.length ?? 0) === 0}
            emptyMessage={t('d12.inboxEmpty')}
          >
            <Group>
              {(inbox.data?.items ?? []).map((message) => (
                <ListRow
                  key={message.id}
                  testID={`d12-message-${message.id}`}
                  primary={message.body}
                  secondary={instantWithClock(message.createdAt)}
                  trailing={<StatusChip label={message.channel} family="neutral" />}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Row gap={12} wrap justify="between">
          <Button
            testID="d12-change-password"
            label={t('app.changePassword')}
            variant="secondary"
            onPress={() => {
              router.push('/change-password')
            }}
          />
          <Button
            testID="d12-sign-out"
            label={t('app.signOut')}
            variant="destructive"
            onPress={() => {
              void signOut()
            }}
          />
        </Row>

        <Dialog
          testID="d12-revoke-dialog"
          open={revoking !== null}
          onClose={() => {
            setRevoking(null)
          }}
          title={t('d12.revoke')}
          body={t('d12.revokeBody')}
          confirmLabel={t('d12.revoke')}
          busy={revoke.status === 'pending'}
          onConfirm={() => {
            if (revoking !== null) revoke.mutate({ sessionId: revoking })
            setRevoking(null)
          }}
        />

        {revoke.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg}>
            {revoke.error.message}
          </Txt>
        )}
      </Stack>
    </Screen>
  )
}
