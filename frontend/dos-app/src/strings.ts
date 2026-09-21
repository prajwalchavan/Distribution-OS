/**
 * The ROOT namespace — the words of the screens that stand BEFORE a group (docs/31 §3).
 *
 * Strings are SWAPPED per group, never merged: `<ThemeProvider strings={...}>` takes one flat record
 * and lays it over the kit catalogue, and of the 3 135 keys the six apps carry, 295 are shared and 71
 * of those hold DIFFERENT words for different audiences — `word.POST_FULFILLMENT` is *Credit* to an
 * owner and *Pay after delivery* to a shopkeeper. One merged record would silently pick whichever
 * spread last, in 71 places. So each group layout passes its own record, and this one is the root's:
 * the three pre-election branches (booting, hydrating, and the sign-in / change-password screens),
 * where no group is known yet.
 *
 * English only for the pilot (founder, 2026-09-05), and every user-visible word has a key, so Hindi
 * and Marathi are a translation file and never a rewrite.
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
  'app.signInHelp': 'Use the username your distributor gave you.',
  'app.rememberDevice': 'Stay signed in on this device',
  'app.distributor': 'Distributor',
  'app.role': 'Role',
  'app.person': 'Signed in as',
  'app.changePassword': 'Change your password',
  'app.passwordForced':
    'This password was given to you by someone else. Set your own before you carry on.',
  'app.passwordVoluntary': 'Choose a new password for this account.',
  'app.currentPassword': 'Current password',
  'app.newPassword': 'New password',
  'app.repeatPassword': 'New password again',
  'app.passwordRule': 'At least 8 characters, with a letter and a digit',
  'app.passwordMismatch': 'The two new passwords are not the same',
  'app.passwordNeedsCurrent': 'Enter the password you signed in with',
  'app.passwordRevokes': 'Your other devices will be signed out.',
  'app.setPassword': 'Set password',
  'app.passwordFailed': 'Could not change the password',
  'app.settings': 'Settings',

  /*
   * THE CONTINUE-AS CHOOSER (docs/31 ruling B3). Shown after the password, and only to somebody whose
   * membership permits more than one role — the owner who drives on Tuesdays, the manager who covers
   * the godown. Everybody else goes straight in and never sees a word of this.
   */
  'elect.title': 'Continue as',
  'elect.body': 'Pick the work you are doing now. You can sign out and pick again any time.',
  'elect.continue': 'Continue',
  'elect.changing': 'Opening',
  'elect.failed': 'Could not continue as that role',
  'elect.lastTime': 'Last time on this device',

  /*
   * The trade's own word for each role, used by the chooser and by the account menu. The wire value
   * (`owner`, `salesperson`) is never shown to anybody: it is a database word.
   */
  'role.owner': 'Owner',
  'role.manager': 'Manager',
  'role.accountant': 'Accounts',
  'role.salesperson': 'Sales',
  'role.warehouse': 'Godown',
  'role.delivery': 'Delivery',
  'role.retailer': 'Shop',
} as const
