/**
 * What the M3 documents panel offers on a document, decided by the document machine (DOS-031).
 *
 * Pure rules over a status the screen already holds: no React, no kit, no request.
 */
import type { DocumentStatus } from '@dos/contracts'
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
