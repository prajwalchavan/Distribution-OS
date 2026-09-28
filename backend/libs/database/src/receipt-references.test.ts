import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createPool } from './client.js'
import {
  receiptReferenceDuplicates,
  receiptReferenceFaults,
  receiptReferenceReport,
} from './receipt-references.js'
import { invoices, receipts, retailers, tenants, users, writeOffs } from './schema/index.js'

/**
 * The database's own word on the two P0s of the money phase (migration 0079), for rows that get past the service:
 *
 *   DOS-310  `receipts_reference_is_free`: a UPI / transfer reference already on a live receipt of the distributor,
 *            or a cheque number already on a live receipt of the same shop, is refused at INSERT; another shop's
 *            cheque number is not the database's question; a reversed, bounced or cancelled receipt frees it; a
 *            status change never re-judges history (a legacy pair still banks); the release check names the pair.
 *   DOS-311  `write_offs_recovery_within_original`: a recovery takes back at most what was written off, and the
 *            undo of a recovery restores no more, checked at COMMIT.
 */
const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('receipt references and write-off recoveries (migration 0079, DATABASE_URL)', () => {
  const pool = createPool(url ?? '', 3)
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const owner = uuidv7()
  const shopA = uuidv7()
  const shopB = uuidv7()
  const bill = uuidv7()
  let n = 0

  function receipt(
    retailerId: string,
    mode: 'upi' | 'bank_transfer' | 'cheque' | 'cash',
    reference: string | null,
    extra: Partial<typeof receipts.$inferInsert> = {},
  ): typeof receipts.$inferInsert {
    n += 1
    return {
      id: uuidv7(),
      tenantId,
      receiptNo: `RR-${run}-${String(n)}`,
      fy: '2026-27',
      retailerId,
      mode,
      amountPaise: 10_000,
      receivedAt: new Date(),
      receivedBy: owner,
      reference,
      idempotencyKey: `rr-${run}-${String(n)}`,
      ...extra,
    }
  }

  /** The Postgres error behind a refused statement (drizzle wraps it as `cause`). */
  async function refusal(write: Promise<unknown>): Promise<string> {
    try {
      await write
    } catch (error) {
      const cause = (error as { cause?: { message?: string } }).cause
      return cause?.message ?? (error as Error).message
    }
    return 'not refused'
  }

  beforeAll(async () => {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `rr-${run}`,
      legalName: 'Reference test',
      stateCode: '27',
    })
    await db.insert(users).values({ id: owner, phone: `+91917${run}1`, name: 'Owner' })
    await db.insert(retailers).values([
      {
        id: shopA,
        tenantId,
        code: `RA${run}`,
        name: 'Shop A',
        phone: `+91917${run}2`,
        stateCode: '27',
      },
      {
        id: shopB,
        tenantId,
        code: `RB${run}`,
        name: 'Shop B',
        phone: `+91917${run}3`,
        stateCode: '27',
      },
    ])
    await db.insert(invoices).values({
      id: bill,
      tenantId,
      invoiceNo: `RR${run}/1`,
      fy: '2026-27',
      invoiceDate: '2026-09-01',
      retailerId: shopA,
      state: 'written_off',
      buyerName: 'Shop A',
      placeOfSupplyState: '27',
      totalPaise: 10_000,
    })
  })

  afterAll(async () => {
    // The history pairs this file builds on purpose would otherwise stand in the database for good and fail
    // `pnpm check:receipt-references` there: they are cancelled on the way out (a status change, never re-judged).
    await db.update(receipts).set({ status: 'cancelled' }).where(eq(receipts.tenantId, tenantId))
    await pool.end()
  })

  it('DOS-310: refuses a UTR already live anywhere in the distributor and a cheque number already live for the same shop', async () => {
    const utr = `UTR${run}`
    await db.insert(receipts).values(receipt(shopA, 'upi', utr))
    // the same transfer, keyed with spaces and in lower case, for another shop, or as a bank transfer
    for (const again of [
      receipt(shopB, 'upi', ` ${utr.toLowerCase().slice(0, 4)} ${utr.toLowerCase().slice(4)} `),
      receipt(shopA, 'bank_transfer', utr),
    ]) {
      expect(await refusal(db.insert(receipts).values(again))).toContain('QA DOS-310')
    }

    const cheque = `CHQ${run}`
    await db.insert(receipts).values(receipt(shopA, 'cheque', cheque))
    expect(await refusal(db.insert(receipts).values(receipt(shopA, 'cheque', cheque)))).toContain(
      'QA DOS-310',
    )
    // another shop's cheque with the same number is the desk's question, never the database's refusal
    await db.insert(receipts).values(receipt(shopB, 'cheque', cheque))
    // cash with a reference, and a reference-free UPI, are not payment references
    await db.insert(receipts).values(receipt(shopA, 'cash', utr))
    await db.insert(receipts).values(receipt(shopA, 'upi', null))
  })

  it('DOS-310: a reversal mirror carries the reference without refusal, and a cancelled or bounced receipt frees it', async () => {
    const utr = `UTRFREE${run}`
    const original = receipt(shopA, 'upi', utr)
    await db.insert(receipts).values(original)
    // the mirror row an undo writes: negative, cancelled, pointing back
    await db.insert(receipts).values(
      receipt(shopA, 'upi', utr, {
        amountPaise: -10_000,
        status: 'cancelled',
        reversesReceiptId: original.id,
      }),
    )
    await db
      .update(receipts)
      .set({ status: 'cancelled' })
      .where(eq(receipts.id, original.id ?? ''))
    await db.insert(receipts).values(receipt(shopA, 'upi', utr))
  })

  it('DOS-310: never re-judges a pair already standing (imported history), and the release check names it', async () => {
    const utr = `UTRLEGACY${run}`
    const first = receipt(shopA, 'upi', utr)
    await db.insert(receipts).values(first)
    // how history got there: the second row came in cancelled (allowed) and was set live by hand
    const second = receipt(shopB, 'upi', utr, { status: 'cancelled' })
    await db.insert(receipts).values(second)
    await db
      .update(receipts)
      .set({ status: 'collected' })
      .where(eq(receipts.id, second.id ?? ''))
    // confirming one of them at Day-end (a status change) still works: the guard judges new rows only
    await db
      .update(receipts)
      .set({ status: 'deposited', depositedAt: new Date() })
      .where(eq(receipts.id, first.id ?? ''))
    // a third is refused
    expect(await refusal(db.insert(receipts).values(receipt(shopA, 'upi', utr)))).toContain(
      'QA DOS-310',
    )

    const listed = (await receiptReferenceDuplicates(db, tenantId)).filter(
      (d) => d.reference === utr.toUpperCase(),
    )
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      kind: 'transfer',
      failing: true,
      amountPaise: 20_000,
      receiptIds: [first.id, second.id],
    })
    expect((await receiptReferenceFaults(db, tenantId)).join('\n')).toContain(utr.toUpperCase())
    // the cheque number two shops used is listed for information, never as a fault
    const shops = (await receiptReferenceDuplicates(db, tenantId)).filter(
      (d) => d.kind === 'cheque_shops',
    )
    expect(shops.map((d) => d.failing)).toEqual(shops.map(() => false))
    // a third row keyed with spaces and in lower case (history again): the same transfer to both forms of the check
    const spaced = receipt(shopB, 'upi', ` ${utr.slice(0, 5).toLowerCase()} ${utr.slice(5)} `, {
      status: 'cancelled',
    })
    await db.insert(receipts).values(spaced)
    await db
      .update(receipts)
      .set({ status: 'collected' })
      .where(eq(receipts.id, spaced.id ?? ''))
    // the migrated database answers through the function; the inline copy of its body (what the check sends to a
    // database 0079 has not reached) finds exactly the same rows, and the look is read-only either way
    const viaFunction = await receiptReferenceReport(db, tenantId)
    expect(
      viaFunction.duplicates.find((d) => d.reference === utr.toUpperCase())?.receiptIds,
    ).toEqual([first.id, second.id, spaced.id])
    expect(viaFunction.source).toBe('function')
    const inline = await receiptReferenceReport(db, tenantId, 'inline')
    expect(inline.source).toBe('inline')
    expect(inline.duplicates).toEqual(viaFunction.duplicates)
    expect(inline.duplicates.length).toBeGreaterThan(0)
  })

  it('DOS-311: a recovery takes back at most what was written off, and undoing it restores no more (at commit)', async () => {
    const writeOff = uuidv7()
    await db.insert(writeOffs).values({
      id: writeOff,
      tenantId,
      invoiceId: bill,
      retailerId: shopA,
      amountPaise: 10_000,
      reason: 'bad_debt',
      approvedBy: owner,
      idempotencyKey: `wo-${run}`,
    })
    const moneyA = receipt(shopA, 'cash', null)
    const moneyB = receipt(shopB, 'cash', null)
    await db.insert(receipts).values([moneyA, moneyB])
    const recovery = (amount: number, receiptId: string, key: string) =>
      db.transaction(async (tx) => {
        await tx.insert(writeOffs).values({
          id: uuidv7(),
          tenantId,
          invoiceId: bill,
          retailerId: shopA,
          amountPaise: amount,
          reason: 'bad_debt',
          approvedBy: owner,
          idempotencyKey: `${key}-${run}`,
          reversesWriteOffId: writeOff,
          receiptId,
        })
      })

    await recovery(-6_000, moneyA.id ?? '', 'rec-1')
    // ₹40 still stands written off: ₹60 more would take back more than was written off
    expect(await refusal(recovery(-6_000, moneyA.id ?? '', 'rec-2'))).toContain('QA DOS-311')
    // another shop's money never recovers this shop's write-off
    expect(await refusal(recovery(-1_000, moneyB.id ?? '', 'rec-3'))).toContain('QA DOS-311')
    // the undo of the recovery puts ₹60 back, and not a paisa more
    await recovery(6_000, moneyA.id ?? '', 'undo-1')
    expect(await refusal(recovery(1, moneyA.id ?? '', 'undo-2'))).toContain('QA DOS-311')
    const standing = await db.execute(
      sql`select sum(amount_paise)::int as s from write_offs where invoice_id = ${bill}`,
    )
    expect((standing.rows[0] as { s: number }).s).toBe(10_000)

    // an original write-off is positive and names no receipt (0078's shape check)
    expect(
      await refusal(
        db.insert(writeOffs).values({
          id: uuidv7(),
          tenantId,
          invoiceId: bill,
          retailerId: shopA,
          amountPaise: -5,
          reason: 'bad_debt',
          approvedBy: owner,
          idempotencyKey: `wo-neg-${run}`,
        }),
      ),
    ).toContain('write_offs_recovery_shape')
  })
})
