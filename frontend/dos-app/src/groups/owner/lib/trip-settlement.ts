/**
 * WHAT THE OWNER IS ASKED TO ACCEPT ON A TRIP SETTLEMENT (QA DOS-235), as pure functions of the queue row.
 *
 * The desk counts the cash and the van; a count outside the tolerance, or any lot that does not tally,
 * goes to the owner, and APPROVING IT SETTLES THE TRIP (the server does it in the same step). The row used
 * to read "Trip settlement · — · Meena Joshi · —": no trip, no cash, no pieces. These helpers turn the
 * server's `tripSettlement` block into the few facts the owner decides on — which trip, how far the cash
 * is off and against what allowance, how many pieces go missing and what they cost — and nothing here
 * re-derives a figure the server already answered.
 */
import type { ApprovalQueueItem, ApprovalTripSettlement } from '@dos/contracts'

/** The trip block of a queue row, or null for every other kind (and an unreadable old request). */
export function tripOf(
  row: Pick<ApprovalQueueItem, 'kind' | 'tripSettlement'>,
): ApprovalTripSettlement | null {
  if (row.kind !== 'trip_settlement') return null
  return row.tripSettlement ?? null
}

/** "TRIP-0002 · MH-05-EF-9012": what the queue row is called. */
export function tripName(trip: ApprovalTripSettlement): string {
  return [trip.tripNo ?? trip.tripId.slice(0, 8), trip.vehicleRegNo]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ')
}

export type CashOff = 'short' | 'over' | 'exact'

/** Which way the cash is off: a negative variance is money missing. */
export function cashOff(trip: Pick<ApprovalTripSettlement, 'cashVariancePaise'>): CashOff {
  if (trip.cashVariancePaise < 0) return 'short'
  return trip.cashVariancePaise > 0 ? 'over' : 'exact'
}

/** Is the cash difference itself beyond what the owner allows (and not only the stock)? */
export function cashBeyondTolerance(
  trip: Pick<ApprovalTripSettlement, 'cashVariancePaise' | 'tolerancePaise'>,
): boolean {
  return Math.abs(trip.cashVariancePaise) > trip.tolerancePaise
}

export interface StockSummary {
  /** Lots whose count differs. */
  lots: number
  /** Pieces counted below what the van should hold. */
  missingPcs: number
  /** Pieces counted above it. */
  extraPcs: number
  /** Σ value at cost of the lines that carry one; null when none does. Negative = pieces missing. */
  valuePaise: number | null
}

export function stockSummary(
  trip: Pick<ApprovalTripSettlement, 'stockVariance' | 'stockVarianceValuePaise'>,
): StockSummary {
  const off = trip.stockVariance.filter((line) => line.deltaPcs !== 0)
  return {
    lots: off.length,
    missingPcs: off.reduce((n, line) => n + Math.max(0, -line.deltaPcs), 0),
    extraPcs: off.reduce((n, line) => n + Math.max(0, line.deltaPcs), 0),
    valuePaise: trip.stockVarianceValuePaise,
  }
}
