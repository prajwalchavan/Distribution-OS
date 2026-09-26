/**
 * QA DOS-237 — the desk records that a stranded bill came back, and is told where each batch now stands.
 *
 * The figures are INV/9017's (Balaji Wholesale, SO-0890): 166 pieces over four batches, counted back into the
 * godown on day 4, of which the two oil batches were picked for Ekta's order the same morning. The reply of
 * `delivery.deliveries.cameBack` says, per batch, what it needed on the dock and what it could move there; a
 * batch the godown no longer holds free must read as short, with what to do, never as done.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { stagedLines, type StagedLot } from './came-back'

const t = (key: string, params?: Record<string, string | number>): string => {
  const template = (strings as Record<string, string>)[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`))
}

const INV_9017: StagedLot[] = [
  {
    lotId: 'atta',
    description: 'Aashirvaad Atta 5 kg',
    batchNo: 'AN20260905',
    neededPcs: 10,
    stagedPcs: 10,
    onVanPcs: 0,
  },
  {
    lotId: 'oil',
    description: 'Fortune Oil 1 L',
    batchNo: 'AN20260822',
    neededPcs: 23,
    stagedPcs: 0,
    onVanPcs: 0,
  },
  {
    lotId: 'bourbon',
    description: 'Sunbake Bourbon Cream 120 g',
    batchNo: null,
    neededPcs: 120,
    stagedPcs: 100,
    onVanPcs: 20,
  },
]

describe('DOS-237 where a bill that came back now stands', () => {
  it('says what moved to the dock, what the check-in will move, and what is short, in words', () => {
    const lines = stagedLines(INV_9017, t)
    expect(lines.map((line) => line.text)).toEqual([
      'Aashirvaad Atta 5 kg (AN20260905): 10 pc moved to the dock',
      'Fortune Oil 1 L (AN20260822): only 0 of 23 pc are still free in the godown. Put the rest on the dock before loading, or raise a credit note for the bill and bill the shop again.',
      'Sunbake Bourbon Cream 120 g: 100 pc moved to the dock',
      'Sunbake Bourbon Cream 120 g: 20 pc still on the van — the check-in count puts them on the dock',
    ])
    expect(lines.filter((line) => line.short).map((line) => line.key)).toEqual(['oil:short'])
  })

  it('a bill with nothing to stage says nothing', () => {
    expect(stagedLines([], t)).toEqual([])
  })
})
