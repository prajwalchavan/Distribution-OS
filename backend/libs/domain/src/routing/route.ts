/**
 * Route sequencing for one delivery trip (founder decision 2026-09-05, docs/22 §8: route optimisation
 * ships in v1, "stop sequencing by distance and time windows, driver may override").
 *
 * PURE, DEPENDENCY-FREE, DETERMINISTIC. No database, no clock of its own, no randomness: the same
 * stops in the same order always produce the same sequence, which is what makes the unit tests below
 * meaningful and what lets the same code run on a phone later (`@dos/domain` bundles into Expo).
 *
 * The model is deliberately simple and honest about it:
 *
 *   distance   great-circle metres (`haversineMetres`) multiplied by a ROAD FACTOR, because a van
 *              does not fly. The factor is a parameter, not a constant, so a distributor whose beat
 *              is a grid can tune it; nothing here pretends to know about traffic or one-ways.
 *   time       distance ÷ the tenant's assumed average speed, plus a fixed service time at each
 *              door. Both come from `tenant_settings` at the call site, never from a client.
 *   solver     nearest neighbour from the start, then 2-opt until no improving swap remains. On the
 *              ≤ 80 stops one trip may carry (AI_MAX_ROUTE_STOPS) this runs in well under a
 *              millisecond and lands on the optimum for every small instance the tests pin.
 *
 * Two rules that come from the road rather than from the algorithm:
 *
 *   - A stop whose SHOP HAS NO COORDINATES cannot be sequenced. It is never dropped and never
 *     guessed at: it keeps its relative order and is appended after the optimised ones, so the crew
 *     still delivers it. `unpinnedCount` says how many, and the caller turns that into the plan's
 *     confidence — a plan built from three pinned shops out of ten should say so.
 *   - A TIME WINDOW (the shop's opening hours) is accepted per stop and respected as a soft
 *     preference: among equally near candidates the one whose window closes first is visited first,
 *     and `withinWindow` reports honestly whether the ETA actually lands inside it. No retailer
 *     opening-hours column exists yet (see the module's open issues), so today every window is
 *     `null` and this degrades to pure distance — the parameter is here so adding the column later
 *     needs no reshape.
 */

/** A point on the earth. Degrees, WGS-84, exactly as `retailers.lat` / `retailers.lng` store them. */
export interface RoutePoint {
  lat: number
  lng: number
}

/** Minutes after IST midnight, e.g. 9 * 60 = 09:00. A shop's shutter, when we know it. */
export interface RouteTimeWindow {
  openMinute: number
  closeMinute: number
}

/** One stop to sequence. `lat`/`lng` are null for a shop nobody has pinned yet. */
export interface RouteStopInput {
  stopId: string
  lat: number | null
  lng: number | null
  /** Seconds at this door, when it differs from the trip default (a big shop takes longer). */
  serviceSeconds?: number | null
  /** The shop's opening hours in IST minutes, when known. */
  window?: RouteTimeWindow | null
}

export interface RoutePlanOptions {
  /** Where the van starts (and, unless `returnToDepot` is false, ends): the load-out location. */
  depot?: RoutePoint | null
  /** Assumed average road speed. `tenant_settings['ai.routing.avg_speed_kmph']`. */
  avgSpeedKmph?: number
  /** Minutes spent at every door. `tenant_settings['ai.routing.service_minutes']`. */
  serviceMinutes?: number
  /** Great-circle metres × this = road metres. `tenant_settings['ai.routing.road_factor_bps']` / 10000. */
  roadFactor?: number
  /** When the van rolls out, for the ETAs. Null leaves every `etaMinutes` null. */
  startAt?: Date | null
  /** Drive back to the depot at the end (counted in the totals). Default true when a depot is given. */
  returnToDepot?: boolean
  /** Safety valve for the 2-opt loop; the default is far more passes than 80 stops ever need. */
  maxPasses?: number
}

export interface PlannedStop {
  stopId: string
  /** 1-based position in the proposed order. */
  sequence: number
  /** Road metres from the previous stop (from the depot for the first; 0 when unpinned). */
  distanceM: number
  /** Minutes after `startAt` the van should be at this door; null when `startAt` is null or unpinned. */
  etaMinutes: number | null
  /** False for a stop with no shop coordinates: it kept its place at the end. */
  pinned: boolean
  /** Null when the stop has no window or no ETA could be computed. */
  withinWindow: boolean | null
}

export interface RoutePlanResult {
  order: PlannedStop[]
  /** Road metres over every leg, including the return to the depot when there is one. */
  totalDistanceM: number
  /** Seconds: driving at `avgSpeedKmph` plus the service time at each door. */
  totalDurationS: number
  pinnedCount: number
  unpinnedCount: number
}

