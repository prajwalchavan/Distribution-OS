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
  /** The same column on a phone row, which has no heads. */
  'si.rowAs': 'App: {username}',
  'si.rowNone': 'No app sign-in yet',
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
  /** When the shop's own mobile was refused (R1) and the desk enters another one (DOS-428). */
  'si.mobileReplaceHelp': 'It will be saved as the shop’s mobile number.',
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
  /** Copy and Share say what happened when nothing could be copied or shared (the second check). */
  'si.copyRefused':
    'This device did not let the app copy it. Write the password down or read it out to the shopkeeper.',
  'si.noShareSheet': 'This device has no share sheet. Copy it, or read it out to the shopkeeper.',
  'si.shareFailed': 'It was not shared. Try again, or copy it.',
  'si.nothingToCopy':
    'This device cannot copy or share from here. Write the password down or read it out to the shopkeeper.',

  // --- a number this business already signs in, or a shop that already has one ----------------------
  'si.existingTitle': 'Sign-in added',
  'si.alreadyTitle': 'This shop has a sign-in',
  /** A login of this business alone whose password the shopkeeper chose (ruling R4). */
  'si.existingOwn':
    'This number already has a sign-in with your business. The shopkeeper uses their own password and will now see this shop too.',
  /** A login of this business alone that still has the first password a desk gave. */
  'si.existingFirst':
    'This number already has a sign-in with your business. The shopkeeper has not chosen their own password yet, so the first password given before still works. If it is lost, give a new first password.',
  'si.already': 'This shop already has a sign-in.',
  'si.ok': 'Close',

  // --- a number whose sign-in another business made (ruling R1): said on the mobile field ---------------
  /** The shop's own mobile; the desk enters another one of the shopkeeper right there (DOS-428). */
  'si.shared':
    'The shop’s mobile number {phone} already has a Distribution OS sign-in, which cannot be shared yet. Enter another mobile number of the shopkeeper.',
  'si.sharedTyped':
    'This mobile number already has a Distribution OS sign-in, which cannot be shared yet. Enter another mobile number of the shopkeeper.',

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
