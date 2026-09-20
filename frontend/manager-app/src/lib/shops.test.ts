/**
 * M14 — the shop panel and the shops register (QA DOS-035, DOS-036, DOS-038).
 *
 * The figures are the dos_qa rows the walk quoted: Patil General Store (R-0018), its overdue balance
 * and its 90-day account.
 */
import { describe, expect, it } from 'vitest'

import { overdueAmount } from './shops'

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
