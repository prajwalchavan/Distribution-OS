/**
 * D3 · D4 · D5 — the words this app uses when it claims to keep something (DOS-179).
 *
 * A crew phone normally holds a real SQLite file, so "Saved on this phone" is true. It is not true on
 * the web build in a browser without COOP/COEP (no OPFS), where the store falls back to memory and
 * everything the crew recorded dies with the tab. The strip says so on every screen now; these are the
 * VERBS that have to agree with it — the doorstep buttons, the toast after them, the receipt line.
 *
 * ONE PAIR OF WORDS PER CLAIM, chosen by `keepClaim` — the library's rule, shared with the sales and
 * warehouse apps. An OFFER treats a still-opening store exactly as a memory one (DOS-167 ruling 3 (ee)):
 * a button must never promise a keep the device may turn out not to be able to make.
 */
import { keepClaim } from '@dos/offline'

/** Each place a delivery screen claims a keep: the phone's word, and the word when nothing is kept. */
const KEEP_WORDS = {
  savedOnPhone: { device: 'd.savedOnPhone', tab: 'd.savedOnPhoneTab' },
  /*
   * The paragraph under the Record button on D4 and D5, which the first pass missed (merge review,
   * 2026-09-19): on the money screen it promised the receipt stayed on the phone three lines below a
   * button this rule had already made honest, with the strip above both saying the opposite.
   */
  offlineWrite: { device: 'd.offlineWrite', tab: 'd.offlineWriteTab' },
  recordDelivery: { device: 'd4.recordOffline', tab: 'd4.recordOfflineTab' },
  recordMoney: { device: 'd5.recordOffline', tab: 'd5.recordOfflineTab' },
  recordedMoney: { device: 'd5.recordedQueued', tab: 'd5.recordedQueuedTab' },
  /*
   * D10's hand-over dialog, which DOS-178 added one commit before this rule and so never took through
   * it (merge review, 2026-09-19). The worst place to leave the claim: that screen already prints
   * whether the store keeps anything, so on a memory store the phone promised and denied the same keep
   * in one render — over money the office refused, which this card is now the only record of.
   */
  handOverBody: { device: 'tray.handOverBody', tab: 'tray.handOverBodyTab' },
  handOverBodyNoBook: { device: 'tray.handOverBodyNoBook', tab: 'tray.handOverBodyNoBookTab' },
  /*
   * CLOSING THE TRIP (merge review, 2026-09-19). D1 and D8 both printed "{count} writes are still on this
   * phone" under nothing but a count gate, and D8 printed three more of the same claim: the reason the
   * check-in button is refused, and the two money sentences `dayEndCash` chooses ("This phone holds ₹X in
   * receipts"). Every one of them sits under a strip that on a browser with no OPFS already reads
   * "· Not kept in this browser" — the phone denying and asserting the same keep in ONE render, over the
   * outbox that decides whether the vehicle may be checked in and over money nobody has counted yet.
   */
  /*
   * The chip on every waiting row of D10 (merge review, 2026-09-19). `wordFor(t, row.status)` built the
   * key from the value, so no grep for a string key ever found it: the label resolved to `word.queued`,
   * "On this phone", on the same screen that prints `tray.storeMemory` above the list and now takes its
   * hand-over dialog through this helper. Those rows include doorstep receipts.
   */
  waitingChip: { device: 'word.queued', tab: 'word.queuedTab' },
  pending: { device: 'd8.pending', tab: 'd8.pendingTab' },
  pendingBlocks: { device: 'd8.pendingBlocks', tab: 'd8.pendingBlocksTab' },
  uncounted: { device: 'd8.uncounted', tab: 'd8.uncountedTab' },
  uncountedSettled: { device: 'd8.uncountedSettled', tab: 'd8.uncountedSettledTab' },
} as const

export type KeepWord = keyof typeof KEEP_WORDS

/** The string key for one claim, given what this device's store turned out to be. */
export function keepKey(word: KeepWord, persistent: boolean | null | undefined): string {
  return keepClaim(persistent) === 'device' ? KEEP_WORDS[word].device : KEEP_WORDS[word].tab
}
