import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROAD_FACTOR,
  haversineMetres,
  istMinutes,
  pathLengthMetres,
  planRoute,
  sequenceDistanceM,
  twoOpt,
  type RouteStopInput,
} from './route.js'

/**
 * Small instances whose optimum is known by hand, so a regression in the solver is a failing number
 * and not a judgement call. Coordinates are a flat square around Kalyan (the pilot's town), where a
 * degree of latitude is ~111 km and a degree of longitude ~107 km — near enough that a "perimeter is
 * shorter than a diagonal" argument holds exactly.
 */

const KALYAN = { lat: 19.24, lng: 73.13 }

/** A square 0.01° on a side: A(0,0) B(0,1) C(1,1) D(1,0) in units of 0.01 degrees. */
const at = (dLat: number, dLng: number) => ({
  lat: KALYAN.lat + dLat * 0.01,
  lng: KALYAN.lng + dLng * 0.01,
})

const stop = (stopId: string, point: { lat: number; lng: number } | null): RouteStopInput => ({
  stopId,
  lat: point?.lat ?? null,
  lng: point?.lng ?? null,
})

describe('haversineMetres', () => {
  it('measures a degree of latitude at about 111 km', () => {
    const metres = haversineMetres({ lat: 19, lng: 73 }, { lat: 20, lng: 73 })
    expect(metres).toBeGreaterThan(111_000)
    expect(metres).toBeLessThan(111_400)
  })

  it('is zero for the same point and symmetric', () => {
    expect(haversineMetres(KALYAN, KALYAN)).toBe(0)
    const a = { lat: 19.1, lng: 73.0 }
    const b = { lat: 19.3, lng: 73.4 }
    expect(haversineMetres(a, b)).toBeCloseTo(haversineMetres(b, a), 6)
  })

  it('pathLengthMetres applies the road factor to every leg', () => {
    const straight = pathLengthMetres([at(0, 0), at(0, 1), at(1, 1)], 1)
    const roads = pathLengthMetres([at(0, 0), at(0, 1), at(1, 1)], DEFAULT_ROAD_FACTOR)
    expect(roads).toBeCloseTo(straight * DEFAULT_ROAD_FACTOR, 3)
  })
})

describe('twoOpt', () => {
  it('uncrosses a path that crosses itself', () => {
    // Four points on a square. The path A → C → B → D crosses; A → B → C → D does not.
    const points = [at(0, 0), at(0, 1), at(1, 1), at(1, 0)]
    const cost = (i: number, j: number) =>
      haversineMetres(
        points[i] as { lat: number; lng: number },
        points[j] as { lat: number; lng: number },
      )
    const crossed = [0, 2, 1, 3]
    const fixed = twoOpt(crossed, cost)
    const length = (p: number[]) => p.slice(1).reduce((t, n, i) => t + cost(p[i] as number, n), 0)
    expect(length(fixed)).toBeLessThan(length(crossed))
    // The start is fixed; the only shorter open path from A is the perimeter.
    expect(fixed[0]).toBe(0)
    expect(fixed).toEqual([0, 1, 2, 3])
  })

  it('leaves an already-optimal path alone', () => {
    const points = [at(0, 0), at(0, 1), at(0, 2), at(0, 3)]
    const cost = (i: number, j: number) =>
      haversineMetres(
        points[i] as { lat: number; lng: number },
        points[j] as { lat: number; lng: number },
      )
    expect(twoOpt([0, 1, 2, 3], cost)).toEqual([0, 1, 2, 3])
  })
})

