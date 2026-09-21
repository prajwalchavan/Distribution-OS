/**
 * Sign in: username + password against auth-service (docs/22 §7). OTP is a later enhancement on top,
 * never a replacement.
 *
 * `tenantId` is deliberately NOT asked for, and for THIS app that is the whole design: a shopkeeper
 * who buys from three distributors on this platform has ONE login, lands in one distributor and
 * switches from the header (docs/23 §6.1 R2). Asking which distributor before the password would ask
 * a question the person cannot answer — they know their shop, not our tenant list.
 *
 * There is no "forgot password" here. `auth.forgotPassword` exists in the contract, but its delivery
 * (SMS / WhatsApp) is not built, so a link that led nowhere would be worse than the true sentence
 * under the button: ask your distributor.
 */
import { useSession } from '@dos/api-client/react'
import {
  Button,
  ErrorState,
  Screen,
  Stack,
  TextInput,
  Txt,
  Welcome,
  useColors,
  useStrings,
} from '@dos/ui'
import { useState } from 'react'

import { APP } from '../src/config'
import { distributorToOpen, rememberDistributor } from '../src/lib/last-distributor'

export default function SignIn(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const { signIn, switchDistributor } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    void signIn({ username: username.trim(), password })
      .then(async (session) => {
        /*
         * DOS-102: land where this DEVICE was last used, not in whichever membership happens to be
         * first. The server has already chosen one (`tenantId` is not asked for at sign-in, by
         * design); this opens the remembered one instead when it is still an active membership.
         */
        const open = distributorToOpen(session.tenant.id, session.memberships)
        if (open === null) {
          rememberDistributor(session.tenant.id)
          return
        }
        const next = await switchDistributor(open)
        rememberDistributor(next.tenant.id)
      })
      .catch((raw: unknown) => {
        setError(raw instanceof Error ? raw.message : t('app.signInFailed'))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <Welcome appTitle={APP.title} role={APP.role}>
      <Screen title={t('app.signInTitle')} context={APP.title}>
        <Stack gap={4} maxWidth={420}>
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
            {t('app.signInBody')}
          </Txt>
        </Stack>
      </Screen>
    </Welcome>
  )
}
