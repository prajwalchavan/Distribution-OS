/**
 * SIGN UP — the shopkeeper's own account (founder, 2026-09-29, docs/22 §8 "The shopkeeper is independent").
 *
 * A shopkeeper opens the app and makes an account by themselves: their mobile number, their name, their shop's name
 * as they call it, a username and a password nobody else ever knows. It belongs to no distributor. On success the
 * person is signed in and the root's ladder takes them to "Add a distributor" (`/join`), where they ask a
 * distributor to join them to their shop. The desk-given sign-in stays as a second way in; nothing here touches it.
 *
 * The server answers a taken username and a number that already has an account with ONE sentence that does not say
 * which (so the door tells nobody whether a number is known), and limits sign-ups per address and per number. Both
 * refusals are printed as the server words them.
 *
 * `id` is made ONCE per visit of this form: the same answers sent again after a reply that never arrived sign in
 * instead of being refused. Screens import only `@dos/ui`; the words are the root's (`src/strings.ts`).
 */
import { useSession } from '@dos/api-client/react'
import { newId } from '@dos/api-client'
import { Button, ErrorState, Link, Screen, Stack, TextInput, useStrings } from '@dos/ui'
import { useState } from 'react'

import { toMobile } from '../src/shops/sign-in-forms'

interface Problems {
  phone?: string
  name?: string
  shopName?: string
  username?: string
  password?: string
  again?: string
}

export default function SignUp(): React.JSX.Element {
  const t = useStrings()
  const { signUp } = useSession()
  const [id] = useState(() => newId())
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [shopName, setShopName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [problems, setProblems] = useState<Problems>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const check = (): Problems => {
    const found: Problems = {}
    if (toMobile(phone) === null) found.phone = t('su.mobileBad')
    if (name.trim().length < 2) found.name = t('su.nameNeeded')
    if (shopName.trim().length < 2) found.shopName = t('su.shopNeeded')
    if (username.trim().length < 3) found.username = t('su.usernameNeeded')
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
      found.password = t('app.passwordRule')
    if (again !== password) found.again = t('app.passwordMismatch')
    return found
  }

  const submit = (): void => {
    if (busy) return
    const found = check()
    setProblems(found)
    setError(null)
    const mobile = toMobile(phone)
    if (Object.keys(found).length > 0 || mobile === null) return
    setBusy(true)
    // The ladder moves the new account to "Add a distributor" the moment it is signed in.
    void signUp({
      id,
      phone: mobile,
      username: username.trim().toLowerCase(),
      password,
      name: name.trim(),
      shopName: shopName.trim(),
    })
      .catch((raw: unknown) => {
        setError(raw instanceof Error ? raw.message : t('su.failed'))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <Screen centered title={t('su.title')} subtitle={t('su.subtitle')} testID="sign-up-screen">
      <Stack gap={3}>
        <TextInput
          label={t('su.mobile')}
          value={phone}
          onChange={setPhone}
          keyboard="phone"
          helper={t('su.mobileHelp')}
          error={problems.phone}
          autoFocus
          testID="sign-up-mobile"
        />
        <TextInput
          label={t('su.name')}
          value={name}
          onChange={setName}
          capitalize="words"
          error={problems.name}
          testID="sign-up-name"
        />
        <TextInput
          label={t('su.shopName')}
          value={shopName}
          onChange={setShopName}
          capitalize="words"
          error={problems.shopName}
          testID="sign-up-shop"
        />
        <TextInput
          label={t('su.username')}
          value={username}
          onChange={setUsername}
          helper={t('su.usernameHelp')}
          error={problems.username}
          testID="sign-up-username"
        />
        <TextInput
          label={t('su.password')}
          value={password}
          onChange={setPassword}
          secure
          helper={t('app.passwordRule')}
          error={problems.password}
          testID="sign-up-password"
        />
        <TextInput
          label={t('su.passwordAgain')}
          value={again}
          onChange={setAgain}
          secure
          error={problems.again}
          onSubmit={submit}
          testID="sign-up-password-again"
        />
        {error === null ? null : <ErrorState message={error} testID="sign-up-error" />}
        <Button
          label={t('su.create')}
          onPress={submit}
          variant="primary"
          loading={busy}
          fullWidth
          testID="sign-up-submit"
        />
        <Link href="/sign-in" replace testID="sign-up-have-account">
          {t('su.haveAccount')}
        </Link>
      </Stack>
    </Screen>
  )
}
