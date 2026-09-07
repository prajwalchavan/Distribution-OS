/**
 * X2 of `docs/23` §0, on the console: the forced password change.
 *
 * A console account can be handed over with a TEMPORARY password like any other, and the auth
 * service reports the flag rather than refusing the API — so this is where it is honoured. Until it
 * is cleared, `app/_layout.tsx` renders nothing else. The same screen serves a voluntary change from
 * Account; only the way in differs.
 */
import { usePlatformSession } from '@dos/api-client/react'
import { Button, ErrorState, Screen, Stack, TextInput, Txt, useColors, useStrings } from '@dos/ui'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { APP } from '../src/config'

/** `PasswordSchema` in `@dos/contracts`: 8–72 characters, at least one letter and one digit. */
const MIN_LENGTH = 8
function weak(password: string): boolean {
  return password.length < MIN_LENGTH || !/[A-Za-z]/.test(password) || !/\d/.test(password)
}

export default function ChangePassword(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const { session, changePassword } = usePlatformSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const forced = session?.user.mustChangePassword === true
  const mismatch = again !== '' && next !== again
  const blocked = busy || current === '' || weak(next) || next !== again
  /** UX-00 §6.1: a disabled button always prints WHY, never a grey word with no cause. */
  const reason =
    current === ''
      ? t('app.passwordNeedsCurrent')
      : weak(next)
        ? t('app.passwordRule')
        : t('app.passwordMismatch')

  const submit = (): void => {
    if (blocked) return
    setBusy(true)
    setError(null)
    void changePassword(current, next)
      .then(() => {
        // The client re-reads `auth.platformMe`, so the session's own flag is already false here.
        router.replace('/')
      })
      .catch((raw: unknown) => {
        setError(raw instanceof Error ? raw.message : t('app.passwordFailed'))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <Screen title={t('app.changePassword')} context={forced ? APP.title : APP.brand}>
      <Stack gap={4} maxWidth={420}>
        <Txt field="body" desk="body" color={colors.text.secondary}>
          {forced ? t('app.passwordForced') : t('app.passwordVoluntary')}
        </Txt>
        <TextInput
          label={t('app.currentPassword')}
          value={current}
          onChange={setCurrent}
          secure
          autoFocus
          testID="change-password-current"
        />
        <TextInput
          label={t('app.newPassword')}
          value={next}
          onChange={setNext}
          secure
          helper={t('app.passwordRule')}
          testID="change-password-new"
        />
        <TextInput
          label={t('app.repeatPassword')}
          value={again}
          onChange={setAgain}
          secure
          onSubmit={submit}
          {...(mismatch ? { error: t('app.passwordMismatch') } : {})}
          testID="change-password-repeat"
        />
        {error === null ? null : <ErrorState message={error} />}
        <Button
          label={t('app.setPassword')}
          onPress={submit}
          variant="primary"
          loading={busy}
          disabled={blocked}
          {...(blocked && !busy ? { disabledReason: reason } : {})}
          fullWidth
          testID="change-password-submit"
        />
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('app.passwordRevokes')}
        </Txt>
      </Stack>
    </Screen>
  )
}
