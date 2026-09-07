/**
 * X4 — my account and my devices (docs/23 §0), one of the four frame screens every app has.
 *
 * A shopkeeper signs in on a borrowed phone more often than any staff member does, so being able to
 * see that a session exists elsewhere and end it is not a nicety here. `auth.sessions` lists every
 * device this SIGN-IN still has open; `auth.revokeSession` closes one.
 *
 * These live on AUTH-SERVICE :3000, not on retailer-service — `client.auth` is the second oRPC client
 * `@dos/api-client` builds for exactly that reason. Calling them through `client.api` would ask :3006
 * for a route it does not mount.
 *
 * DISTRIBUTOR settings are deliberately absent: `tenancy.settings.*` refuses the retailer role in the
 * matrix, and a shop has no business in its distributor's numbering series or feature flags.
 */
import type { AuthSession } from '@dos/contracts'
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Group,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { instantWithClock } from '../src/lib/dates'
import { Async, Field, Panel, TwoLine } from '../src/lib/ui'
import { useWord } from '../src/lib/words'

/** `auth.sessions` adds `current` to the stored session row; the contract says so, so we read it. */
type SessionRow = AuthSession & { current: boolean }

/**
 * A device NAME out of what the sign-in actually stored.
 *
 * `@dos/api-client` sends the browser's user agent as `deviceName`, and a column that printed it
 * verbatim would push the rest of the register off a 375 px phone with "Mozilla/5.0 (Macintosh; …)".
 * A phone sign-in stores nothing at all, so those rows would be a bare uuid. Neither tells the person
 * deciding which session to end WHICH DEVICE it is, which is the only question this screen answers.
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

  return (
    <Screen title={t('x4.title')} context={session?.tenant.displayName} testID="x4-screen">
      <Stack gap={6}>
        <Panel testID="x4-identity">
          <Stack gap={3}>
            <Field label={t('x4.name')}>{session?.user.name ?? t('app.none')}</Field>
            <Field label={t('x4.role')}>{word(session?.role)}</Field>
            <Button
              label={t('app.changePassword')}
              variant="secondary"
              onPress={() => {
                router.push('/change-password')
              }}
              testID="x4-change-password"
            />
          </Stack>
        </Panel>

        <Panel title={t('x4.devices')} testID="x4-devices">
          <Async
            state={[sessions]}
            rows={4}
            empty={rows.length === 0}
            emptyMessage={t('x4.noDevices')}
          >
            {/*
              ROWS, NOT A REGISTER.

              `<Register>` in `field` density draws the identity column, one `value` column and one
              `chip` column and DROPS every `detail` column (UX-00 §6.7 — the phone rendering). This
              app is `field` density at every width, so the four columns that say WHICH device a row
              is — its kind, when it signed in, when it was last used — were never drawn. Measured on
              the founder's own account: forty-one rows reading "Safari on Mac", "Safari on Mac",
              "Unnamed device" … with no date anywhere, on the one screen whose only question is
              which of them to sign out. It is the same defect the statement had.
            */}
            <Group>
              {rows.map((row) => (
                <TwoLine
                  key={row.id}
                  primary={deviceLabel(row.deviceName, t('x4.unnamed'))}
                  secondary={t('x4.seenLine', {
                    platform: word(row.platform),
                    signedIn: instantWithClock(row.createdAt),
                    lastSeen: instantWithClock(row.lastUsedAt),
                  })}
                  trailing={
                    row.current ? (
                      <StatusChip label={t('x4.thisDevice')} family="moss" />
                    ) : (
                      <Txt field="label" desk="meta" color={colors.text.secondary}>
                        {t('x4.revoke')}
                      </Txt>
                    )
                  }
                  {...(row.current
                    ? {}
                    : {
                        onPress: () => {
                          setRevoking(row.id)
                        },
                      })}
                  testID={`x4-session-${row.id}`}
                />
              ))}
            </Group>
          </Async>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {`${t('x4.deviceCount', { count: rows.length })} · ${t('x4.revokeBody')}`}
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
          <Txt field="body" desk="body">
            {t('x4.revokeBody')}
          </Txt>
        }
        confirmLabel={t('x4.revoke')}
        destructive
        busy={revoke.status === 'pending'}
        onConfirm={() => {
          if (revoking === null) return
          void revoke.mutateAsync(revoking).then(
            () => {
              setRevoking(null)
            },
            () => {
              setRevoking(null)
            },
          )
        }}
        testID="x4-revoke-dialog"
      />
    </Screen>
  )
}
