/**
 * THE SHOPKEEPER ASKS, THE DESK DECIDES (founder, 2026-09-29, docs/22 §8) — the words of "Shops asking to join" on
 * the owner's and the manager's shops screen and home, and of the shop code on a shop's page. Spread into both
 * groups' records, as `SHOP_SIGN_IN_STRINGS` is. Every key is `sj.*`, a prefix no group used before.
 *
 * Plain words a shop owner's manager understands at first reading: a shopkeeper "asks to join a shop", the desk
 * "joins them to the shop" or "refuses". Never membership, identity, tenant, link or role (UX-00 §12).
 */
export const SHOP_JOIN_STRINGS = {
  'sj.title': 'Shops asking to join',
  'sj.count': '{count} waiting',
  'sj.waiting': 'Waiting',
  'sj.who': '{person} · {phone}',
  'sj.typed': 'Calls the shop “{shop}”',
  'sj.byCode': 'Used the code of {shop} ({code})',
  'sj.byName': 'Found you by name: pick the shop when you approve',
  'sj.approve': 'Approve',
  'sj.refuse': 'Refuse',
  'sj.approveTitle': 'Join them to the shop?',
  'sj.approveBody':
    '{person} will see {shop}’s bills, dues and rates in their own app. Anyone who already signs in for this shop keeps their sign-in.',
  'sj.approveConfirm': 'Join to shop',
  'sj.pickShop': 'Which of your shops is it?',
  'sj.pickShopHelp': 'Search your shops by name or code.',
  'sj.pickNeeded': 'Pick the shop first',
  'sj.approved': 'Joined to the shop',
  'sj.refuseTitle': 'Refuse the request?',
  'sj.reason': 'Why (the shopkeeper reads this)',
  'sj.reasonHelp': 'One line, like “We do not know this number.”',
  'sj.reasonNeeded': 'Write one line the shopkeeper will read',
  'sj.refuseConfirm': 'Refuse request',
  'sj.refused': 'Request refused',
  'sj.shopCode': 'Shop code',
  'sj.shopCodeHelp':
    'Printed on its bills. A shopkeeper types it in the app to ask to join this shop.',
  'sj.homeRow': '{person} asks to join {shop}',
  'sj.open': 'Open shops',
} as const
