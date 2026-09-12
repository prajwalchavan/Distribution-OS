import { describe, expect, it } from 'vitest'
import { isBankableReceiptMode, receiptMayBeDeposited, receiptMayBounce } from './receipts.js'

describe('receiptMayBeDeposited', () => {
  it('DOS-034: only cash and cheques still collected go to the bank — UPI, bank transfer, adjustment and credit_note receipts are never cash in hand', () => {
    // the mode half of the rule `depositReceipts` applies to every row of a batch
    expect(isBankableReceiptMode('cash')).toBe(true)
    expect(isBankableReceiptMode('cheque')).toBe(true)
    // `credit_note`: two legacy rows in the pilot tenant carry a mode outside ReceiptModeSchema
    for (const mode of ['upi', 'bank_transfer', 'adjustment', 'credit_note', '']) {
      expect(isBankableReceiptMode(mode), mode).toBe(false)
    }

    const cases: readonly (readonly [mode: string, status: string, expected: boolean])[] = [
      // what the desk carries to the bank
      ['cash', 'collected', true],
      ['cheque', 'collected', true],
      // RCPT-0699 UPI ₹71,780.10 and RCPT-0697 bank transfer ₹28,759.08: already in the bank
      ['upi', 'collected', false],
      ['bank_transfer', 'collected', false],
      ['adjustment', 'collected', false],
      ['credit_note', 'collected', false],
      // money that has left the drawer, one way or another
      ['cash', 'deposited', false],
      ['cheque', 'deposited', false],
      ['cheque', 'bounced', false],
      ['cash', 'cancelled', false],
      ['cheque', 'cancelled', false],
      ['upi', 'deposited', false],
    ]
    for (const [mode, status, expected] of cases) {
      expect(receiptMayBeDeposited({ mode, status }), `${mode} / ${status}`).toBe(expected)
    }
  })
})

describe('receiptMayBounce', () => {
  it('DOS-034: a cheque in hand or already banked can be marked bounced; cash, UPI and a bounced or cancelled cheque cannot', () => {
    const cases: readonly (readonly [mode: string, status: string, expected: boolean])[] = [
      // RCPT-CHQ-0001, Bank of Maharashtra ₹29,952.00, still in the drawer
      ['cheque', 'collected', true],
      // a banked cheque the bank returns: the reversal credits BANK
      ['cheque', 'deposited', true],
      // already undone
      ['cheque', 'bounced', false],
      ['cheque', 'cancelled', false],
      // only a cheque bounces
      ['cash', 'collected', false],
      ['cash', 'deposited', false],
      ['upi', 'collected', false],
      ['bank_transfer', 'collected', false],
      ['adjustment', 'collected', false],
      ['credit_note', 'collected', false],
    ]
    for (const [mode, status, expected] of cases) {
      expect(receiptMayBounce({ mode, status }), `${mode} / ${status}`).toBe(expected)
    }
  })
})
