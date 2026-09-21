/**
 * M14 — the shop panel and the shops register (QA DOS-035, DOS-036, DOS-038).
 *
 * The figures are the dos_qa rows the walk quoted: Patil General Store (R-0018), its overdue balance
 * and its 90-day account.
 */
import type { RetailerLedgerRow } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import { SHOP_COLUMNS, overdueAmount, phoneRow, statementRows } from './shops'

describe('DOS-035 — the shop panel prints the overdue amount as money', () => {
  it('formats the paise figure like the line above it, not as raw paise', () => {
    // Patil General Store: outstanding_paise 6042250 in the database, "₹60,422.50 overdue" on screen.
    expect(overdueAmount(6_042_250)).toBe('₹60,422.50')
  })

  it('reads nothing owed as ₹0.00', () => {
    expect(overdueAmount(0)).toBe('₹0.00')
    expect(overdueAmount(undefined)).toBe('₹0.00')
  })
})

/**
 * R-0018's account as the walk read it: the shop's first bill OPEN/0005 (21 May, ₹9,182.00) falls
 * BEFORE the ninety-day window, so it is the opening balance; the four documents inside the window
 * carry their own amounts and the balance they leave behind.
 */
function ledgerRow(
  refNo: string,
  date: string,
  amountPaise: number,
  balancePaise: number,
): RetailerLedgerRow {
  const credit = amountPaise < 0
  return {
    date,
    kind: credit ? 'receipt' : 'invoice',
    refId: `ref-${refNo}`,
    refNo,
    narration: null,
    debitPaise: credit ? 0 : amountPaise,
    creditPaise: credit ? -amountPaise : 0,
    balancePaise,
  }
}

const ACCOUNT = {
  openingPaise: 918_200,
  items: [
    ledgerRow('INV/0037', '2026-06-19', 801_500, 1_719_700),
    ledgerRow('INV/0105', '2026-06-26', 190_900, 1_910_600),
    ledgerRow('INV/0175', '2026-07-03', 368_300, 2_278_900),
    ledgerRow('RCPT-0040', '2026-07-06', -110_700, 2_168_200),
  ],
} as const

describe('DOS-036 — the statement of account opens with the carried balance and states each document', () => {
  it('puts the opening balance first, dated the day the window starts', () => {
    const rows = statementRows(ACCOUNT, { from: '2026-05-22', limit: 12 })
    expect(rows[0]).toMatchObject({
      kind: 'opening',
      refNo: null,
      date: '2026-05-22',
      debitPaise: null,
      creditPaise: null,
      balancePaise: 918_200,
    })
  })

  it('gives every document its own amount beside the running balance', () => {
    const rows = statementRows(ACCOUNT, { from: '2026-05-22', limit: 12 })
    expect(rows.find((row) => row.refNo === 'INV/0175')).toMatchObject({
      debitPaise: 368_300,
      creditPaise: null,
      balancePaise: 2_278_900,
    })
    expect(rows.find((row) => row.refNo === 'RCPT-0040')).toMatchObject({
      debitPaise: null,
      creditPaise: 110_700,
      balancePaise: 2_168_200,
    })
  })

  it('caps the documents shown and never drops the opening row', () => {
    const rows = statementRows(ACCOUNT, { from: '2026-05-22', limit: 2 })
    expect(rows.map((row) => row.refNo)).toEqual([null, 'INV/0037', 'INV/0105'])
  })
})

describe('DOS-038 — on a phone a shop row carries the shop name', () => {
  it('names the shop on the line, instead of only its code', () => {
    expect(phoneRow(SHOP_COLUMNS).primary).toBe('name')
  })

  it('keeps the credit policy beside the name and leaves the limit to the panel', () => {
    // "R-0046 · Blocked · 0.00" told a manager nothing: a code, a policy and a bare credit limit.
    expect(phoneRow(SHOP_COLUMNS).secondary).toBe('mode')
    expect(phoneRow(SHOP_COLUMNS).trailing).toBeUndefined()
  })

  it('still lists the code and the limit on a desk', () => {
    expect(SHOP_COLUMNS.map((column) => column.key)).toEqual([
      'code',
      'name',
      'beat',
      'tier',
      'terms',
      'limit',
      'mode',
      'phone',
    ])
  })
})
