/**
 * DOS-178 — what D10 may offer on a refusal, and what it may never offer on money.
 *
 * A crew takes ₹2,500 in cash at a door with no signal. The office settles that trip before the phone
 * finds one, so the receipt comes back refused `trip_settled` — correctly: that money now goes over the
 * counter to the cashier (founder answer A, 2026-09-14). Until this, the tray's card carried a
 * destructive "Throw it away", and on a settled trip the outbox row is the ONLY record anywhere that the
 * shop paid. Never-list #13: money a person has entered is never offered for deletion.
 *
 * Pure rules, no React, no kit — the tray screen reads them, and both halves are provable here.
 */
import { describe, expect, it } from 'vitest'

import { trayActions } from './tray'

/** One tray entry, shaped exactly as `engine.needsAttention()` hands it over. */
function item(input: {
  table: string
  code: string
  data?: Record<string, unknown> | null
  handedOverAt?: string | null
  withOp?: boolean
}) {
  const withOp = input.withOp ?? true
  return {
    error: {
      opId: 'op-1',
      table: input.table,
      rowId: 'rc1',
      code: input.code,
      message: 'Trip TRIP-0031 is settled; money is collected while the trip is out',
      createdAt: '2026-09-19T06:30:00.000Z',
      discardedAt: null,
      handedOverAt: input.handedOverAt ?? null,
    },
    op: withOp
      ? {
          seq: 1,
          opId: 'op-1',
          table: input.table,
          rowId: 'rc1',
          op: 'PUT' as const,
          data: input.data === undefined ? CASH : input.data,
          baseUpdatedAt: null,
          idempotencyKey: 'op-1',
          status: 'rejected' as const,
          attempts: 1,
          createdAt: '2026-09-19T06:30:00.000Z',
          sentAt: null,
          ackedAt: null,
          rejectionCode: input.code,
          rejectionMessage: 'Trip TRIP-0031 is settled',
        }
      : null,
    serverRow: null,
    kept: input.table === 'receipts' || input.table === 'collections',
  }
}

const CASH = {
  retailer_id: 'r1',
  mode: 'cash',
  amount_paise: 250000,
  client_receipt_no: '41',
} as const

describe('DOS-178 a refused payment is kept and handed to the cashier', () => {
  it('DOS-178 a refused receipt offers Handed to the cashier and never Throw it away or Send it again', () => {
    const card = trayActions(item({ table: 'receipts', code: 'trip_settled' }))

    expect(card.actions).toEqual(['handOver'])
    expect(card.actions).not.toContain('discard')
    expect(card.actions).not.toContain('retry')
    expect(card.money).toEqual({
      amountPaise: 250000,
      mode: 'cash',
      bookNo: '41',
      instruction: 'tray.handCash',
    })
    expect(card.handedOverAt).toBeNull()
  })

  it('DOS-178 the rule is the TABLE, not the code: any refusal on a money table is kept', () => {
    for (const code of ['trip_settled', 'trip_not_found', 'trip_not_on_road', 'not_permitted'])
      expect(trayActions(item({ table: 'receipts', code })).actions).toEqual(['handOver'])
  })

  it('DOS-178 UPI is already in the account, so the cashier is told rather than handed anything', () => {
    const card = trayActions(
      item({
        table: 'receipts',
        code: 'trip_settled',
        data: { ...CASH, mode: 'upi', reference: 'UPI/9921' },
      }),
    )
    expect(card.money?.instruction).toBe('tray.handUpi')
  })

  it('DOS-178 a payment already handed over offers nothing and says when', () => {
    const card = trayActions(
      item({ table: 'receipts', code: 'trip_settled', handedOverAt: '2026-09-19T07:02:00.000Z' }),
    )
    expect(card.actions).toEqual([])
    expect(card.handedOverAt).toBe('2026-09-19T07:02:00.000Z')
  })

  it('DOS-178 money the phone no longer holds is still never offered for deletion', () => {
    // `pullErrors` brings the office's rejections back after a reinstall: no op, so no figures — and
    // still no "Throw it away", because the table alone decides.
    const card = trayActions(item({ table: 'receipts', code: 'trip_settled', withOp: false }))
    expect(card.actions).toEqual(['handOver'])
    expect(card.money).toBeNull()
  })

  it('DOS-178 a refusal that is not money keeps today’s Send it again and Throw it away', () => {
    const card = trayActions(item({ table: 'deliveries', code: 'stale' }))
    expect(card.actions).toEqual(['retry', 'discard'])
    expect(card.money).toBeNull()
  })

  it('DOS-178 a non-money refusal the phone no longer holds keeps Throw it away alone', () => {
    const card = trayActions(item({ table: 'trip_stops', code: 'stale', withOp: false }))
    expect(card.actions).toEqual(['discard'])
  })
})
