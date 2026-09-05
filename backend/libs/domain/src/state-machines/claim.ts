import { defineMachine } from './machine.js'

/**
 * A claim on a manufacturer (docs/plans/claims.md §3, contract `claims.ts`): money the brand owes the
 * distributor for company-funded schemes given away on invoices, damaged / expired stock taken back,
 * inbound shortages and rate differences.
 *
 * `draft` (no number, no journal) → `submit` allocates the CLAIM number and accrues the receivable →
 * `submitted` → `acknowledge` records the brand's own reference → `acknowledged`; the brand then pays
 * in one or several settlements (`settle_partial` → `partially_settled`, `settle_full` → `settled`),
 * or refuses (`reject`: the accrual is reversed by a NEW entry, the sources are freed for a later
 * claim), or the unrecovered remainder is accepted as a loss (`write_off`, owner / accountant only). A
 * draft opened by mistake is `cancel`led: it never had a number, so nothing is reversed.
 *
 * The states are exactly the values of the `claim_status` Postgres enum (schema/claims.ts; `written_off`
 * joined in migration 0021, `cancelled` in 0026), so `machine.next()` is safe to write straight into
 * the column — nothing assigns `claims.status` by hand (docs/22 never-list 7). `settled`, `rejected`,
 * `written_off` and `cancelled` are final; a rejected or written-off claim KEEPS its number.
 */
export type ClaimState =
  | 'draft'
  | 'submitted'
  | 'acknowledged'
  | 'partially_settled'
  | 'settled'
  | 'rejected'
  | 'written_off'
  | 'cancelled'

export type ClaimEvent =
  'submit' | 'acknowledge' | 'settle_partial' | 'settle_full' | 'reject' | 'write_off' | 'cancel'

export const claimMachine = defineMachine<ClaimState, ClaimEvent>({
  name: 'claim',
  initial: 'draft',
  terminal: ['settled', 'rejected', 'written_off', 'cancelled'],
  transitions: {
    draft: { submit: 'submitted', cancel: 'cancelled' },
    submitted: {
      acknowledge: 'acknowledged',
      settle_partial: 'partially_settled',
      settle_full: 'settled',
      reject: 'rejected',
      write_off: 'written_off',
    },
    acknowledged: {
      settle_partial: 'partially_settled',
      settle_full: 'settled',
      reject: 'rejected',
      write_off: 'written_off',
    },
    // Money has landed against this claim: it can no longer be rejected, only settled further or written off.
    partially_settled: {
      settle_partial: 'partially_settled',
      settle_full: 'settled',
      write_off: 'written_off',
    },
    settled: {},
    rejected: {},
    written_off: {},
    cancelled: {},
  },
})
