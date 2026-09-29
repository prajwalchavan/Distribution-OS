/**
 * X2 of `docs/23` §0: the forced password change, the second of the four frame screens every app has.
 *
 * Staff accounts are created with a TEMPORARY password — `tenancy.staff.create` and the platform
 * console's onboarding both set `must_change_password` — and the manager reads it out loud to the
 * person; a shop's sign-in gets a first password the same way (DOS-400). The layout every app shares
 * sends such a session here, and until the flag is cleared no other route renders. The SERVER holds
 * the same line since the architect's ruling of 2026-09-29 (docs/22 §8): every service refuses that
 * session with "Choose your own password first…", and the change answers with a token that is no
 * longer walled, which the client puts in place before this screen moves on. A new password equal to
 * the current one is refused here and on the server: keeping the desk's password is not choosing one.
 *
 * The same screen serves a voluntary change from Settings; only the way in differs.
 */
import { useSession } from '@dos/api-client/react'
import { Button, ErrorState, Screen, Stack, TextInput, Txt, useColors, useStrings } from '@dos/ui'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { APP } from '../src/config'

/** `PasswordSchema` in `@dos/contracts`: 8-72 characters, at least one letter and one digit. */
const MIN_LENGTH = 8
function weak(password: string): boolean {
  return password.length < MIN_LENGTH || !/[A-Za-z]/.test(password) || !/\d/.test(password)
}

export default function ChangePassword(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const { session, changePassword } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const forced = session?.user.mustChangePassword === true
  const mismatch = again !== '' && next !== again
  const same = next !== '' && next === current
  const blocked = busy || current === '' || weak(next) || next !== again || same
  /** UX-00 §6.1: a disabled button always prints WHY, never a grey word with no cause. */
  const reason =
    current === ''
      ? t('app.passwordNeedsCurrent')
      : weak(next)
        ? t('app.passwordRule')
        : same
          ? t('app.passwordSame')
          : t('app.passwordMismatch')

  const submit = (): void => {
    if (blocked) return
    setBusy(true)
    setError(null)
    void changePassword(current, next)
      .then(() => {
        /*
         * The client re-reads `auth.me`, so the session's own flag is already false here. `/` is the
         * ONE root route of the one app: the root's ladder reads the elected role off the token and
         * moves the person into their own group from there (docs/31 §1.3 step 7). This screen does
         * not know which group that is, and must not: it is the same screen for all six.
         */
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
    /* In the middle of the window, like sign-in (founder, 2026-09-28). The words are unchanged. */
    <Screen
      centered
      title={t('app.changePassword')}
      context={forced ? APP.title : (session?.tenant.displayName ?? APP.title)}
      subtitle={forced ? t('app.passwordForced') : t('app.passwordVoluntary')}
    >
      <Stack gap={3}>
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
          {...(same ? { error: t('app.passwordSame') } : {})}
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
