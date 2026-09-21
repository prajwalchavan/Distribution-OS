/**
 * DOS-143: `orders/index.tsx` and `index.tsx` both rendered "Placed {date}" with
 * `longDate((order.submittedAt ?? order.createdAt).slice(0, 10))` — slicing an ISO INSTANT reads its
 * UTC calendar date, not the IST business date every other date in this app is built on
 * (`businessDate()` in `@dos/domain`). An order submitted at 3:05 am IST on 13 Sep carries
 * `createdAt: '2026-09-12T21:35:33Z'`, whose first ten characters are `2026-09-12` — the day before.
 *
 * `shortInstant` already converts an instant through `businessDate()` before formatting; `longInstant`
 * is its missing long-form twin, for exactly the screens that need the year.
 */
import { describe, expect, it } from 'vitest'

import { longInstant } from './dates'

describe('DOS-143: longInstant reads the IST business date, never the UTC calendar date', () => {
  it('an order placed at 3:05 am IST on 13 Sep 2026 (created 21:35:33Z the day before) reads 13 Sep 2026', () => {
    expect(longInstant('2026-09-12T21:35:33Z')).toBe('13 Sep 2026')
  })

  it('an instant well inside the IST day reads the same calendar date', () => {
    expect(longInstant('2026-09-13T09:00:00Z')).toBe('13 Sep 2026')
  })

  it('null and undefined render as the em dash, like every other date helper here', () => {
    expect(longInstant(null)).toBe('—')
    expect(longInstant(undefined)).toBe('—')
  })
})
