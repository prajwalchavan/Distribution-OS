/**
 * QA DOS-312 (architect ruling 3, 2026-09-28) — WHAT THE SHOP OWES NET OF THE MONEY IT HAS PAID.
 *
 * The phone holds the shop's dues row exactly as the server stores it: GROSS bills, and beside them the
 * money on account (`unallocated_credit_paise`) that no bill has claimed yet. What the rep reads on the
 * shop card and the shops list is the dues after that money has paid the shop's OLDEST bills first, so a
 * shop in credit is never shown as overdue for money it has already paid. The rule is `@dos/domain`'s
 * `netOfOnAccountRollup`, the one the server's registers use — this only maps the device row onto it.
 */
import { netOfOnAccountRollup, type NetOfOnAccount } from '@dos/domain'

import type { LocalOutstanding } from './local'

export function netDuesOf(row: LocalOutstanding | null | undefined): NetOfOnAccount {
  return netOfOnAccountRollup({
    outstandingPaise: row?.outstanding_paise ?? 0,
    overduePaise: row?.overdue_paise ?? 0,
    unallocatedCreditPaise: row?.unallocated_credit_paise ?? 0,
    buckets: [
      row?.bucket_0_7_paise ?? 0,
      row?.bucket_8_15_paise ?? 0,
      row?.bucket_16_30_paise ?? 0,
      row?.bucket_31_60_paise ?? 0,
      row?.bucket_61_90_paise ?? 0,
      row?.bucket_90_plus_paise ?? 0,
    ],
  })
}
