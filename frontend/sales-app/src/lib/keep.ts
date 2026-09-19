/**
 * S3 · S5 — the words this app uses when it claims to keep something (DOS-179).
 *
 * A browser with no COOP/COEP has no OPFS, so the device store falls back to memory: everything works
 * and none of it survives the tab. The strip says so on every screen now; this is the other half — the
 * VERBS. "Save on this phone" over that store is the app contradicting its own strip, and the
 * ruling-3 re-proof measured exactly that: the button read "Save on this phone", then "Saved on this
 * phone", over an order queued into a store that dies with the tab.
 *
 * ONE PAIR OF WORDS PER CLAIM, chosen by `keepClaim` — the library's rule, shared with the delivery and
 * warehouse apps. An OFFER treats a still-opening store exactly as a memory one (DOS-167 ruling 3 (ee)):
 * a button must never promise a keep the device may turn out not to be able to make.
 */
import { keepClaim } from '@dos/offline'

/** Each place S3 or S5 claims a keep: the phone's word, and the word for a store that keeps nothing. */
const KEEP_WORDS = {
  queue: { device: 's3.queue', tab: 's3.queueTab' },
  queued: { device: 's3.queued', tab: 's3.queuedTab' },
  queuedTitle: { device: 's3.queuedTitle', tab: 's3.queuedTitleTab' },
  queuedBody: { device: 's3.queuedBody', tab: 's3.queuedBodyTab' },
  trayOffline: { device: 's5.trayOffline', tab: 's5.trayOfflineTab' },
  /*
   * The sentence at the top of one queued order (S5), which the first pass missed (merge review,
   * 2026-09-19): it is the same claim DOS-180 had just taken off the S3 banner, one screen later.
   */
  queuedExplain: { device: 's5.queuedExplain', tab: 's5.queuedExplainTab' },
  /*
   * The five this app had left, found by the repo-wide sweep of the strings catalogue rather than by
   * reading one screen at a time (merge review, 2026-09-19). Four of them are about the COPY the device
   * is holding — the beat, the catalogue count, the stock list, a shop's bill totals — and the fifth is
   * the total under a draft order, which is the rep's own unsent work. A re-pull can replace the copy;
   * it cannot replace the draft, and either way the sentence has to agree with the strip above it.
   */
  offlineRead: { device: 's0.offlineNote', tab: 's0.offlineNoteTab' },
  catalogCount: { device: 's3.addItemsMeta', tab: 's3.addItemsMetaTab' },
  deviceTotal: { device: 's5.deviceTotal', tab: 's5.deviceTotalTab' },
  stockItems: { device: 's11.stockNeedsSignal', tab: 's11.stockNeedsSignalTab' },
  billTotals: { device: 's12.offline', tab: 's12.offlineTab' },
} as const

export type KeepWord = keyof typeof KEEP_WORDS

/** The string key for one claim, given what this device's store turned out to be. */
export function keepKey(word: KeepWord, persistent: boolean | null | undefined): string {
  return keepClaim(persistent) === 'device' ? KEEP_WORDS[word].device : KEEP_WORDS[word].tab
}