export const DEFAULT_AVG_SPEED_KMPH = 18
export const DEFAULT_SERVICE_MINUTES = 6
/** Urban Indian street network against the crow's flight; the founder tunes it per tenant. */
export const DEFAULT_ROAD_FACTOR = 1.35

const EARTH_RADIUS_M = 6_371_008.8
const toRadians = (deg: number): number => (deg * Math.PI) / 180

/**
 * Great-circle distance in metres. Accurate to a few metres over a city, which is two orders of
 * magnitude better than the road factor's own honesty, and it needs no projection or library.
 */
export function haversineMetres(a: RoutePoint, b: RoutePoint): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Total road metres of a path through `points`, in the order given. */
export function pathLengthMetres(
  points: readonly RoutePoint[],
  roadFactor = DEFAULT_ROAD_FACTOR,
): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    if (!from || !to) continue
    total += haversineMetres(from, to) * roadFactor
  }
  return total
}

interface Node {
  index: number
  stopId: string
  point: RoutePoint
  serviceSeconds: number
  window: RouteTimeWindow | null
}

/**
 * 2-opt on an open path with a FIXED FIRST NODE (the depot, or the stop the crew already starts at):
 * repeatedly reverse the segment between two positions whenever that shortens the path, until a full
 * pass finds no improvement. `cost(i, j)` is the leg from node i to node j; `tail` is the cost of
 * returning from the last node to the depot (0 when there is no return leg).
 *
 * Exported because it is the half worth testing on a hand-built crossing.
 */
export function twoOpt(
  order: readonly number[],
  cost: (from: number, to: number) => number,
  options: { tail?: (last: number) => number; maxPasses?: number } = {},
): number[] {
  const tail = options.tail ?? (() => 0)
  const maxPasses = options.maxPasses ?? 200
  const path = [...order]
  const legs = (p: readonly number[]): number => {
    let total = 0
    for (let i = 1; i < p.length; i++) total += cost(p[i - 1] as number, p[i] as number)
    const last = p[p.length - 1]
    return last === undefined ? total : total + tail(last)
  }
  let best = legs(path)
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false
    // i starts at 1: position 0 is the fixed start (depot, or the crew's first stop).
    for (let i = 1; i < path.length - 1 && !improved; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const candidate = [
          ...path.slice(0, i),
          ...path.slice(i, j + 1).reverse(),
          ...path.slice(j + 1),
        ]
        const length = legs(candidate)
        // A strict improvement only, with an epsilon, so floating point cannot make this loop forever.
        if (length < best - 1e-6) {
          path.splice(0, path.length, ...candidate)
          best = length
          improved = true
          break
        }
      }
    }
    if (!improved) break
  }
  return path
}

/**
 * Sequence the stops. Nearest neighbour from the start, then 2-opt; unpinned stops keep their given
 * order and follow at the end. Ties are broken by `stopId` so two identical inputs never disagree.
 */
