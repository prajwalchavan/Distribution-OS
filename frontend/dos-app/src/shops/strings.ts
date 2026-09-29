/**
 * DOS-400 — the words of a shop's app sign-in on the shop's page, shared by the owner and the manager.
 *
 * Strings are SWAPPED per group, never merged (docs/31 §3): each group's record spreads this one in, as
 * it does `PRICING_STRINGS`, so both desks say the same sentences about the same thing. Every key is
 * `si.*`, a prefix no group used before, so the spread cannot shadow a group's own word.
 *
 * Plain words a shop owner's manager understands at first reading: a shop "signs in to the app", has a
 * "username" and a "first password". Never membership, identity, tenant, link or role (UX-00 §12).
 */
export const SHOP_SIGN_IN_STRINGS = {
  'si.title': 'App sign-in',
  'si.none': 'This shop cannot use the app yet',
  /** The shops register's column, for a shop with no sign-in. */
  'si.noneShort': 'Not yet',
  'si.give': 'Give this shop a sign-in',
  'si.username': 'Username',
  'si.since': 'Since {when}',
  'si.newPassword': 'New first password',
  'si.stop': 'Stop this sign-in',

  // --- giving it ------------------------------------------------------------------------------------------
  'si.giveBody':
    'The shop gets a username and a first password. You will see them once, here, to hand to the shopkeeper.',
  'si.mobile': 'Shopkeeper’s mobile number',
  'si.mobileHelp': 'This shop has no mobile number yet. It will be saved on the shop.',
  'si.mobileBad': 'Enter a 10-digit mobile number, like 98765 43210',
  'si.giveConfirm': 'Give the sign-in',

  // --- the one time the password is shown ----------------------------------------------------------------
  'si.shownTitle': 'The shop’s sign-in',
  'si.firstPassword': 'First password',
  'si.shownOnce': 'This password is shown only now. Copy it or share it with the shopkeeper.',
  'si.mustChange': 'The shop will be asked to choose its own password at the first sign-in.',
  'si.copy': 'Copy',
  'si.copied': 'Copied',
  'si.share': 'Share',
  'si.shareText': 'Your sign-in for {shop}: username {username}, first password {password}',
  'si.done': 'I have given it',

  // --- a number the app already knows, or a shop that already has one ---------------------------------
  'si.existingTitle': 'Sign-in added',
  'si.existing':
    'This number already has a sign-in. The shopkeeper uses their own password and will now see your shop.',
  'si.already': 'This shop already has a sign-in.',
  'si.ok': 'Close',

  // --- a new first password ------------------------------------------------------------------------------
  'si.newPasswordBody':
    '{shop} gets a new first password. The shopkeeper is signed out of the app on every phone and must choose a new password at the next sign-in.',
  'si.newPasswordConfirm': 'Give a new password',

  // --- stopping it ---------------------------------------------------------------------------------------
  'si.stopBody':
    '{shop} will no longer see your business in the app. Its orders, bills and dues stay as they are. You can give it a sign-in again later.',
  'si.stopConfirm': 'Stop the sign-in',
  'si.stopped': 'Sign-in stopped',
} as const
