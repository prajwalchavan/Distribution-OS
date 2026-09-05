import { createHash } from 'node:crypto'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { ClaimKind, ClaimLineDetail } from '@dos/contracts'
import {
  claimMachine,
  TransitionError,
  uuidv7,
  type ClaimEvent,
  type ClaimState,
} from '@dos/domain'
import {
  claimLines,
  claims,
  outboxEvents,
  type claimEvidence,
  type claimSettlements,
  type claimStatements,
  type Db,
} from '@dos/db'
import { currentTenant, isUniqueViolation, pgMessage } from '../../platform/index.js'

/**
 * The plumbing every claim mutation shares: the row lock, the machine guard, the recompute of the
 * header money from the lines, the ledger account per kind, the outbox row. Nothing here talks to
 * another module; the services do that through the owning module's `index.ts` (coordination §4).
 */

export type ClaimRow = typeof claims.$inferSelect
export type ClaimLineRow = typeof claimLines.$inferSelect
export type ClaimEvidenceRow = typeof claimEvidence.$inferSelect
export type ClaimStatementRow = typeof claimStatements.$inferSelect
export type ClaimSettlementRow = typeof claimSettlements.$inferSelect

/** Outbox event types (brief §7); `aggregate_type = 'claim'` for every one of them. */
export const CLAIM_EVENTS = {
  submitted: 'ClaimSubmitted',
  settled: 'ClaimSettled',
  rejected: 'ClaimRejected',
  writtenOff: 'ClaimWrittenOff',
  statementRequested: 'ClaimStatementRequested',
} as const

/** Claim statuses still on our side of the table: an outstanding receivable from the brand. */
export const OPEN_STATUSES: readonly ClaimState[] = [
  'submitted',
  'acknowledged',
  'partially_settled',
]

/**
 * The ledger side of a kind (brief §2 `submit`): a scheme or a rate difference is scheme money the
 * brand funds, damage / expiry / shortage / other is stock the brand takes back.
 */
export function receivableAccountFor(kind: ClaimKind): 'SCHEME_RECEIVABLE' | 'CLAIMS_RECEIVABLE' {
  return kind === 'scheme' || kind === 'rate_difference' ? 'SCHEME_RECEIVABLE' : 'CLAIMS_RECEIVABLE'
}

export function expenseAccountFor(kind: ClaimKind): 'SCHEME_EXPENSE' | 'DAMAGES' {
  return kind === 'scheme' || kind === 'rate_difference' ? 'SCHEME_EXPENSE' : 'DAMAGES'
}

/**
 * The id of a BUILT line is a function of (claim, source): rebuilding a line the desk removed gives
 * it the same id again, so a screen (or a doc example) that named it keeps working, and two builds
 * racing on one claim cannot insert the same source twice. UUID-shaped (version 7 / variant 8
 * nibbles) so the contract's `IdSchema` accepts it; manual lines keep the client's own id.
 */
