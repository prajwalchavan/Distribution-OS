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
  recordDelivery: { device: 'd4.recordOffline', tab: 'd4.recordOfflineTab' },
  recordMoney: { device: 'd5.recordOffline', tab: 'd5.recordOfflineTab' },
  recordedMoney: { device: 'd5.recordedQueued', tab: 'd5.recordedQueuedTab' },
} as const

export type KeepWord = keyof typeof KEEP_WORDS

/** The string key for one claim, given what this device's store turned out to be. */
export function keepKey(word: KeepWord, persistent: boolean | null | undefined): string {
  return keepClaim(persistent) === 'device' ? KEEP_WORDS[word].device : KEEP_WORDS[word].tab
}