describe('planRoute', () => {
  it('walks the perimeter of a square from a depot on one corner', () => {
    const stops = [stop('c', at(1, 1)), stop('a', at(0, 1)), stop('b', at(1, 0))]
    const plan = planRoute(stops, { depot: at(0, 0), avgSpeedKmph: 20, serviceMinutes: 0 })
    // depot(0,0) → (0,1) → (1,1) → (1,0) → back: four sides. Any other order drives a diagonal.
    expect(plan.order.map((s) => s.stopId)).toEqual(['a', 'c', 'b'])
    const side = haversineMetres(at(0, 0), at(0, 1)) * DEFAULT_ROAD_FACTOR
    expect(plan.totalDistanceM).toBeGreaterThan(side * 3.9)
    expect(plan.totalDistanceM).toBeLessThan(side * 4.2)
    expect(plan.pinnedCount).toBe(3)
    expect(plan.unpinnedCount).toBe(0)
  })

  it('beats the sequence the trip already holds when that sequence zig-zags', () => {
    const zigzag = [
      stop('s1', at(0, 0)),
      stop('s2', at(0, 4)),
      stop('s3', at(0, 1)),
      stop('s4', at(0, 5)),
      stop('s5', at(0, 2)),
    ]
    const before = sequenceDistanceM(zigzag, { depot: at(0, 0) })
    const plan = planRoute(zigzag, { depot: at(0, 0) })
    expect(plan.totalDistanceM).toBeLessThan(before)
    // Five points on a line: the optimum is to walk out and come back, i.e. in order of longitude.
    expect(plan.order.map((s) => s.stopId)).toEqual(['s1', 's3', 's5', 's2', 's4'])
  })

  it('keeps unpinned stops, in their given order, at the end', () => {
    const stops = [
      stop('far', at(0, 5)),
      stop('nopin1', null),
      stop('near', at(0, 1)),
      stop('nopin2', null),
    ]
    const plan = planRoute(stops, { depot: at(0, 0) })
    expect(plan.order.map((s) => s.stopId)).toEqual(['near', 'far', 'nopin1', 'nopin2'])
    expect(plan.order.map((s) => s.pinned)).toEqual([true, true, false, false])
    expect(plan.unpinnedCount).toBe(2)
    expect(plan.order[2]?.distanceM).toBe(0)
    expect(plan.order[2]?.etaMinutes).toBeNull()
  })

  it('answers an empty plan for no stops and a single-stop plan without a solver', () => {
    expect(planRoute([], { depot: KALYAN })).toMatchObject({
      order: [],
      totalDistanceM: 0,
      pinnedCount: 0,
      unpinnedCount: 0,
    })
    const one = planRoute([stop('only', at(0, 1))], { depot: at(0, 0) })
    expect(one.order.map((s) => s.stopId)).toEqual(['only'])
    // Out and back: twice the leg.
    expect(one.totalDistanceM).toBeGreaterThan(0)
  })

  it('is deterministic, and breaks a distance tie by stop id', () => {
    // Two shops the same distance from the depot, given in the "wrong" order.
    const stops = [stop('zeta', at(0, 1)), stop('alpha', at(0, -1))]
    const first = planRoute(stops, { depot: at(0, 0), returnToDepot: false })
    const second = planRoute([...stops].reverse(), { depot: at(0, 0), returnToDepot: false })
    expect(first.order.map((s) => s.stopId)).toEqual(['alpha', 'zeta'])
    expect(second.order.map((s) => s.stopId)).toEqual(first.order.map((s) => s.stopId))
    expect(second.totalDistanceM).toBe(first.totalDistanceM)
  })

  it('starts from the crew’s own first stop when no depot is known', () => {
    const stops = [stop('start', at(0, 5)), stop('a', at(0, 0)), stop('b', at(0, 1))]
    const plan = planRoute(stops, {})
    expect(plan.order[0]?.stopId).toBe('start')
    expect(plan.order.map((s) => s.stopId)).toEqual(['start', 'b', 'a'])
  })

  it('computes ETAs from the speed and the service time, and never a negative duration', () => {
    const stops = [stop('a', at(0, 1)), stop('b', at(0, 2))]
    const startAt = new Date('2026-09-06T04:00:00.000Z') // 09:30 IST
    const plan = planRoute(stops, {
      depot: at(0, 0),
      avgSpeedKmph: 20,
      serviceMinutes: 10,
      startAt,
      returnToDepot: false,
    })
    const [first, second] = plan.order
    expect(first?.etaMinutes).toBeGreaterThanOrEqual(0)
    expect(second?.etaMinutes).toBeGreaterThan(first?.etaMinutes ?? 0)
    // The second ETA includes the ten minutes spent at the first door.
    expect((second?.etaMinutes ?? 0) - (first?.etaMinutes ?? 0)).toBeGreaterThanOrEqual(10)
    expect(plan.totalDurationS).toBeGreaterThan(0)
  })

  it('reports whether an ETA lands inside a shop’s opening hours', () => {
    const startAt = new Date('2026-09-06T04:00:00.000Z') // 09:30 IST
    const open: RouteStopInput = {
      ...stop('open', at(0, 1)),
      window: { openMinute: 9 * 60, closeMinute: 21 * 60 },
    }
    const shut: RouteStopInput = {
      ...stop('shut', at(0, 2)),
      window: { openMinute: 15 * 60, closeMinute: 18 * 60 },
    }
    const plan = planRoute([open, shut], {
      depot: at(0, 0),
      startAt,
      serviceMinutes: 0,
      returnToDepot: false,
    })
    const byId = new Map(plan.order.map((s) => [s.stopId, s]))
    expect(byId.get('open')?.withinWindow).toBe(true)
    expect(byId.get('shut')?.withinWindow).toBe(false)
  })

  it('sequenceDistanceM scores the existing order with the same model', () => {
    const stops = [stop('a', at(0, 1)), stop('b', at(0, 2))]
    const measured = sequenceDistanceM(stops, { depot: at(0, 0), returnToDepot: false })
    const planned = planRoute(stops, { depot: at(0, 0), returnToDepot: false })
    // The given order is already optimal here, so the two agree to the metre.
    expect(measured).toBe(planned.totalDistanceM)
  })
})

describe('istMinutes', () => {
  it('reads an instant on the IST clock', () => {
    expect(istMinutes(new Date('2026-09-06T04:00:00.000Z'))).toBe(9 * 60 + 30)
    expect(istMinutes(new Date('2026-09-06T18:30:00.000Z'))).toBe(0)
  })
})
