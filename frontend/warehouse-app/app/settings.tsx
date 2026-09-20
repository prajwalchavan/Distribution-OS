/**
 * W12 / X4 — Me: who is signed in, on what, what this device is holding, and the inbox.
 *
 * The four frame screens of docs/23 §0 end here. It also answers the one question a godown phone
 * raises that a desk browser does not — "what is actually on this device, and is any of it still
 * waiting?" — from the sync engine's own status rather than from a claim.
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
  useColors,
  useStrings,
} from '@dos/ui'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'

import { instantWithClock } from '../src/lib/dates'
import { keepKey } from '../src/lib/keep'
import { useLeave } from '../src/lib/leave-context'
import { Async, Panel } from '../src/lib/ui'

/**
 * A device NAME, out of what the sign-in actually stored (DOS-053).
 *
 * `@dos/api-client` sends the browser's user agent as `deviceName` (120 characters of it), and this list
 * printed it: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 … HeadlessChrome/145…" as
 * the name of the device a picker is being asked to sign out. A phone sign-in stores nothing, so those rows
 * fell back to the platform word. Neither answers the only question this panel asks — WHICH device is this.
 *
 * So: name the browser and the machine when the string is a user agent, and pass anything else through. The
 * raw string is still what the service holds; nothing is lost, it is read. Same shape as the manager, sales
 * and retailer registers, which have had it since DOS-018.
 */
export function deviceLabel(name: string | null | undefined, unnamed: string): string {
  const raw = (name ?? '').trim()
  if (raw === '') return unnamed
  if (!raw.startsWith('Mozilla/')) return raw
  const browser = /\bEdg\//.test(raw)
    ? 'Edge'
    : /\bOPR\//.test(raw)
      ? 'Opera'
      : /\bChrome\//.test(raw)
        ? 'Chrome'
        : /\bFirefox\//.test(raw)
          ? 'Firefox'
          : /\bSafari\//.test(raw)
            ? 'Safari'
            : 'Browser'
  const machine = /iPhone/.test(raw)
    ? 'iPhone'
    : /iPad/.test(raw)
      ? 'iPad'
      : /Android/.test(raw)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(raw)
          ? 'Mac'
          : /Windows/.test(raw)
            ? 'Windows'
            : /Linux/.test(raw)
              ? 'Linux'
              : null
  return machine === null ? browser : `${browser} on ${machine}`
}

export default function Me(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  /** The shell's leave flow (DOS-167 addendum (z1)): the sheet when anything waits, the engine ended, the file swept. */
  const leave = useLeave()
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
  const inbox = useQuery(['messages'], () => api.api.notifications.messages.list({ limit: 20 }), {
    enabled: signedIn,
  })

  const revoke = useMutation(
    (input: { sessionId: string }) => api.auth.revokeSession({ sessionId: input.sessionId }),
    { invalidates: [['auth', 'sessions']] },
  )

  return (
    <Screen title={t('x4.title')} context={session?.tenant.displayName} testID="x4-screen">
      <Stack gap={6}>
        <KpiStrip
          testID="x4-kpis"
          items={[
            { label: t('app.person'), value: me.data?.user.name ?? session?.user.name ?? '—' },
            { label: t('app.role'), value: session?.role ?? '—' },
            { label: t('app.distributor'), value: session?.tenant.displayName ?? '—' },
            /* The label names the thing, the value counts it. It read "13 tables on this device / 0"
               where the 0 was the unsent-ops count — two different facts in one tile. */
            { label: t(keepKey('tables', status.persistent)), value: String(tables) },
          ]}
        />

        <Panel
          title={t('x4.thisDevice')}
          /* Nothing is claimed about keeping while the store is still opening (DOS-167 ruling 3 (ee)). */
          {...(status.persistent === null
            ? {}
            : { meta: status.persistent ? t('x4.storeDisk') : t('x4.storeMemory') })}
          testID="x4-device"
        >
          <Row gap={3} wrap align="center">
            <StatusChip
              label={t('x4.pending', { count: status.pending })}
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
              label={t('tray.title')}
              variant="ghost"
              onPress={() => {
                router.push('/pick/attention')
              }}
              testID="x4-tray"
            />
          </Row>
        </Panel>

        <Panel title={t('x4.devices')} testID="x4-sessions">
          <Async
            state={sessions}
            empty={(sessions.data?.items.length ?? 0) === 0}
            emptyMessage={t('x4.noDevices')}
          >
            <Group>
              {(sessions.data?.items ?? []).map((one) => (
                <ListRow
                  key={one.id}
                  testID={`x4-session-${one.id}`}
                  primary={deviceLabel(one.deviceName, one.platform ?? t('x4.device'))}
                  secondary={instantWithClock(one.lastUsedAt)}
                  trailing={
                    <StatusChip
                      label={one.current ? t('x4.thisDevice') : t('x4.otherDevice')}
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

        <Panel title={t('x4.inbox')} testID="x4-inbox">
          <Async
            state={inbox}
            empty={(inbox.data?.items.length ?? 0) === 0}
            emptyMessage={t('x4.inboxEmpty')}
          >
            <Group>
              {(inbox.data?.items ?? []).map((message) => (
                <ListRow
                  key={message.id}
                  testID={`x4-message-${message.id}`}
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
            label={t('app.changePassword')}
            variant="secondary"
            onPress={() => {
              router.push('/change-password')
            }}
            testID="x4-change-password"
          />
          <Button
            label={t('app.signOut')}
            variant="destructive"
            onPress={() => {
              leave?.({ mode: 'signOut' })
            }}
            testID="x4-sign-out"
          />
        </Row>

        <Dialog
          open={revoking !== null}
          onClose={() => {
            setRevoking(null)
          }}
          title={t('x4.revoke')}
          body={t('x4.revokeBody')}
          confirmLabel={t('x4.revoke')}
          busy={revoke.status === 'pending'}
          onConfirm={() => {
            if (revoking !== null) revoke.mutate({ sessionId: revoking })
            setRevoking(null)
          }}
          testID="x4-revoke-dialog"
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
