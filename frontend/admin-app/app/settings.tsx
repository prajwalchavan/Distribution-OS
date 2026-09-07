/**
 * P9 — the account, and the devices signed in as it (docs/23 §0 X4).
 *
 * `auth.*` lives on auth-service :3000, not on admin-service — `@dos/api-client` builds the second
 * oRPC client for exactly this reason. Calling it through `api.api` would ask :3007 for a route it
 * does not mount and get a 404.
 *
 * The device list is rows, not a `<Register>`: on a phone a register draws the identity, one value
 * and one chip and DROPS every `detail` column, and on the one screen whose only question is which
 * session to end, the kind and the times ARE the answer.
 */
import { usePlatformApi, usePlatformSession, useMutation, useQuery } from '@dos/api-client/react'
import { Button, Row, Screen, Stack, StatusChip, Txt, useColors, useStrings } from '@dos/ui'
import { useRouter } from 'expo-router'

import { Async, Field, Note, Panel, deviceLabel } from '../src/lib/ui'
import { instantWithClock } from '../src/lib/dates'
import { APP } from '../src/config'

export default function Account(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = usePlatformApi()
  const router = useRouter()
  const { session, signOut } = usePlatformSession()

  const sessions = useQuery(['auth', 'sessions'], () => api.auth.sessions())
  const revoke = useMutation((id: string) => api.auth.revokeSession({ sessionId: id }), {
    invalidates: [['auth', 'sessions']],
  })

  const devices = sessions.data?.items ?? []

  return (
    <Screen title={t('p9.title')} context={APP.brand}>
      <Stack gap={6} maxWidth={720}>
        <Panel title={t('p9.you')} testID="account-you">
          <Stack gap={3}>
            <Field label={t('p9.name')}>{session?.user.name ?? '—'}</Field>
            <Field label={t('p9.username')}>{session?.user.username ?? '—'}</Field>
            <Field label={t('p9.roleLabel')}>{t('word.platform_admin')}</Field>
          </Stack>
        </Panel>

        <Panel
          title={t('p9.devices')}
          testID="account-devices"
          actions={
            <Button
              label={t('p9.changePassword')}
              variant="secondary"
              testID="change-password"
              onPress={() => {
                router.push('/change-password')
              }}
            />
          }
        >
          <Async
            state={[sessions]}
            rows={3}
            empty={devices.length === 0}
            emptyMessage={t('p9.noDevices')}
          >
            <Stack gap={3}>
              {devices.map((device) => (
                <Row
                  key={device.id}
                  justify="between"
                  align="center"
                  gap={4}
                  wrap
                  border="bottom"
                  borderTone="faint"
                  padY={3}
                >
                  <Stack gap={1} grow>
                    <Row gap={2} align="center" wrap>
                      {/*
                        NOT the device id, and NOT the raw user agent either. `device_name` is
                        optional — a script, an API console or an older build signs in without one —
                        and what a BROWSER stores is 120 characters of `Mozilla/5.0 (Macintosh; …`,
                        cut mid-token. Neither is a name a person can act on; `deviceLabel()` reads
                        "Chrome on Mac" out of it, and the times below tell two unnamed devices
                        apart, which is the actual question on this screen.
                      */}
                      <Txt field="bodyStrong" desk="body" numberOfLines={1}>
                        {deviceLabel(device.deviceName, t('p9.unnamedDevice'))}
                      </Txt>
                      {device.current ? (
                        <StatusChip label={t('p9.thisDevice')} family="moss" />
                      ) : null}
                    </Row>
                    <Txt field="label" desk="meta" color={colors.text.secondary}>
                      {`${device.platform === null ? '' : `${t(`word.${device.platform}`)} · `}${t(
                        'p9.signedIn',
                        { when: instantWithClock(device.createdAt) },
                      )} · ${t('p9.lastUsed', { when: instantWithClock(device.lastUsedAt) })}`}
                    </Txt>
                  </Stack>
                  {device.current ? null : (
                    <Button
                      label={t('p9.endSession')}
                      variant="ghost"
                      testID={`revoke-${device.id}`}
                      loading={revoke.status === 'pending'}
                      onPress={() => {
                        revoke.mutate(device.id)
                      }}
                    />
                  )}
                </Row>
              ))}
            </Stack>
          </Async>
        </Panel>

        <Panel title={t('p9.about')} testID="account-about">
          <Note>{t('p9.aboutBody')}</Note>
        </Panel>

        <Button
          label={t('app.signOut')}
          variant="destructive"
          testID="sign-out"
          onPress={() => {
            void signOut()
          }}
        />
      </Stack>
    </Screen>
  )
}
