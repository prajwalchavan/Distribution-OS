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

/** A number string of `digits` digits from a seed (a UTR, a cheque number). */
export function digitsFrom(hex: string, digits: number): string {
  const n = BigInt(`0x${hex.replace(/[^0-9a-f]/gi, '').slice(0, 15) || '1'}`)
  return (n % 10n ** BigInt(digits)).toString().padStart(digits, '1').replace(/^0/, '7')
}
