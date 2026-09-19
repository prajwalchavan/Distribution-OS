/**
 * W5 — the words this app uses when it claims to keep something (DOS-179).
 *
 * A picked line that has not reached the office yet carries a chip saying where it is. On a loader's
 * phone that is a real SQLite file and "Saved on this phone" is true; on the web build in a browser
 * without COOP/COEP (no OPFS) the store is in memory and the count dies with the tab. The strip says
 * so on every screen now, and this verb has to agree with it.
 *
 * ONE PAIR OF WORDS PER CLAIM, chosen by `keepClaim` — the library's rule, shared with the sales and
 * delivery apps. An OFFER treats a still-opening store exactly as a memory one (DOS-167 ruling 3 (ee)).
 */
import { keepClaim } from '@dos/offline'

/** Each place a warehouse screen claims a keep: the phone's word, and the word when nothing is kept. */
const KEEP_WORDS = {
  savedOnDevice: { device: 'w.savedOnDevice', tab: 'w.savedOnDeviceTab' },
} as const

export type KeepWord = keyof typeof KEEP_WORDS

/** The string key for one claim, given what this device's store turned out to be. */
export function keepKey(word: KeepWord, persistent: boolean | null | undefined): string {
  return keepClaim(persistent) === 'device' ? KEEP_WORDS[word].device : KEEP_WORDS[word].tab
}
