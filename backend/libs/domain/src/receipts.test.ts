import { describe, expect, it } from 'vitest'
import {
  invoiceStateShown,
  isBankableReceiptMode,
  isConfirmableReceiptMode,
  normaliseReference,
  receiptMayBeConfirmed,
  receiptMayBeDeposited,
  receiptMayBounce,
} from './receipts.js'

describe('receiptMayBeConfirmed (DOS-256)', () => {
  it('a UPI receipt still collected is confirmed at Day-end; nothing else is, and a confirmed one is not again', () => {
    expect(isConfirmableReceiptMode('upi')).toBe(true)
    for (const mode of ['cash', 'cheque', 'bank_transfer', 'adjustment', 'credit_note', '']) {
      expect(isConfirmableReceiptMode(mode), mode).toBe(false)
    }
    expect(receiptMayBeConfirmed({ mode: 'upi', status: 'collected' })).toBe(true)
    expect(receiptMayBeConfirmed({ mode: 'upi', status: 'deposited' })).toBe(false)
    expect(receiptMayBeConfirmed({ mode: 'upi', status: 'cancelled' })).toBe(false)
    expect(receiptMayBeConfirmed({ mode: 'cash', status: 'collected' })).toBe(false)
  })
})

describe('normaliseReference (DOS-310)', () => {
  it('compares a reference trimmed, without inner spaces and without regard to case', () => {
    expect(normaliseReference(' utr 1790 5645 ')).toBe('UTR17905645')
    expect(normaliseReference('Chq\t088789')).toBe('CHQ088789')
    expect(normaliseReference('UTR17905645')).toBe(normaliseReference('utr17905645'))
  })
})

describe('invoiceStateShown (DOS-320)', () => {
  it('a bill closed only by credit notes reads credited; by money, or money and a note, paid', () => {
    // CN/9010 closed INV/9030, refused at the door and never paid
    expect(invoiceStateShown({ state: 'paid', paidPaise: 0, creditedPaise: 59_500 })).toBe(
      'closed_by_credit_note',
    )
    expect(invoiceStateShown({ state: 'paid', paidPaise: 59_500, creditedPaise: 0 })).toBe('paid')
    expect(invoiceStateShown({ state: 'paid', paidPaise: 40_000, creditedPaise: 19_500 })).toBe(
      'paid',
    )
    // a server that does not say what closed the bill keeps the state it sent
    expect(invoiceStateShown({ state: 'paid' })).toBe('paid')
    expect(invoiceStateShown({ state: 'partially_paid', paidPaise: 0, creditedPaise: 100 })).toBe(
      'partially_paid',
    )
  })
})

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
