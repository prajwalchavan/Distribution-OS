import { describe, expect, it } from 'vitest'
import {
  BulkAssignTargetsInput,
  isMoneyMetric,
  MAX_BULK_ASSIGN_USERS,
  MAX_PAYOUT_SLABS,
  MAX_TARGET_PERIOD_DAYS,
  MONEY_METRICS,
  PayoutSlabSchema,
  StatementsListInput,
  TargetsListInput,
  TargetWhatIfInput,
  UpsertTargetInput,
} from './incentives.js'

const KEY = '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a10'
const TARGET_ID = '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a11'
const USER_ID = '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a12'
const BRAND_ID = '0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2a13'

/** 70–90% → 1%, 90–100% → 2%, 100%+ → 4% of the target, all in basis points (100% = 10000). */
const bpsSlabs = [
  { fromPct: 7000, toPct: 9000, payoutBps: 100 },
  { fromPct: 9000, toPct: 10_000, payoutBps: 200 },
  { fromPct: 10_000, payoutBps: 400 },
]
const flatSlabs = [
  { fromPct: 8000, toPct: 10_000, flatPaise: 250_000 },
  { fromPct: 10_000, flatPaise: 500_000 },
]

const target = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: KEY,
  id: TARGET_ID,
  userId: USER_ID,
  metric: 'value',
  periodFrom: '2026-09-01',
  periodTo: '2026-09-30',
  targetValue: 50_000_000,
  payoutRule: bpsSlabs,
  ...over,
})

describe('payout slabs', () => {
  it('takes exactly one reward per slab', () => {
    expect(PayoutSlabSchema.safeParse({ fromPct: 0, payoutBps: 100 }).success).toBe(true)
    expect(PayoutSlabSchema.safeParse({ fromPct: 0, flatPaise: 0 }).success).toBe(true)
    expect(PayoutSlabSchema.safeParse({ fromPct: 0 }).success).toBe(false)
    expect(PayoutSlabSchema.safeParse({ fromPct: 0, payoutBps: 100, flatPaise: 100 }).success).toBe(
      false,
    )
  })

  it('refuses an empty band and allows an open-ended top tier past 100%', () => {
    expect(PayoutSlabSchema.safeParse({ fromPct: 9000, toPct: 9000, flatPaise: 1 }).success).toBe(
      false,
    )
    expect(PayoutSlabSchema.safeParse({ fromPct: 9000, toPct: 8000, flatPaise: 1 }).success).toBe(
      false,
    )
    // Achievement is uncapped, so a slab boundary above 10000 bps (100%) is normal.
    expect(PayoutSlabSchema.safeParse({ fromPct: 15_000, flatPaise: 1 }).success).toBe(true)
    // `payoutBps` is a SHARE of the target, so it stays a true 0..10000.
    expect(PayoutSlabSchema.safeParse({ fromPct: 0, payoutBps: 10_001 }).success).toBe(false)
  })

  it('caps the table at ten slabs', () => {
    expect(MAX_PAYOUT_SLABS).toBe(10)
    const many = Array.from({ length: 11 }, (_, i) => ({ fromPct: i * 100, flatPaise: 1 }))
    expect(UpsertTargetInput.safeParse(target({ payoutRule: many })).success).toBe(false)
    expect(UpsertTargetInput.safeParse(target({ payoutRule: [] })).success).toBe(false)
  })
})

describe('metric typing', () => {
  it('treats value and collections as paise and every other metric as a count', () => {
    expect(MONEY_METRICS).toEqual(['value', 'collections'])
    expect(isMoneyMetric('value')).toBe(true)
    expect(isMoneyMetric('collections')).toBe(true)
    for (const metric of ['pieces', 'lines', 'outlets', 'visits'] as const) {
      expect(isMoneyMetric(metric), metric).toBe(false)
    }
  })

  it('allows payoutBps only on a value target', () => {
    expect(UpsertTargetInput.safeParse(target()).success).toBe(true)
    for (const metric of ['pieces', 'lines', 'outlets', 'visits', 'collections'] as const) {
      const bps = UpsertTargetInput.safeParse(target({ metric, payoutRule: bpsSlabs }))
      expect(bps.success, metric).toBe(false)
      expect(JSON.stringify(bps.error?.issues), metric).toContain('flatPaise')
      expect(
        UpsertTargetInput.safeParse(target({ metric, payoutRule: flatSlabs })).success,
        metric,
      ).toBe(true)
    }
  })

  it('refuses a brand scope on a visits or collections target', () => {
    expect(UpsertTargetInput.safeParse(target({ brandId: BRAND_ID })).success).toBe(true)
    for (const metric of ['visits', 'collections'] as const) {
      const scoped = UpsertTargetInput.safeParse(
        target({ metric, brandId: BRAND_ID, payoutRule: flatSlabs }),
      )
      expect(scoped.success, metric).toBe(false)
      expect(JSON.stringify(scoped.error?.issues), metric).toContain('brandId')
      // The same metric without a brand is fine.
      expect(
        UpsertTargetInput.safeParse(target({ metric, payoutRule: flatSlabs })).success,
        metric,
      ).toBe(true)
    }
  })
})