export function builtLineId(claimId: string, sourceType: string, sourceId: string): string {
  const h = createHash('sha256')
    .update(`dos-claim-line:${claimId}:${sourceType}:${sourceId}`)
    .digest()
  const b = Buffer.from(h.subarray(0, 16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = b.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Deterministic journal keys (brief §4.15): a replay posts nothing twice. */
export const journalKeys = {
  accrue: (claimId: string) => `claim:accrue:${claimId}`,
  settle: (settlementId: string) => `claim:settle:${settlementId}`,
  reject: (claimId: string) => `claim:reject:${claimId}`,
  writeOff: (claimId: string) => `claim:writeoff:${claimId}`,
}

/** The claim, or 404; `lock` takes `FOR UPDATE` so two desks cannot submit or settle it at once. */
export async function loadClaim(tx: Db, id: string, lock = false): Promise<ClaimRow> {
  const { tenantId } = currentTenant()
  const base = tx
    .select()
    .from(claims)
    .where(and(eq(claims.tenantId, tenantId), eq(claims.id, id)))
    .limit(1)
  const [row] = lock ? await base.for('update') : await base
  if (!row) throw new ORPCError('NOT_FOUND', { message: `claim ${id} not found` })
  return row
}

/** `claimMachine.next()` as a 409, never a 500: the desk pressed a button the state does not allow. */
export function transition(claim: ClaimRow, event: ClaimEvent): ClaimState {
  try {
    return claimMachine.next(claim.status, event)
  } catch (error) {
    if (error instanceof TransitionError) {
      throw new ORPCError('CONFLICT', {
        message: `claim ${claim.claimNo ?? claim.id} is ${claim.status}; cannot ${event.replace('_', ' ')}`,
      })
    }
    throw error
  }
}

export function requireDraft(claim: ClaimRow, what: string): void {
  if (claim.status !== 'draft') {
    throw new ORPCError('CONFLICT', {
      message: `claim ${claim.claimNo ?? claim.id} is ${claim.status}; ${what} is allowed on a draft only`,
    })
  }
}

/**
 * `claims.claimed_paise = Σ amount_paise` of the non-rejected lines (brief §4.1) — recomputed after
 * every line mutation, never incremented. Returns the fresh header.
 */
export async function recomputeClaimed(tx: Db, claimId: string): Promise<ClaimRow> {
  const { tenantId } = currentTenant()
  const [totals] = await tx
    .select({
      claimed: sql<string>`coalesce(sum(${claimLines.amountPaise}), 0)`,
    })
    .from(claimLines)
    .where(
      and(
        eq(claimLines.tenantId, tenantId),
        eq(claimLines.claimId, claimId),
        ne(claimLines.status, 'rejected'),
      ),
    )
  const [row] = await tx
    .update(claims)
    .set({ claimedPaise: Number(totals?.claimed ?? 0), updatedAt: new Date() })
    .where(and(eq(claims.tenantId, tenantId), eq(claims.id, claimId)))
    .returning()
  if (!row) throw new ORPCError('NOT_FOUND', { message: `claim ${claimId} not found` })
  return row
}

export async function linesOf(tx: Db, claimId: string): Promise<ClaimLineRow[]> {
  const { tenantId } = currentTenant()
  return tx
    .select()
    .from(claimLines)
    .where(and(eq(claimLines.tenantId, tenantId), eq(claimLines.claimId, claimId)))
    .orderBy(asc(claimLines.lineNo), asc(claimLines.id))
}

export async function loadLine(tx: Db, claimId: string, lineId: string): Promise<ClaimLineRow> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select()
    .from(claimLines)
    .where(
      and(
        eq(claimLines.tenantId, tenantId),
        eq(claimLines.claimId, claimId),
        eq(claimLines.id, lineId),
      ),
    )
    .limit(1)
  if (!row) throw new ORPCError('NOT_FOUND', { message: `line ${lineId} is not on this claim` })
  return row
}

export function detailOf(row: ClaimLineRow): ClaimLineDetail {
  const d = row.detail
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as ClaimLineDetail) : {}
}

/** Other modules (notifications, the worker) react to a claim through these rows, never by reading its tables. */
export async function emitClaimEvent(
  tx: Db,
  claimId: string,
  eventType: (typeof CLAIM_EVENTS)[keyof typeof CLAIM_EVENTS],
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(outboxEvents).values({
    id: uuidv7(),
    tenantId: currentTenant().tenantId,
    aggregateType: 'claim',
    aggregateId: claimId,
    eventType,
    payload,
  })
}

/** A unique-index refusal as the 409 the desk understands; anything else is re-thrown. */
export function conflictFrom(error: unknown, message: string): never {
  if (isUniqueViolation(error)) throw new ORPCError('CONFLICT', { message })
  throw error instanceof Error
    ? error
    : new ORPCError('INTERNAL_SERVER_ERROR', { message: pgMessage(error) })
}

/** `YYYY-MM-DD` plus `days`, as a calendar date (no timezone can creep in). */
export function addDaysIso(isoDate: string, days: number): string {
  const at = Date.UTC(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
  )
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10)
}

/** An IST calendar date as the instant it began (for `submitted_at` and friends when the desk gives a date). */
export function istInstant(isoDate: string | undefined, now: Date): Date {
  if (!isoDate) return now
  return new Date(Date.parse(`${isoDate}T00:00:00.000+05:30`))
}
