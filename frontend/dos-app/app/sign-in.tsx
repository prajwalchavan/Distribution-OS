/**
 * Sign in: username + password against auth-service (docs/22 §7), then — for the few people who have
 * a choice — **Continue as …** (docs/31 ruling B3).
 *
 * `tenantId` is deliberately NOT asked for. Omitting it signs a person into their own
 * distributorship; a shopkeeper who buys from three distributors lands in one and switches from the
 * header. Asking up front would make every one of a distributor's own staff answer a question that
 * has one possible answer.
 *
 * THE ROLE IS ASKED FOR, AND THIS IS WHERE. With six apps, installing the delivery app WAS the
 * choice and every sign-in sent `actAs: 'delivery'`. With one app the person elects: the login asks
 * for the role THIS PERSON chose last time here (DOS-210), and if the membership permits more than one role the
 * chooser opens over this screen before anything else renders. A membership with exactly one
 * electable role — every salesperson, every godown hand, every shopkeeper — never sees it.
 *
 * ASKING IS ALL THE DEVICE DOES. The server grants an election only downward from the membership
 * (`ROLE_ELECTION` in `@dos/domain`) and refuses anything else with a sentence the person can act on;
 * that sentence is printed here, at the chooser, which is where ruling B3 puts the refusal now that
 * the wrong-role screen is gone.
 */
import { useSession } from '@dos/api-client/react'
import { ApiError, type Session } from '@dos/api-client'
import type { MembershipRole } from '@dos/contracts'
import {
  Button,
  ErrorState,
  Group,
  ListRow,
  Screen,
  Stack,
  TextInput,
  Txt,
  Welcome,
  useColors,
  useStrings,
} from '@dos/ui'
import { useEffect, useState } from 'react'

import { APP } from '../src/config'
import {
  beginChoosing,
  endChoosing,
  forgetRole,
  lastRole,
  needsChooser,
  permittedRoles,
  preselectedRole,
  rememberRole,
} from '../src/election'

export default function SignIn(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const { session, signIn } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)

  /* Leaving this screen with the ladder still held would strand the person on a blank route. */
  useEffect(
    () => () => {
      endChoosing()
    },
    [],
  )

  /**
   * The login itself, asking for the role this person chose last time on this device (DOS-210).
   *
   * A remembered role the owner has since taken away is a 403 with the refusal sentence — so that one
   * failure, and ONLY that one, is retried without it: the person's password was right and they
   * should be signed in as whatever their membership still is, not told to try again. A wrong
   * password is a 401 and is never retried; a second attempt would spend one of the five tries the
   * lockout counts.
   */
  async function attempt(): Promise<Session> {
    const credentials = { username: username.trim(), password }
    // THIS person's last choice, never the previous person's on a shared desk (DOS-210).
    const remembered = lastRole(credentials.username)
    if (remembered === null) return signIn(credentials)
    try {
      return await signIn({ ...credentials, actAs: remembered })
    } catch (raw: unknown) {
      if (!(raw instanceof ApiError) || raw.status !== 403) throw raw
      forgetRole()
      return signIn(credentials)
    }
  }

  const submit = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    /*
     * HELD FROM BEFORE THE SESSION EXISTS. The root's ladder takes a signed-in person on `/sign-in`
     * straight to their group, and it sees the session the instant `signIn` applies the token —
     * before this `then` has run. Holding it first and releasing it here is the only ordering in
     * which the chooser can be shown at all.
     */
    beginChoosing()
    void attempt()
      .then((next) => {
        /*
         * A password somebody else chose comes first (docs/23 §0 X2): the ladder is already taking
         * them to `/change-password`, and the election waits for the sign-in after it.
         */
        if (!next.user.mustChangePassword && needsChooser(next)) {
          setChoosing(true)
          return
        }
        rememberRole(next.user.username ?? username, next.role)
        endChoosing()
      })
      .catch((raw: unknown) => {
        endChoosing()
        setError(raw instanceof Error ? raw.message : t('app.signInFailed'))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  if (choosing && session !== null) {
    return <ContinueAs session={session} onDone={() => setChoosing(false)} />
  }

  return (
    /*
     * `role` is a constant: `<Welcome>` reads it only to tell the console's tagline from the
     * product's, and `APP.role` went with the six configs (ruling B3). This app is never the console.
     */
    <Welcome appTitle={APP.title} role="member">
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
            {t('app.signInHelp')}
          </Txt>
        </Stack>
      </Screen>
    </Welcome>
  )
}

/**
 * **Continue as …** — one row per role this membership permits, the last-chosen one preselected.
 *
 * Picking the role the token already carries costs nothing: the login asked for it and the session is
 * already that role. Picking another is a FRESH ELECTION — `electRole` mints a new token from
 * auth-service, which re-validates the choice against the membership and its extra roles as they are
 * NOW. The app never changes role by deciding to render a different group: that token would keep
 * reaching the old role's service for the life of its refresh, on a phone that is shared and
 * droppable.
 */
function ContinueAs({
  session,
  onDone,
}: {
  session: Session
  onDone: () => void
}): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const { electRole } = useSession()
  const roles = permittedRoles(session)
  const [picked, setPicked] = useState<MembershipRole>(() => preselectedRole(session))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remembered = lastRole(session.user.username)

  const go = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    const done = (): void => {
      rememberRole(session.user.username, picked)
      // The ladder is released LAST: the group it moves to is the one this token now carries.
      onDone()
      endChoosing()
    }
    if (picked === session.role) {
      done()
      setBusy(false)
      return
    }
    void electRole(picked)
      .then(done)
      .catch((raw: unknown) => {
        // docs/29 §2's own sentence, straight from the server: "ask the owner to add … to it."
        setError(raw instanceof Error ? raw.message : t('elect.failed'))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <Screen title={t('elect.title')} context={session.tenant.displayName}>
      <Stack gap={4} maxWidth={420}>
        <Txt field="body" desk="body" color={colors.text.secondary}>
          {t('elect.body')}
        </Txt>
        <Group>
          {roles.map((role) => (
            <ListRow
              key={role}
              primary={t(`role.${role}`)}
              secondary={role === remembered ? t('elect.lastTime') : undefined}
              state={role === picked ? 'selected' : 'default'}
              onPress={() => {
                setPicked(role)
              }}
              testID={`elect-${role}`}
            />
          ))}
        </Group>
        {error === null ? null : <ErrorState message={error} />}
        <Button
          label={busy ? t('elect.changing') : t('elect.continue')}
          onPress={go}
          variant="primary"
          loading={busy}
          fullWidth
          testID="elect-continue"
        />
      </Stack>
    </Screen>
  )
}
