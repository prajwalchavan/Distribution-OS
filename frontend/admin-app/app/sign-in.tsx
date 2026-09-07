/**
 * Sign in — at `POST /auth/platform/login`, not `/auth/login`.
 *
 * A `platform_admin` belongs to no distributorship, so the tenant-picking machinery of the ordinary
 * sign-in is meaningless here and the contract gives this account its own three procedures
 * (`@dos/contracts` `auth.ts`). Everything else is identical: the same password rules, the same
 * lockout after five failures, and the same 401 for an unknown username as for a wrong password —
 * nobody learns from this screen which console accounts exist.
 *
 * This is also the one screen in the product where Distribution OS's own name is the whole heading,
 * because the reader is our staff (docs/22 §9 item 10 covers a distributor's surfaces, not ours).
 */
import { usePlatformSession } from '@dos/api-client/react'
import { Button, ErrorState, Screen, Stack, TextInput, Txt, useColors, useStrings } from '@dos/ui'
import { useState } from 'react'

import { APP } from '../src/config'

export default function SignIn(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const { signIn } = usePlatformSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    void signIn({ username: username.trim(), password })
      .catch((raw: unknown) => {
        setError(raw instanceof Error ? raw.message : t('app.signInFailed'))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <Screen title={t('app.signInTitle')} context={APP.brand}>
      <Stack gap={4} maxWidth={420}>
        <Txt field="body" desk="body" color={colors.text.secondary}>
          {t('app.consoleOnly')}
        </Txt>
        <TextInput
          label={t('app.username')}
          value={username}
          onChange={setUsername}
          autoFocus
          testID="sign-in-username"
        />
        <TextInput
          label={t('app.password')}
          value={password}
          onChange={setPassword}
          secure
          onSubmit={submit}
          testID="sign-in-password"
        />
        {error === null ? null : <ErrorState message={error} />}
        <Button
          label={t('app.signIn')}
          onPress={submit}
          variant="primary"
          loading={busy}
          fullWidth
          testID="sign-in-submit"
        />
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('app.consoleSeparate')}
        </Txt>
      </Stack>
    </Screen>
  )
}
