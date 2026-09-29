import { describe, expect, it } from 'vitest'
import { contract } from '@dos/contracts'
import type { Ctx } from './context.js'
import { COSTS_PAGE, itemCosts } from './world.js'

const variant = (n: number): string =>
  `0199${String(n).padStart(4, '0')}-0000-7000-8000-000000000000`
const lot = (n: number): string => `0198${String(n).padStart(4, '0')}-0000-7000-8000-000000000000`

interface CostRow {
  variantId: string
  lotId: string | null
  purchaseRatePaise: number
}

/** A costs register as the API answers it: newest first, at most `limit` rows, filtered by `variantId`. */
function register(rows: readonly CostRow[]): { ctx: Pick<Ctx, 'read'>; reads: string[] } {
  const reads: string[] = []
  const read = ((proc: unknown, input: { variantId?: string; limit?: number }) => {
    expect(proc).toBe(contract.tenantCatalog.costs)
    reads.push(input.variantId ?? 'all')
    const hit = rows.filter((r) => !input.variantId || r.variantId === input.variantId)
    return Promise.resolve({ items: hit.slice(0, input.limit ?? 200) })
  }) as unknown as Ctx['read']
  return { ctx: { read }, reads }
}

describe("the items' purchase rates (the costs register has no cursor)", () => {
  it('takes the item-level rows of one read while the register is small', async () => {
    const { ctx, reads } = register([
      { variantId: variant(1), lotId: lot(1), purchaseRatePaise: 999 },
      { variantId: variant(1), lotId: null, purchaseRatePaise: 1_000 },
      { variantId: variant(2), lotId: null, purchaseRatePaise: 2_000 },
    ])
    const costs = await itemCosts(ctx, [variant(1), variant(2), variant(3)])
    expect([...costs.entries()]).toEqual([
      [variant(1), 1_000],
      [variant(2), 2_000],
    ])
    expect(reads).toEqual(['all'])
  })

  it('reads an item on its own when months of lot rows push its rate off the first read', async () => {
    // A full first read of lot-level rows (the goods receipts'), and the imported item-level rates behind it.
    const lots: CostRow[] = Array.from({ length: COSTS_PAGE }, (_, n) => ({
      variantId: variant(n % 3),
      lotId: lot(n),
      purchaseRatePaise: 1,
    }))
    const { ctx, reads } = register([
      ...lots,
      { variantId: variant(0), lotId: null, purchaseRatePaise: 500 },
      { variantId: variant(1), lotId: null, purchaseRatePaise: 1_500 },
    ])
    const costs = await itemCosts(ctx, [variant(0), variant(1), variant(2)])
    expect(costs.get(variant(0))).toBe(500)
    expect(costs.get(variant(1))).toBe(1_500)
    expect(costs.has(variant(2))).toBe(false)
    expect(reads).toEqual(['all', variant(0), variant(1), variant(2)])
  })
})