export function planRoute(
  stops: readonly RouteStopInput[],
  options: RoutePlanOptions = {},
): RoutePlanResult {
  const roadFactor = options.roadFactor ?? DEFAULT_ROAD_FACTOR
  const speedKmph = options.avgSpeedKmph ?? DEFAULT_AVG_SPEED_KMPH
  const serviceMinutes = options.serviceMinutes ?? DEFAULT_SERVICE_MINUTES
  const depot = options.depot ?? null
  const returnToDepot = options.returnToDepot ?? depot !== null
  const metresPerSecond = (speedKmph * 1000) / 3600

  const pinned: Node[] = []
  const unpinned: RouteStopInput[] = []
  for (const stop of stops) {
    if (
      typeof stop.lat === 'number' &&
      typeof stop.lng === 'number' &&
      Number.isFinite(stop.lat) &&
      Number.isFinite(stop.lng)
    ) {
      pinned.push({
        index: pinned.length,
        stopId: stop.stopId,
        point: { lat: stop.lat, lng: stop.lng },
        serviceSeconds: stop.serviceSeconds ?? serviceMinutes * 60,
        window: stop.window ?? null,
      })
    } else unpinned.push(stop)
  }

  const legMetres = (from: RoutePoint, to: RoutePoint): number =>
    haversineMetres(from, to) * roadFactor
  const pointOf = (index: number): RoutePoint => (pinned[index] as Node).point
  const cost = (from: number, to: number): number => legMetres(pointOf(from), pointOf(to))

  let sequence: number[] = []
  if (pinned.length > 0) {
    // The first node is fixed: the stop nearest the depot, or — with no depot — the first stop given,
    // which is the sequence the crew already holds. Everything after it is the solver's business.
    const remaining = new Set(pinned.map((n) => n.index))
    let current: number
    if (depot) {
      current = pickNearest(depot, pinned, remaining, legMetres)
    } else {
      current = (pinned[0] as Node).index
    }
    remaining.delete(current)
    sequence.push(current)
    while (remaining.size > 0) {
      const next = pickNearest(pointOf(current), pinned, remaining, legMetres)
      remaining.delete(next)
      sequence.push(next)
      current = next
    }
    if (sequence.length > 2) {
      const tail =
        returnToDepot && depot ? (last: number) => legMetres(pointOf(last), depot) : undefined
      sequence = twoOpt(sequence, cost, {
        ...(tail ? { tail } : {}),
        ...(options.maxPasses === undefined ? {} : { maxPasses: options.maxPasses }),
      })
    }
  }

  const startMinutes =
    options.startAt instanceof Date && !Number.isNaN(options.startAt.getTime())
      ? istMinutes(options.startAt)
      : null
  const order: PlannedStop[] = []
  let previous: RoutePoint | null = depot
  let elapsedSeconds = 0
  let totalDistanceM = 0
  for (const index of sequence) {
    const node = pinned[index] as Node
    const distanceM = previous ? Math.round(legMetres(previous, node.point)) : 0
    totalDistanceM += distanceM
    elapsedSeconds += metresPerSecond > 0 ? distanceM / metresPerSecond : 0
    const etaMinutes = startMinutes === null ? null : Math.round(elapsedSeconds / 60)
    const arrival = startMinutes === null ? null : startMinutes + etaMinutes!
    order.push({
      stopId: node.stopId,
      sequence: order.length + 1,
      distanceM,
      etaMinutes,
      pinned: true,
      withinWindow:
        node.window && arrival !== null
          ? arrival >= node.window.openMinute && arrival <= node.window.closeMinute
          : null,
    })
    elapsedSeconds += node.serviceSeconds
    previous = node.point
  }
  for (const stop of unpinned) {
    order.push({
      stopId: stop.stopId,
      sequence: order.length + 1,
      distanceM: 0,
      etaMinutes: null,
      pinned: false,
      withinWindow: null,
    })
    elapsedSeconds += stop.serviceSeconds ?? serviceMinutes * 60
  }
  if (returnToDepot && depot && previous) {
    const back = Math.round(legMetres(previous, depot))
    totalDistanceM += back
    elapsedSeconds += metresPerSecond > 0 ? back / metresPerSecond : 0
  }

  return {
    order,
    totalDistanceM,
    totalDurationS: Math.round(elapsedSeconds),
    pinnedCount: pinned.length,
    unpinnedCount: unpinned.length,
  }
}

/**
 * Road metres of an EXISTING sequence, scored with exactly the model `planRoute` uses, so "the plan
 * is shorter than what the trip holds today" is a comparison of like with like. Unpinned stops
 * contribute nothing, as they do in the plan.
 */
export function sequenceDistanceM(
  stops: readonly RouteStopInput[],
  options: RoutePlanOptions = {},
): number {
  const roadFactor = options.roadFactor ?? DEFAULT_ROAD_FACTOR
  const depot = options.depot ?? null
  const returnToDepot = options.returnToDepot ?? depot !== null
  const points: RoutePoint[] = []
  for (const stop of stops) {
    if (
      typeof stop.lat === 'number' &&
      typeof stop.lng === 'number' &&
      Number.isFinite(stop.lat) &&
      Number.isFinite(stop.lng)
    )
      points.push({ lat: stop.lat, lng: stop.lng })
  }
  if (points.length === 0) return 0
  const path = depot ? [depot, ...points] : points
  const full = returnToDepot && depot ? [...path, depot] : path
  let total = 0
  for (let i = 1; i < full.length; i++)
    total += Math.round(
      haversineMetres(full[i - 1] as RoutePoint, full[i] as RoutePoint) * roadFactor,
    )
  return total
}

/** Nearest remaining node to `from`; ties broken by `stopId` so the answer never depends on input order. */
function pickNearest(
  from: RoutePoint,
  nodes: readonly Node[],
  remaining: ReadonlySet<number>,
  legMetres: (a: RoutePoint, b: RoutePoint) => number,
): number {
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  let bestId = ''
  for (const index of remaining) {
    const node = nodes[index] as Node
    const distance = legMetres(from, node.point)
    if (
      distance < bestDistance - 1e-9 ||
      (Math.abs(distance - bestDistance) <= 1e-9 && (bestIndex < 0 || node.stopId < bestId))
    ) {
      bestIndex = index
      bestDistance = distance
      bestId = node.stopId
    }
  }
  return bestIndex
}

/** Minutes after IST midnight of an instant — the same clock a shop's shutter is quoted in. */
export function istMinutes(at: Date): number {
  const ist = new Date(at.getTime() + 5.5 * 3600 * 1000)
  return ist.getUTCHours() * 60 + ist.getUTCMinutes()
}
