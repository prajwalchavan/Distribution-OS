/**
 * X4 — my account and my devices (docs/23 §0), reached from the account menu, not the rail.
 *
 * It is one of the four frame screens every app has, and the owner slice recorded it as still
 * unbuilt in the template: a person who signs in on a borrowed phone has to be able to see that the
 * session exists and end it. `auth.sessions` lists every device this SIGN-IN still has open, and
 * `auth.revokeSession` closes one.
 *
 * These live on AUTH-SERVICE :3000, not on manager-service — `client.auth` is the second oRPC client
 * `@dos/api-client` builds for exactly that reason. Calling them through `client.api` would ask
 * :3002 for a route it does not mount.
 *
 * Distributor SETTINGS are deliberately not here: `tenancy.settings.set`, numbering series and
 * feature flags are OWNER-ONLY in the matrix (docs/22 §8: the accountant and the manager have no
 * settings), so this app offers no screen for them at all rather than one that would 403.
 */
import type { AuthSession } from '@dos/contracts'
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Register,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { Async, Field, Panel, Refusal, stayOpen, textColumn } from '../src/lib/ui'
import { instantWithClock } from '../src/lib/dates'
import { useWord } from '../src/lib/words'

/** `auth.sessions` adds `current` to the stored session row; the contract says so, so we read it. */
type SessionRow = AuthSession & { current: boolean }

/**
 * A device NAME, out of what the sign-in actually stored.
 *
 * `@dos/api-client` sends the browser's user agent as `deviceName` (120 characters of it), and this
 * column printed it: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML,
 * like Gecko) …", one row per sign-in, pushing the rest of the register off the screen. A phone
 * sign-in stores nothing, so those rows were a bare UUID. Neither tells the person who is deciding
 * which session to end WHICH DEVICE it is, which is the only question this screen answers.
 *
 * So: name the browser and the machine when the string is a user agent, and say plainly when there
 * is no name at all. The raw string is still what the service holds; nothing is lost, it is read.
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

export default function Account(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const router = useRouter()
  const { session } = useSession()
  const [revoking, setRevoking] = useState<string | null>(null)

  const sessions = useQuery(['auth', 'sessions'], () => api.auth.sessions())
  const revoke = useMutation((id: string) => api.auth.revokeSession({ sessionId: id }), {
    invalidates: [['auth', 'sessions']],
  })

  const rows = (sessions.data?.items ?? []) as readonly SessionRow[]

  const columns: readonly RegisterColumn<SessionRow>[] = [
    textColumn('device', t('x4.device'), (row) => deviceLabel(row.deviceName, t('x4.unnamed')), {
      priority: 'identity',
    }),
    textColumn('platform', t('x4.platform'), (row) => word(row.platform)),
    textColumn('created', t('x4.signedInAt'), (row) => instantWithClock(row.createdAt)),
    textColumn('last', t('x4.lastSeen'), (row) => instantWithClock(row.lastUsedAt)),
    {
      key: 'current',
      head: t('x4.thisDevice'),
      priority: 'chip',
      cell: (row) =>
        row.current ? <StatusChip label={t('x4.thisDevice')} family="moss" /> : <></>,
    },
  ]

  return (
    <Screen title={t('x4.title')}>
      <Stack gap={6}>
        {/* The screen title already says whose account this is; the panel does not repeat it. */}
        <Panel testID="account-identity">
          <Stack gap={3}>
            <Field label={t('x4.name')}>{session?.user.name ?? t('app.none')}</Field>
            <Field label={t('x4.role')}>{word(session?.role)}</Field>
            <Button
              label={t('app.changePassword')}
              variant="secondary"
              onPress={() => {
                router.push('/change-password')
              }}
              testID="account-change-password"
            />
          </Stack>
        </Panel>

        <Panel title={t('x4.devices')} testID="account-devices">
          <Async
            state={[sessions]}
            rows={4}
            empty={rows.length === 0}
            emptyMessage={t('x4.noDevices')}
          >
            <Register
              testID="sessions-register"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              frozen="device"
              onSelect={(row) => {
                if (!row.current) setRevoking(row.id)
              }}
              state="ready"
              totals={{ device: t('app.rows', { count: rows.length }) }}
            />
          </Async>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('x4.revokeBody')}
          </Txt>
        </Panel>
      </Stack>

      <Dialog
        open={revoking !== null}
        onClose={() => {
          setRevoking(null)
        }}
        title={t('x4.revoke')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {t('x4.revokeBody')}
            </Txt>
            <Refusal of={[revoke]} testID="revoke-refusal" />
          </Stack>
        }
        confirmLabel={t('x4.revoke')}
        destructive
        busy={revoke.status === 'pending'}
        onConfirm={() => {
          if (revoking === null) return
          void revoke.mutateAsync(revoking).then(() => {
            setRevoking(null)
          }, stayOpen)
        }}
        testID="revoke-dialog"
      />
    </Screen>
  )
}
