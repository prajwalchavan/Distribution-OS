/**
 * What the M3 documents panel offers on a document, decided by the document machine (DOS-031).
 *
 * Pure rules over a status the screen already holds: no React, no kit, no request.
 */
import type { DocumentKind, DocumentStatus } from '@dos/contracts'
import { documentMachine } from '@dos/domain'

/**
 * Whether Start reviewing is offered: only where `documentMachine` has a `start_review` transition,
 * which today is `extracted` and `needs_review`.
 *
 * It is the same table the server reads twice in `review.start`: its guard refuses any other status
 * with 409 before it takes the lock, and `transition(tx, doc, 'start_review')` then applies it. So a
 * Reviewed, Committed, Rejected or Failed document never shows a button the server always refuses; the
 * status chip says where the document is. A document another desk moved since the last read can still
 * show it once, and the server's 409 is the backstop there.
 */
export function mayStartReview(status: DocumentStatus): boolean {
  return documentMachine.can(status, 'start_review')
}

/**
 * What "Book it as a supplier bill" says on a document (DOS-215).
 *
 * `docint.documents.approve` books a draft only from `reviewed` — the `commit` row of
 * `documentMachine`, and the service's own guard ("only a reviewed document can be approved", 409).
 * Day 1 of the business simulation found the button offered, enabled, on an `Extracted` document:
 * the manager confirmed the dialog and read the server's refusal. Now:
 *
 *   - `hidden` on a document that is finished (booked, given up, failed): there is nothing to book,
 *     and the status chip already says where it is;
 *   - `disabled` with the NEXT STEP as the reason while it is still being read or still waiting for
 *     a person to say the reading is right — the order the desk must follow, on the button itself;
 *   - `disabled` on a brand-DMS bill, which is never a second legal invoice (docs/22) and which the
 *     service refuses to book here;
 *   - `ready` only where the server will take it: reviewed, with lines to book.
 *
 * The reason is a string KEY in the manager namespace, so the rule stays free of the kit.
 */
export type ApproveOffer =
  { kind: 'hidden' } | { kind: 'disabled'; reason: ApproveBlockKey } | { kind: 'ready' }

export type ApproveBlockKey =
  | 'm3.approveStillReading'
  | 'm3.approveStartReview'
  | 'm3.approveSubmitFirst'
  | 'm3.approveBrandDms'
  | 'm3.noLines'

export function approveOffer(doc: {
  status: DocumentStatus
  kind: DocumentKind
  /** A review session this desk holds open on the document right now. */
  reviewing: boolean
  lineCount: number
}): ApproveOffer {
  if (documentMachine.isTerminal(doc.status)) return { kind: 'hidden' }
  if (doc.kind === 'brand_dms_invoice') return { kind: 'disabled', reason: 'm3.approveBrandDms' }
  if (!documentMachine.can(doc.status, 'commit')) {
    if (documentMachine.can(doc.status, 'start_review'))
      return {
        kind: 'disabled',
        reason: doc.reviewing ? 'm3.approveSubmitFirst' : 'm3.approveStartReview',
      }
    return { kind: 'disabled', reason: 'm3.approveStillReading' }
  }
  if (doc.lineCount === 0) return { kind: 'disabled', reason: 'm3.noLines' }
  return { kind: 'ready' }
}

/** "Give it up" only where the machine has a `reject` row: never on a booked, given-up or failed one. */
export function mayReject(status: DocumentStatus): boolean {
  return documentMachine.can(status, 'reject')
}
