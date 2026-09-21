/**
 * docs/29 §1 Welcome — the first screen of every app, for React DOM.
 *
 * Four things and no fifth: the Distribution OS wordmark, one line saying what the product is, this
 * app's own name, and one button that opens today's sign-in form unchanged. This is one of exactly
 * two surfaces where the product's own mark appears at all (the other is the console's chrome): the
 * moment a session exists, the distributor's own name and logo take over (UX-00 §11).
 *
 * SHOWN ONCE PER DEVICE, not on every launch. A driver at 6 am opens straight into the trip. The
 * "once" is a flag in `platform.storage` set the moment **Sign in** is pressed — not when the
 * sign-in succeeds, because a wrong password is not a reason to read the introduction again — and
 * cleared by the root layout whenever the session goes away, whichever of an app's sign-out paths
 * got there.
 *
 * The flag is read SYNCHRONOUSLY here, which is a thing only the web half can do: `localStorage` is
 * synchronous, so a returning device renders the form on its first frame with no flash of a screen
 * it has already been past. The native half reads SecureStore, which is not, and says so in its own
 * file — the one real difference between the two implementations of this component.
 */
import { useCallback, useState } from 'react'

import { storage } from '../platform/storage.web.js'
import { appShortName } from '../strings.js'
import { useTheme } from '../theme.js'
import type { WelcomeProps } from '../types.js'
import { Txt } from './base.js'
import { Button } from './controls.js'
import { Screen, Stack } from './layout.js'

/** One key, one device. Its presence is the whole state; the value is never read. */
const SEEN_KEY = 'dos.welcome.seen'

/** Has this device already been past the welcome? */
export function welcomeSeen(): boolean {
  return storage.getItemSync(SEEN_KEY) !== null
}

/** "Sign in" was pressed. The welcome has done its work until somebody signs out. */
export function markWelcomeSeen(): void {
  storage.setItemSync(SEEN_KEY, '1')
}

/** The session is gone: the next person on this device gets the welcome. */
export function clearWelcomeSeen(): void {
  storage.setItemSync(SEEN_KEY, null)
}

export function Welcome({ appTitle, role, children, testID }: WelcomeProps): React.JSX.Element {
  const theme = useTheme()
  const [seen, setSeen] = useState(welcomeSeen)
  const enter = useCallback(() => {
    markWelcomeSeen()
    setSeen(true)
  }, [])

  if (seen) return <>{children}</>

  return (
    <Screen testID={testID}>
      <Stack gap={6} maxWidth={420} center>
        <Stack gap={2}>
          {/* The wordmark is TYPESET, not an image: one product name, three targets, no asset. */}
          <Txt field="hero" desk="kpi" as="h1" testID="welcome-wordmark">
            {theme.t('welcome.product')}
          </Txt>
          <Txt field="body" desk="body" color={theme.colors.text.secondary}>
            {theme.t(role === 'platform_admin' ? 'welcome.console' : 'welcome.tagline')}
          </Txt>
        </Stack>
        <Txt field="title" desk="pageTitle" testID="welcome-app">
          {appShortName(appTitle)}
        </Txt>
        <Button
          label={theme.t('welcome.signIn')}
          onPress={enter}
          variant="primary"
          fullWidth
          testID="welcome-sign-in"
        />
      </Stack>
    </Screen>
  )
}
