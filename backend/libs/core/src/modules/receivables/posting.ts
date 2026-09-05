import { and, eq, inArray } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import { uuidv7 } from '@dos/domain'
import { accounts, journalEntries, journalLines, outboxEvents, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * The double-entry book (ADR 0004). Nothing else in the codebase may write `journal_entries` or
 * `journal_lines`: billing, delivery and claims all come through `ReceivablesService.postEntry`.
 *
 * SIGN CONVENTION: `amount_paise` is debit positive, credit negative, and every entry sums to exactly 0.
 * It is checked here before the insert and again by the deferred `journal_lines_balanced` constraint
 * trigger at COMMIT (made `SECURITY DEFINER` by migration 0007 so it still sees the lines a field role
 * posted but may not read).
 *
 * WHY NO `RETURNING` AND NO `ON CONFLICT` BELOW — this is not a style choice.
 * Migration 0006 gives the journal a SELECT policy for the back office and an INSERT policy for the roles
 * that take money in the field (`LEDGER_POSTING_ROLES`). PostgreSQL applies the SELECT policy as an extra
 * check on the proposed row whenever a statement carries `RETURNING` or `ON CONFLICT`, so both forms raise
 * "new row violates row-level security policy" for a `delivery` actor even though the plain INSERT is
 * allowed. Every write here is therefore a bare INSERT with a client-generated id, and idempotency is a
 * SELECT taken first (which is what a back-office replay hits).
 */

export interface JournalLineInput {
  accountCode: string
  amountPaise: number
  partyType?: string | undefined
  partyId?: string | undefined
  memo?: string | undefined
}

export interface JournalEntryInput {
  entryDate: string
  refType: string
  refId: string
  narration?: string | undefined
  idempotencyKey: string
  lines: JournalLineInput[]
}

/** Resolve account codes to ids for this tenant. `accounts` is readable by every staff role (no amounts). */
export async function accountIdsByCode(
  tx: Db,
  codes: readonly string[],
): Promise<Map<string, string>> {
  const { tenantId } = currentTenant()
  const wanted = [...new Set(codes)]
  if (wanted.length === 0) return new Map()
  const rows = await tx
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.code, wanted)))
  const map = new Map(rows.map((r) => [r.code, r.id]))
  for (const code of wanted) {
    if (!map.has(code)) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: `chart of accounts is missing ${code}; run bootstrapTenant for this distributor`,
      })
    }
  }
  return map
}

/** The entry a derived key already produced, if the caller's role is allowed to read the book. */
async function findEntryByKey(tx: Db, idempotencyKey: string): Promise<string | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.idempotencyKey, idempotencyKey)),
    )
    .limit(1)
  return row?.id ?? null
}

/**
 * One balanced, keyed, append-only entry. Zero-amount lines are dropped (the `journal_lines_nonzero`
 * check refuses them and they carry no information); an entry that would end up empty, or that does not
 * sum to zero, is a bug in the caller and fails loudly before anything is written.
 */
export async function postJournalEntry(
  tx: Db,
  entry: JournalEntryInput,
): Promise<{ entryId: string }> {
  const { tenantId, actorId } = currentTenant()
  const lines = entry.lines.filter((l) => l.amountPaise !== 0)
  if (lines.length === 0) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: `journal entry ${entry.refType}:${entry.refId} has no money in it`,
    })
  }
  const total = lines.reduce((s, l) => s + l.amountPaise, 0)
  if (total !== 0) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: `journal entry ${entry.refType}:${entry.refId} does not balance (sum = ${String(total)} paise)`,
    })
  }
  const existing = await findEntryByKey(tx, entry.idempotencyKey)
  if (existing) return { entryId: existing }

  const ids = await accountIdsByCode(
    tx,
    lines.map((l) => l.accountCode),
  )
  const entryId = uuidv7()
  await tx.insert(journalEntries).values({
    id: entryId,
    tenantId,
    entryDate: entry.entryDate,
    refType: entry.refType,
    refId: entry.refId,
    narration: entry.narration ?? null,
    idempotencyKey: entry.idempotencyKey,
    postedBy: actorId,
  })
  await tx.insert(journalLines).values(
    lines.map((line) => ({
      id: uuidv7(),
      tenantId,
      entryId,
      accountId: ids.get(line.accountCode) ?? '',
      amountPaise: line.amountPaise,
      partyType: line.partyType ?? null,
      partyId: line.partyId ?? null,
      memo: line.memo ?? null,
    })),
  )
  return { entryId }
}

/**
 * The only correction a ledger allows: a mirror entry whose lines are the negation of the original's, with
 * `reversed_by_entry_id` stamped on the original. Reading the original's lines needs the back-office SELECT
 * policy, which is exactly who may call `receipts.reverse`, `receipts.bounce` and the claims reversal.
 */
export async function reverseJournalEntry(
  tx: Db,
  entryId: string,
  idempotencyKey: string,
  narration?: string,
): Promise<{ entryId: string }> {
  const { tenantId } = currentTenant()
  const [original] = await tx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.id, entryId)))
    .limit(1)
  if (!original) {
    throw new ORPCError('NOT_FOUND', { message: `journal entry ${entryId} not found` })
  }
  const lines = await tx
    .select({
      code: accounts.code,
      amountPaise: journalLines.amountPaise,
      partyType: journalLines.partyType,
      partyId: journalLines.partyId,
      memo: journalLines.memo,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.tenantId, tenantId), eq(journalLines.entryId, entryId)))
  const posted = await postJournalEntry(tx, {
    entryDate: original.entryDate,
    refType: `${original.refType}_reversal`,
    refId: original.refId,
    narration: narration ?? `reverses ${entryId}`,
    idempotencyKey,
    lines: lines.map((l) => ({
      accountCode: l.code,
      amountPaise: -l.amountPaise,
      partyType: l.partyType ?? undefined,
      partyId: l.partyId ?? undefined,
      memo: l.memo ?? undefined,
    })),
  })
  await stampReversed(tx, entryId, posted.entryId)
  return posted
}

/** Records which entry undid this one. UPDATE on the book is back-office only (migration 0006). */
export async function stampReversed(
  tx: Db,
  entryId: string,
  reversalEntryId: string,
): Promise<void> {
  const { tenantId } = currentTenant()
  await tx
    .update(journalEntries)
    .set({ reversedByEntryId: reversalEntryId })
    .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.id, entryId)))
}

/** The entry a document produced, so a reversal can find it without the caller passing an id around. */
export async function findEntryByRef(
  tx: Db,
  refType: string,
  refId: string,
): Promise<string | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        eq(journalEntries.refType, refType),
        eq(journalEntries.refId, refId),
      ),
    )
    .limit(1)
  return row?.id ?? null
}

/** Other modules react to money through these events, never by reading the ledger (docs/16 §2). */
export async function emitEvent(
  tx: Db,
  aggregateType: 'receipt' | 'invoice' | 'retailer',
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(outboxEvents).values({
    id: uuidv7(),
    tenantId: currentTenant().tenantId,
    aggregateType,
    aggregateId,
    eventType,
    payload,
  })
}
