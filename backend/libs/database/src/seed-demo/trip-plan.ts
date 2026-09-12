/**
 * The one rule that says which vehicle carried which day's loads, shared by the warehouse seed (load
 * sheets point at a trip) and the delivery seed (the trip and its stops). Pure and date-derived, so the
 * two modules can never disagree about a trip id.
 *
 *   - today's packed orders wait on TOMORROW's planned trip (the tempo);
 *   - the previous WORKING day's loads (Saturday's, on a Monday): the seven still on the road are
 *     today's ACTIVE trip on the tempo, the rest went out on the loader and were settled that evening;
 *   - any older day runs the tempo plus a second vehicle when it has more than sixteen stops (the
 *     three-wheeler on even days, the loader on odd ones), else one vehicle rotating through the
 *     three — a tempo does a dozen to twenty drops a round, not five (2026-09-08 review).
 */
import { demoId } from './ids.js'
import { isoDate, isPreviousWorkingDay } from './util.js'

export const VEHICLE_KEYS = ['tempo', 'three-wheeler', 'loader'] as const
export type DemoVehicleKey = (typeof VEHICLE_KEYS)[number]

/**
 * Today's active trip (Tempo 1, out delivering yesterday's bills) and tomorrow's plan (written by
 * `delivery-road.ts`). Functions, not constants: the id is namespaced by the demo scope in force,
 * and each distributor has its own.
 */
export const activeTripId = (): string => demoId('trip', 'active')
export const plannedTripId = (): string => demoId('trip', 'planned-next')

const dayNumber = (day: Date): number => Math.floor(day.getTime() / 86_400_000)

/** The vehicles a day's `count` loads ride on, in bucket order. */
export function vehiclesForDay(day: Date, ageDays: number, count: number): DemoVehicleKey[] {
  if (ageDays <= 0) return ['tempo']
  if (isPreviousWorkingDay(day)) return ['tempo', 'loader']
  const second: DemoVehicleKey = dayNumber(day) % 2 === 0 ? 'three-wheeler' : 'loader'
  if (count > 16) return ['tempo', second]
  return [VEHICLE_KEYS[dayNumber(day) % 3] ?? 'tempo']
}

/**
 * Splits a day's loads across its vehicles in order. The previous working day is special: what is
 * still on the road rides the tempo (today's active trip), everything already home went on the loader.
 */
export function bucketise<T extends { onRoad?: boolean }>(
  items: readonly T[],
  keys: readonly DemoVehicleKey[],
  day: Date,
): { key: DemoVehicleKey; items: T[] }[] {
  if (keys.length === 1) return [{ key: keys[0] ?? 'tempo', items: [...items] }]
  if (isPreviousWorkingDay(day))
    return keys.map((key, i) => ({
      key,
      items: items.filter((it) => (i === 0 ? it.onRoad === true : it.onRoad !== true)),
    }))
  const half = Math.ceil(items.length / 2)
  return keys.map((key, i) => ({ key, items: i === 0 ? items.slice(0, half) : items.slice(half) }))
}

/** The trip a day's load on a vehicle rode on. */
export function tripIdFor(day: Date, key: DemoVehicleKey, ageDays: number): string {
  if (ageDays <= 0) return plannedTripId()
  if (isPreviousWorkingDay(day) && key === 'tempo') return activeTripId()
  return demoId('trip', `${isoDate(day)}:${key}`)
}
