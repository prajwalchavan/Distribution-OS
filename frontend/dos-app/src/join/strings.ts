/**
 * THE SHOPKEEPER'S OWN ACCOUNT (founder, 2026-09-29, docs/22 §8 "The shopkeeper is independent") — the words of
 * "Add a distributor", "Waiting for approval" and leaving a distributor. Shared by the root (an account no
 * distributor has joined yet, on `/join`) and the shop's own group (`/retailer/add-distributor`, and leaving from Me), so both
 * say the same sentences about the same thing. Every key is `join.*`, a prefix no record used before, so the spread
 * cannot shadow a group's own word (docs/31 §3: strings are swapped per group, never merged).
 *
 * Plain words a shopkeeper understands at first reading: a distributor "joins you to your shop", a request "waits
 * for approval". Never membership, tenant, link, identity or role (UX-00 §12).
 */
export const JOIN_STRINGS = {
  'join.title': 'Add a distributor',
  'join.subtitle':
    'Ask a distributor you buy from to join you to your shop. They see your name and number, and decide.',
  'join.noneYet':
    'No distributor has joined you yet. When one approves, their bills, dues and rates open here.',
  'join.byCode': 'Shop code',
  'join.byName': 'Find by name',
  'join.code': 'Shop code',
  'join.codeHelp': 'It is printed on your bill, beside your shop’s name.',
  'join.codeBad': 'Type the 8 letters and digits of the shop code, like K7MQ-4P2X',
  'join.find': 'Find the shop',
  'join.foundTitle': 'Is this your shop?',
  'join.found': '{shop}, with {distributor}',
  'join.ask': 'Ask to join',
  'join.asked': 'Request sent',
  'join.search': 'Distributor’s name',
  'join.searchHelp': 'Type two letters or more of the name.',
  'join.searchEmpty': 'No distributor found by that name',
  'join.pickNeeded': 'Pick your distributor first',
  'join.shopName': 'Your shop’s name',
  'join.shopNameHelp': 'As the distributor knows it, so they find it on their books.',
  'join.nameNeeded': 'Type your shop’s name',
  'join.failed': 'Could not send the request',
  'join.mine': 'Your requests',
  'join.waitingTitle': 'Waiting for approval',
  'join.waitingBody': '{distributor} will see your name and number and decide.',
  'join.state.waiting': 'Waiting',
  'join.state.approved': 'Approved',
  'join.state.refused': 'Refused',
  'join.state.withdrawn': 'Withdrawn',
  'join.refusedWhy': 'They said: {reason}',
  'join.withdraw': 'Withdraw',
  'join.tapToWithdraw': 'Tap a waiting request to withdraw it.',
  'join.withdrawTitle': 'Withdraw your request?',
  'join.withdrawBody': 'Your request to {distributor} is withdrawn. You can ask again later.',
  'join.withdrawn': 'Request withdrawn',
  'join.open': 'Open my shop',
  'join.approvedBody': '{distributor} joined you to {shop}.',
  'join.checkAgain': 'Check again',
  'join.signOut': 'Sign out',
  'join.addAnother': 'Add a distributor',
  'join.addAnotherBody': 'Buy from another distributor too? Ask them to join you to your shop.',
  'join.leave': 'Leave {distributor}',
  'join.leaveTitle': 'Leave this distributor?',
  'join.leaveBody':
    'You stop seeing {distributor}’s bills, dues and rates in the app. Your orders and bills stay on their books. To come back, ask again.',
  'join.leaveConfirm': 'Leave',
  'join.leaveFailed': 'Could not leave the distributor',
  'join.distributors': 'Your distributors',
} as const
