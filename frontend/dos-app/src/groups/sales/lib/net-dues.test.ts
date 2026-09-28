import { describe, expect, it } from 'vitest'

import type { LocalOutstanding } from './local'
import { netDuesOf } from './net-dues'

const ROW: LocalOutstanding = {
  retailer_id: 'r-0047',
  outstanding_paise: 86_700,
  overdue_paise: 86_700,
  unallocated_credit_paise: 500_000,
  open_bills: 1,
  oldest_due_date: '2026-09-08',
  oldest_invoice_date: '2026-09-01',
  last_receipt_at: null,
  last_receipt_paise: null,
  bucket_0_7_paise: 0,
  bucket_8_15_paise: 0,
  bucket_16_30_paise: 86_700,
  bucket_31_60_paise: 0,
  bucket_61_90_paise: 0,
  bucket_90_plus_paise: 0,
  as_of: '2026-09-28',
}

describe('DOS-312 the rep reads dues net of the money on account', () => {
  it('a shop in credit owes nothing and is late for nothing on the card', () => {
    expect(netDuesOf(ROW)).toEqual({ duesPaise: 0, overduePaise: 0, buckets: [0, 0, 0, 0, 0, 0] })
  })

  it('without money on account the card reads the bills as they are', () => {
    const net = netDuesOf({ ...ROW, unallocated_credit_paise: 0 })
    expect(net).toEqual({
      duesPaise: 86_700,
      overduePaise: 86_700,
      buckets: [0, 0, 86_700, 0, 0, 0],
    })
  })

  it('no row yet reads as nothing owed', () => {
    expect(netDuesOf(null).duesPaise).toBe(0)
  })
})