describe('target periods', () => {
  it('needs a real period no longer than a year', () => {
    expect(UpsertTargetInput.safeParse(target({ periodTo: '2026-09-01' })).success).toBe(true)
    const backwards = UpsertTargetInput.safeParse(
      target({ periodFrom: '2026-09-30', periodTo: '2026-09-01' }),
    )
    expect(backwards.success).toBe(false)
    expect(JSON.stringify(backwards.error?.issues)).toContain('periodTo is before periodFrom')
    expect(MAX_TARGET_PERIOD_DAYS).toBe(366)
    // 2026-01-01 .. 2026-12-31 is 365 days inclusive; one more day is over the cap.
    expect(
      UpsertTargetInput.safeParse(target({ periodFrom: '2026-01-01', periodTo: '2026-12-31' }))
        .success,
    ).toBe(true)
    const wide = UpsertTargetInput.safeParse(
      target({ periodFrom: '2026-01-01', periodTo: '2027-01-02' }),
    )
    expect(wide.success).toBe(false)
    expect(JSON.stringify(wide.error?.issues)).toContain('period_too_long')
  })

  it('needs a target value above zero, so achievedPct never divides by zero', () => {
    expect(UpsertTargetInput.safeParse(target({ targetValue: 0 })).success).toBe(false)
    expect(UpsertTargetInput.safeParse(target({ targetValue: -1 })).success).toBe(false)
    expect(UpsertTargetInput.safeParse(target({ targetValue: 1.5 })).success).toBe(false)
  })
})

describe('bulk assign', () => {
  it('carries a client-generated id per created row, capped at fifty', () => {
    expect(MAX_BULK_ASSIGN_USERS).toBe(50)
    const { id: _id, userId: _userId, ...rest } = target()
    const assignment = (n: number) => ({
      id: `0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2b${n.toString(16).padStart(2, '0')}`,
      userId: `0192b8a0-3f2e-7c1d-9a7b-6e5d4c3b2c${n.toString(16).padStart(2, '0')}`,
    })
    expect(
      BulkAssignTargetsInput.safeParse({ ...rest, assignments: [assignment(1), assignment(2)] })
        .success,
    ).toBe(true)
    expect(BulkAssignTargetsInput.safeParse({ ...rest, assignments: [] }).success).toBe(false)
    expect(
      BulkAssignTargetsInput.safeParse({
        ...rest,
        assignments: Array.from({ length: 51 }, (_, i) => assignment(i)),
      }).success,
    ).toBe(false)
    // A bare userId without its row id is refused: the retry must land on the same rows.
    expect(
      BulkAssignTargetsInput.safeParse({ ...rest, assignments: [{ userId: USER_ID }] }).success,
    ).toBe(false)
    // The shared rules still apply to the whole batch.
    expect(
      BulkAssignTargetsInput.safeParse({
        ...rest,
        metric: 'visits',
        brandId: BRAND_ID,
        payoutRule: flatSlabs,
        assignments: [assignment(1)],
      }).success,
    ).toBe(false)
  })
})

describe('what-if', () => {
  it('needs a hypothetical achievement or a target to read one from, and writes nothing', () => {
    const base = { metric: 'value' as const, targetValue: 50_000_000, payoutRule: bpsSlabs }
    expect(TargetWhatIfInput.safeParse({ ...base, achievedValue: 40_000_000 }).success).toBe(true)
    expect(TargetWhatIfInput.safeParse({ ...base, targetId: TARGET_ID }).success).toBe(true)
    expect(TargetWhatIfInput.safeParse(base).success).toBe(false)
    // Pure computation: no idempotency key is required, unlike every mutation on this contract.
    expect(TargetWhatIfInput.safeParse({ ...base, achievedValue: 0 }).data?.achievedValue).toBe(0)
    // The payoutBps rule is the same one `upsert` applies.
    expect(
      TargetWhatIfInput.safeParse({ ...base, metric: 'lines', achievedValue: 10 }).success,
    ).toBe(false)
  })
})

describe('list defaults', () => {
  it('pages on a cursor, caps at 200 and defaults to the targets running today', () => {
    const targets = TargetsListInput.parse({})
    expect(targets.limit).toBe(50)
    expect(targets.activeOnly).toBe(true)
    expect(TargetsListInput.safeParse({ limit: 201 }).success).toBe(false)
    // Query strings arrive as strings.
    expect(TargetsListInput.parse({ limit: '25', activeOnly: 'false' })).toMatchObject({
      limit: 25,
      activeOnly: false,
    })
    const statements = StatementsListInput.parse({})
    expect(statements.limit).toBe(50)
    expect(statements.approvedOnly).toBeUndefined()
    expect(StatementsListInput.safeParse({ limit: 0 }).success).toBe(false)
  })
})
