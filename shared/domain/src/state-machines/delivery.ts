import { defineMachine } from './machine.js'

/**
 * A trip is a vehicle leaving the warehouse with a load sheet. The vehicle is a stock location:
 * `loading -> active` posts transfer_out (warehouse) / transfer_in (vehicle) in one transaction, and
 * `closing` counts unsold stock and returns back in before cash is settled.
 */
export type TripState =
  'planned' | 'loading' | 'active' | 'closing' | 'settled' | 'settled_with_variance' | 'cancelled'
export type TripEvent =
  'start_loading' | 'depart' | 'return' | 'settle' | 'settle_with_variance' | 'cancel'

export const tripMachine = defineMachine<TripState, TripEvent>({
  name: 'trip',
  initial: 'planned',
  terminal: ['settled', 'settled_with_variance', 'cancelled'],
  transitions: {
    planned: { start_loading: 'loading', cancel: 'cancelled' },
    loading: { depart: 'active', cancel: 'cancelled' },
    active: { return: 'closing' },
    // settlement outside the owner's tolerance needs owner approval and is recorded as variance
    closing: { settle: 'settled', settle_with_variance: 'settled_with_variance' },
    settled: {},
    settled_with_variance: {},
    cancelled: {},
  },
})

/** One order on a trip. Monotonic and server-enforced; out-of-order batches are accepted if the device timestamps form a valid sequence. */
export type StopState = 'pending' | 'started' | 'arrived' | 'delivered' | 'partial' | 'failed'
export type StopEvent = 'start' | 'arrive' | 'deliver' | 'deliver_partial' | 'fail'

export const stopMachine = defineMachine<StopState, StopEvent>({
  name: 'stop',
  initial: 'pending',
  terminal: ['delivered', 'partial', 'failed'],
  transitions: {
    pending: { start: 'started' },
    started: { arrive: 'arrived' },
    arrived: { deliver: 'delivered', deliver_partial: 'partial', fail: 'failed' },
    delivered: {},
    partial: {},
    failed: {},
  },
})
