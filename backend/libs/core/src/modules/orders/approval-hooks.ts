import { Injectable } from '@nestjs/common'
import type { ApprovalTripSettlement } from '@dos/contracts'
import type { Db } from '@dos/db'
import type { ApprovalRow } from './orders.mappers.js'

/** What a module downstream of orders does when the owner decides one of ITS approvals. */
export interface ApprovalDecisionResult {
  trip?: { id: string; tripNo: string | null; state: string } | null
}

export interface ApprovalKindHook {
  /**
   * Runs inside the decision's own transaction, AFTER the approval row is written: a throw rolls the
   * decision back, so the approval stays pending and the refusal reaches the person who pressed.
   */
  decide(
    tx: Db,
    approval: ApprovalRow,
    decision: 'approve' | 'reject',
    note: string | null,
  ): Promise<ApprovalDecisionResult>
  /** What the queue shows for a page of this kind's rows, by approval id. */
  describe(tx: Db, rows: readonly ApprovalRow[]): Promise<Map<string, ApprovalTripSettlement>>
}

/**
 * THE APPROVALS QUEUE IS ORDERS', SOME OF ITS KINDS ARE NOT (QA DOS-235).
 *
 * A `trip_settlement` approval is filed by delivery when a trip's count does not tally, and deciding it has
 * to settle that trip. Orders sits upstream of delivery and may not import it, so delivery registers what
 * its kind does here when the module starts — the same shape as `SyncRegistry`. A kind listed in
 * `HOOKED_KINDS` with nothing registered is refused rather than approved in name only, which is exactly how
 * TRIP-0002 was "approved" and stayed `closing`.
 */
@Injectable()
export class ApprovalHooks {
  private readonly hooks = new Map<string, ApprovalKindHook>()

  register(kind: string, hook: ApprovalKindHook): void {
    if (this.hooks.has(kind)) throw new Error(`approval hook for ${kind} already registered`)
    this.hooks.set(kind, hook)
  }

  get(kind: string): ApprovalKindHook | undefined {
    return this.hooks.get(kind)
  }
}

/** The kinds whose decision means nothing unless the module that filed them acts on it. */
export const HOOKED_KINDS: ReadonlySet<string> = new Set(['trip_settlement'])
