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
import { JOIN_STRINGS } from './join/strings'

export const strings = {
  /* The shopkeeper is independent (founder, 2026-09-29): "Add a distributor", before any has joined. */
  ...JOIN_STRINGS,
  'app.home': 'Today',
  'app.signIn': 'Sign in',
  'app.signInTitle': 'Sign in',
  'app.username': 'Username',
  'app.password': 'Password',
  'app.signingIn': 'Signing in',
  'app.signedIn': 'Signed in',
  'app.signInFailed': 'Could not sign in',
  'app.signInHelp': 'Use your own username, or the one your distributor gave you.',
  /* The shopkeeper's own account (founder, 2026-09-29): the way to one from the sign-in form. */
  'app.newHere': 'New here? Create your account',
  /* The one friendly line under the product's name on the sign-in page (founder, 2026-09-28). */
  'app.signInLine': 'Sign in to start your day.',
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
  /** docs/22 §8 (2026-09-29): keeping the password somebody gave you is not choosing one. */
  'app.passwordSame': 'Choose a new password, not the one you have now',
  'app.passwordNeedsCurrent': 'Enter the password you signed in with',
  'app.passwordRevokes': 'Your other devices will be signed out.',
  'app.setPassword': 'Set password',
  'app.passwordFailed': 'Could not change the password',
  'app.settings': 'Settings',

  /*
   * SIGN UP (founder, 2026-09-29, docs/22 §8): a shopkeeper makes their own account, with a password nobody
   * else ever knows, and it belongs to no distributor until one approves a request to join a shop.
   */
  'su.title': 'Create your account',
  'su.subtitle': 'For a shop. Your password is yours alone: no distributor ever sees it.',
  'su.mobile': 'Mobile number',
  'su.mobileHelp': 'Your own mobile number. Distributors see it when you ask to join.',
  'su.mobileBad': 'Enter a 10-digit mobile number, like 98765 43210',
  'su.name': 'Your name',
  'su.nameNeeded': 'Type your name',
  'su.shopName': 'Your shop’s name',
  'su.shopNeeded': 'Type your shop’s name',
  'su.username': 'Username',
  'su.usernameHelp': 'Letters, digits, dot or underscore. You sign in with it.',
  'su.usernameNeeded': 'Choose a username of 3 letters or more',
  'su.password': 'Password',
  'su.passwordAgain': 'Password again',
  'su.create': 'Create account',
  'su.failed': 'Could not create the account',
  'su.haveAccount': 'Already have an account? Sign in',

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
