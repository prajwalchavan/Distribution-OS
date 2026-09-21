/**
 * DOS-167 — the order a rep is typing in a doorway belongs to that rep, not to the phone.
 *
 * The draft used to be stored under `dos.sales.draft.<retailerId>` alone, so a colleague at the same
 * distributor who opened that shop on the same phone was handed the previous rep's typed lines, and
 * sign-out left every draft behind (S-98 V1 saw the key survive it). A draft is now keyed by the
 * signed-in user, each user keeps an index of the shops they hold a draft for, and a sign-out that
 * leaves nothing unsent forgets every draft of that user and nothing of anyone else's.
 *
 * This runs through the platform storage itself: in Vitest there is no `window`, so `@dos/ui/platform`
 * keeps the keys in its in-memory fallback — the same interface a phone's secure store answers.
 */
import { storage } from '@dos/ui/platform'
import { describe, expect, it } from 'vitest'

import { forgetDraft, forgetDraftsOf, saveDraft, type DraftOrder } from './draft'

function draftAt(retailerId: string, qtyPcs: number): DraftOrder {
  return {
    id: `order-${retailerId}-${String(qtyPcs)}`,
    retailerId,
    lines: [
      {
        id: `line-${retailerId}`,
        variantId: 'variant-neem-soap',
        qtyPcs,
        enteredQty: qtyPcs,
        enteredUnit: 'piece',
      },
    ],
    note: '',
    expectedDeliveryDate: null,
  }
}

async function held(key: string): Promise<unknown> {
  const raw = await storage.getItem(key)
  return raw === null ? null : (JSON.parse(raw) as unknown)
}

describe('DOS-167 the order draft on a shared phone', () => {
  it('DOS-167 a draft is keyed by the signed-in user and forgetDraftsOf removes every draft of that user and nothing of another', async () => {
    // Rahul types orders at two shops; Amit, at the same distributor, types one at the first of them.
    await saveDraft('rahul', draftAt('r1', 12))
    await saveDraft('rahul', draftAt('r2', 24))
    await saveDraft('amit', draftAt('r1', 6))

    // Every key names the rep. Nothing is held under the shop alone, where the other rep would find it.
    expect(await held('dos.sales.draft.rahul.r1')).toMatchObject({ id: 'order-r1-12' })
    expect(await held('dos.sales.draft.rahul.r2')).toMatchObject({ id: 'order-r2-24' })
    expect(await held('dos.sales.draft.amit.r1')).toMatchObject({ id: 'order-r1-6' })
    expect(await storage.getItem('dos.sales.draft.r1')).toBeNull()
    expect(await storage.getItem('dos.sales.draft.r2')).toBeNull()
    // Each rep's index lists their own shops once, however many times the trailing save ran.
    await saveDraft('rahul', draftAt('r1', 13))
    expect(await held('dos.sales.drafts.rahul')).toEqual(['r1', 'r2'])
    expect(await held('dos.sales.drafts.amit')).toEqual(['r1'])

    // Rahul signs out with nothing unsent: every draft of his goes, and none of Amit's.
    await forgetDraftsOf('rahul')
    expect(await storage.getItem('dos.sales.draft.rahul.r1')).toBeNull()
    expect(await storage.getItem('dos.sales.draft.rahul.r2')).toBeNull()
    expect(await storage.getItem('dos.sales.drafts.rahul')).toBeNull()
    expect(await held('dos.sales.draft.amit.r1')).toMatchObject({ id: 'order-r1-6' })
    expect(await held('dos.sales.drafts.amit')).toEqual(['r1'])

    // Amit's order goes through: that one draft is forgotten and his index no longer names the shop.
    await forgetDraft('amit', 'r1')
    expect(await storage.getItem('dos.sales.draft.amit.r1')).toBeNull()
    expect((await held('dos.sales.drafts.amit')) ?? []).toEqual([])
  })
})
