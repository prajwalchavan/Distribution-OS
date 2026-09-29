import { createHash } from 'node:crypto'
import { contract } from '@dos/contracts'
import { ApiRefusal } from './client.js'
import type { Ctx } from './context.js'
import { demoIdDate, isDemoId } from './ids.js'

/** A read that answers null on 404 (the thing is not there yet) and throws on anything else. */
export async function maybe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p
  } catch (e) {
    if (e instanceof ApiRefusal && e.status === 404) return null
    throw e
  }
}

/** Every page of a cursor list. */
export async function pages<T>(
  fetch: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
  cap = 40,
): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  for (let page = 0; page < cap; page++) {
    const r = await fetch(cursor)
    out.push(...r.items)
    if (!r.nextCursor) break
    cursor = r.nextCursor
  }
  return out
}

/** Made by the tool for a business date before `date`. */
export function earlier(id: string | null | undefined, date: string): boolean {
  if (!id || !isDemoId(id)) return false
  const d = demoIdDate(id)
  return d !== null && d < date
}

/** Made by the tool for exactly `date`. */
export function ofDate(id: string | null | undefined, date: string): boolean {
  return !!id && isDemoId(id) && demoIdDate(id) === date
}

export type OrderDetail = Awaited<ReturnType<typeof getOrder>>
export function getOrder(ctx: Ctx, id: string) {
  return maybe(ctx.read(contract.orders.get, { id })).then((r) => r?.item ?? null)
}

/** The live (not cancelled) bill of an order, if it has one. */
export async function billOf(ctx: Ctx, orderId: string) {
  const list = await ctx.read(contract.billing.invoices.list, { orderId, limit: 5 })
  return list.items.find((i) => i.state !== 'cancelled' && i.state !== 'draft') ?? null
}

/** A tiny signature image, the proof a delivery carries (the local object-storage driver takes it inline). */
export const SIGNATURE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** `${date}T<hh:mm>:00+05:30`: a time on the business date, in IST. */
export function istTime(date: string, hour: number, minute = 0): string {
  const hh = String(Math.min(23, Math.max(0, hour))).padStart(2, '0')
  const mm = String(Math.min(59, Math.max(0, minute))).padStart(2, '0')
  return `${date}T${hh}:${mm}:00+05:30`
}

/** Whole days from 2020-01-01 to `date`: the part of a payment reference that never repeats across days. */
export function dayNumber(date: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse('2020-01-01T00:00:00Z')) / 86_400_000,
  )
}

/** `n` decimal digits from a hash of `seed`. */
function hashDigits(seed: string, n: number): string {
  const v = BigInt(`0x${createHash('sha256').update(seed).digest('hex').slice(0, 15)}`)
  return (v % 10n ** BigInt(n)).toString().padStart(n, '0')
}

/** The payment modes that carry a reference the product holds to one live receipt (DOS-310). */
export type ReferenceMode = 'upi' | 'cheque' | 'bank_transfer'

/**
 * Where on its day a cheque or a UPI payment of the tool is taken — van 1's door, van 2's door, the desk — each
 * with a digit of its own in the reference, so two of the day's receipts of the tool never share one (a van has
 * one cheque door and one UPI door a day, the desk one cheque and one payment to match). A bank transfer (one per
 * shop paying its old bills) has no place: `null`.
 */
export const REFERENCE_PLACE = { driver1: 1, driver2: 2, desk: 3 } as const
export type ReferencePlace = keyof typeof REFERENCE_PLACE

/**
 * The payment reference of one receipt of the tool, try `attempt` (0 first, at most 9). A payment reference is
 * used once (DOS-310): the product refuses a UPI or bank-transfer reference already on a live receipt of the
 * distributor and a cheque number already on one of the same shop, and asks before taking another shop's cheque
 * number. So the tool's references are its own BY CONSTRUCTION, and never repeat across shops or days:
 *   - the business date is in each (the five-digit day number at the head of a 12-digit UTR and after `NEFT`, its
 *     last four digits at the head of a six-digit cheque number — the same for 27 years): no two days share one;
 *   - within the day, a cheque number is the date, the place and the try (`dddd` `p` `t`) and a UTR the date, the
 *     place and seven digits of a digest of the receipt's id and the try: the day's cheques and UPI payments are
 *     apart by their place, and a try by its digit or digest;
 *   - a bank transfer is the date and seven digits of that digest (a handful a day, one per shop);
 * and when the product still names one as taken (a real payment happened to carry it) the next try gives another.
 */
export function paymentReference(
  mode: ReferenceMode,
  date: string,
  receiptId: string,
  place: ReferencePlace | null,
  attempt = 0,
): string {
  const day = dayNumber(date)
  const at = place === null ? '0' : String(REFERENCE_PLACE[place])
  const seed = `demo-fill:reference:${mode}:${receiptId}:${String(attempt)}`
  if (mode === 'upi') return `${String(day).padStart(5, '0')}${at}${hashDigits(seed, 6)}`
  if (mode === 'bank_transfer') return `NEFT${String(day).padStart(5, '0')}${hashDigits(seed, 7)}`
  return `${String(day % 10_000).padStart(4, '0')}${at}${String(attempt % 10)}`
}

/** The refusals that say a payment reference is taken (DOS-310): the tool answers each with its next reference. */
export const REFERENCE_TAKEN: ReadonlySet<string> = new Set([
  'reference_already_recorded',
  'cheque_already_recorded',
  'cheque_number_seen_elsewhere',
])

/**
 * A rate gate whose asked rate is below the item's purchase cost (the back office queue says so): the owner's alone
 * to approve, knowingly (prices and tax, DOS-335), so the tool's desk leaves it waiting for the owner.
 */
export const belowCost = (a: {
  kind: string
  bargain?: { belowCost: boolean } | null | undefined
}): boolean => a.kind === 'bargain' && a.bargain?.belowCost === true
