import { defineMachine } from './machine.js'

/**
 * Inbound document intake (docs/22 §5, docs/plans/docint.md §4.6). A photograph or PDF of a supplier's
 * bill walks `uploaded → verifying → extracting → extracted | needs_review → reviewed → committed`;
 * `rejected` and `failed` are reachable from any non-terminal state and, like `committed`, are final.
 *
 * The states are exactly the values of the `document_status` Postgres enum (schema/docint.ts), so
 * `machine.next()` is safe to write straight into the column — nothing assigns `documents.status` by
 * hand (never-list 7).
 *
 * WHO MOVES WHAT. The capture procedure `documents.submit` fires `submit`; the worker's pipeline jobs
 * fire `verified` (QR re-checked, prompt profile chosen), then `extracted` (a clean reading) or `flag`
 * (any failed check or an unmatched line); the review desk fires `start_review` (takes the lock),
 * `release` (gives the document back), `review_submitted` (zero red checks) and `commit` (the supplier
 * invoice DRAFT is booked — never a GRN, never-list 6); `extractions.run` fires `retry`; the desk fires
 * `reject`; the pipeline fires `fail` after the last attempt. `needs_review → needs_review` on
 * `start_review` lets a second reviewer take over a released or expired session without a detour.
 */
export type DocumentState =
  | 'uploaded'
  | 'verifying'
  | 'extracting'
  | 'extracted'
  | 'needs_review'
  | 'reviewed'
  | 'committed'
  | 'rejected'
  | 'failed'

export type DocumentEvent =
  | 'submit'
  | 'verified'
  | 'extracted'
  | 'flag'
  | 'start_review'
  | 'release'
  | 'review_submitted'
  | 'commit'
  | 'retry'
  | 'reject'
  | 'fail'

export const documentMachine = defineMachine<DocumentState, DocumentEvent>({
  name: 'document',
  initial: 'uploaded',
  terminal: ['committed', 'rejected', 'failed'],
  transitions: {
    uploaded: { submit: 'verifying', reject: 'rejected', fail: 'failed' },
    verifying: { verified: 'extracting', reject: 'rejected', fail: 'failed' },
    extracting: {
      extracted: 'extracted',
      flag: 'needs_review',
      reject: 'rejected',
      fail: 'failed',
    },
    extracted: {
      start_review: 'needs_review',
      flag: 'needs_review',
      retry: 'extracting',
      reject: 'rejected',
      fail: 'failed',
    },
    needs_review: {
      start_review: 'needs_review',
      release: 'extracted',
      review_submitted: 'reviewed',
      retry: 'extracting',
      reject: 'rejected',
      fail: 'failed',
    },
    // A reviewed document may still be re-read by hand (`force`) or rejected; committing is the only way forward.
    reviewed: { commit: 'committed', retry: 'extracting', reject: 'rejected' },
    committed: {},
    rejected: {},
    failed: {},
  },
})

/** The single-writer review lock (docs/05 step 10): one session per document is `open` at a time. */
export type ReviewSessionState = 'open' | 'submitted' | 'abandoned'
export type ReviewSessionEvent = 'submit' | 'abandon'

export const reviewSessionMachine = defineMachine<ReviewSessionState, ReviewSessionEvent>({
  name: 'review_session',
  initial: 'open',
  terminal: ['submitted', 'abandoned'],
  transitions: {
    open: { submit: 'submitted', abandon: 'abandoned' },
    submitted: {},
    abandoned: {},
  },
})
