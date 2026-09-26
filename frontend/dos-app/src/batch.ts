/**
 * QA DOS-220 — which carton is this line?
 *
 * A supplier bill can carry three batches of one item: three receipt lines that all read "Balaji
 * Masala Masti Wafers 45 g". The gate hand, the desk that posts the receipt and anyone reading it
 * afterwards tell them apart by what is PRINTED ON THE CARTON — the batch number and the expiry — so
 * every line of a goods receipt says them, on the pad, in the review and in the desk's post panel.
 * They are identity, not the bill's figures: the count stays blind (the quantity is never shown).
 *
 * A batch that is about to expire is flagged in words, because the short-life batch is exactly the one
 * a wrong guess hurts: its pieces posted onto a long-life lot are never picked first (FEFO) and never
 * written off on time. The threshold is the distributor's default minimum shelf life to ship (docs/22
 * 2026-09-13: 30 days unless the owner changes it).
 *
 * Pure: no React, no kit, no request — the screens pass `t` and today's IST date.
 */
import { daysBetween } from '@dos/domain'

export interface BatchFacts {
  batchNo: string | null
  expiryDate: string | null
}

export interface BatchLabel {
  /** "Batch SIM1-7-A · Expires 20 Oct 2026" — or whichever half the bill printed. */
  text: string
  /** Whole days from `today` to the expiry; negative once expired; null when no expiry printed. */
  daysLeft: number | null
  /** True when the batch expires within `shortLifeDays` (or already has): say it, in colour. */
  shortLife: boolean
  /** "24 days left" / "Expired" — only when `shortLife`. */
  warning: string | null
}

type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-10-20` → `20 Oct 2026`. */
export function expiryText(isoDate: string): string {
  const month = MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? ''
  return `${String(Number(isoDate.slice(8, 10)))} ${month} ${isoDate.slice(0, 4)}`
}

/** The default minimum shelf life to ship (QA DOS-054), used as the "short life" line. */
export const SHORT_LIFE_DAYS = 30

export function batchLabel(
  line: BatchFacts,
  t: Translate,
  today: string,
  shortLifeDays: number = SHORT_LIFE_DAYS,
): BatchLabel | null {
  const batch = line.batchNo?.trim() ?? ''
  const expiry = line.expiryDate !== null && line.expiryDate.length >= 10 ? line.expiryDate : null
  if (batch === '' && expiry === null) return null
  const parts: string[] = []
  if (batch !== '') parts.push(t('batch.batch', { batch }))
  if (expiry !== null) parts.push(t('batch.expires', { date: expiryText(expiry) }))
  const daysLeft = expiry === null ? null : daysBetween(today, expiry.slice(0, 10))
  const shortLife = daysLeft !== null && daysLeft <= shortLifeDays
  const warning = !shortLife
    ? null
    : daysLeft < 0
      ? t('batch.expired')
      : daysLeft === 1
        ? t('batch.daysLeft.one', { count: daysLeft })
        : t('batch.daysLeft', { count: daysLeft })
  return { text: parts.join(' · '), daysLeft, shortLife, warning }
}
