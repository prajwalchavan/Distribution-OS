/**
 * This app's own string namespace, merged over the kit catalogue by `<ThemeProvider strings={...}>`.
 *
 * English only for the pilot (founder, 2026-09-05) — and every user-visible word already has a locale
 * key, so Hindi and Marathi are a translation file, never a rewrite. No component in this app
 * contains a literal English sentence.
 */
export const strings = {
  'app.home': 'Today',
  'app.signIn': 'Sign in',
  'app.signInTitle': 'Sign in',
  'app.username': 'Username',
  'app.password': 'Password',
  'app.signingIn': 'Signing in',
  'app.signedIn': 'Signed in',
  'app.signInFailed': 'Could not sign in',
  'app.rememberDevice': 'Stay signed in on this device',
  'app.distributor': 'Distributor',
  'app.role': 'Role',
  'app.person': 'Signed in as',
  'app.state': 'State',
  'app.memberships': 'Distributorships this sign-in reaches',
  'app.membershipName': 'Distributor',
  'app.membershipRole': 'Role',
  'app.membershipStatus': 'Status',
  'app.reload': 'Reload details',
  'app.loading': 'Loading the distributorship',
  'app.noMemberships': 'This sign-in reaches one distributor',
  'app.settings': 'Settings',
  'app.settingsBody': 'Nothing to set here yet — the role app fills this in.',
  'app.template': 'Template app',
  'app.templateBody':
    'One Expo codebase: this same screen is the website, the Android app and the iOS app.',
} as const
