/**
 * The order being typed in a doorway: held on the phone, restored after a crash, sent when it can be.
 *
 * UX-01 S4 asks for a draft that persists within 500 ms of every keystroke and restores to where the
 * rep was. So the lines live in React state, are written to the platform store (Keychain /
 * EncryptedSharedPreferences on a phone, `localStorage` in a browser) on a 300 ms trailing timer, and
 * are read back on mount — one key per shop, so a rep can start an order in one doorway and finish it
 * in the next without losing either.
 *
 * ONE KEY PER REP AND SHOP, NOT PER SHOP (DOS-167). The key was `dos.sales.draft.<retailerId>`, so a
 * colleague at the same distributor who opened that shop on the same phone was handed the previous
 * rep's typed lines, and sign-out left every draft behind. It is `dos.sales.draft.<userId>.<retailerId>`
 * now, read and written only while somebody is signed in, and each rep keeps an index of the shops they
 * hold a draft for (`dos.sales.drafts.<userId>`), which is how a sign-out that leaves nothing unsent
 * forgets every draft of that rep (`forgetDraftsOf`) and nothing of anyone else's.
 *
 * TWO WAYS OUT, AND THE DIFFERENCE IS NOT COSMETIC (ADR 0007, `orders.sync.ts`):
 *
 * - **With signal** the order goes through `orders.create` + `orders.submit`. The server prices it,
 *   gives it its SO number, runs the credit check and raises whatever approvals the shop's terms
 *   need. That is a submitted order.
 * - **Without signal** the device may upload a DRAFT and nothing more — the sync handler refuses any
 *   state past `draft` in so many words, because a number, an approval gate and a stock reservation
 *   are the server's to decide. So the queue carries the header and its lines, they land as a draft
 *   when the phone finds signal, and the rep submits it from My orders. The screen says exactly that
 *   and never calls a queued order "placed".
 */
import { useSession } from '@dos/api-client/react'
import { uuidv7 } from '@dos/domain'
import { storage } from '@dos/ui/platform'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { DraftLine } from './pricing'

export interface DraftOrder {
  /** The order's own client-generated UUIDv7, fixed the moment the first line is added. */
  id: string
  retailerId: string
  lines: DraftLine[]
  note: string
  expectedDeliveryDate: string | null
}

const KEY_PREFIX = 'dos.sales.draft.'
const INDEX_PREFIX = 'dos.sales.drafts.'

function draftKey(userId: string, retailerId: string): string {
  return `${KEY_PREFIX}${userId}.${retailerId}`
}

function indexKey(userId: string): string {
  return `${INDEX_PREFIX}${userId}`
}

function emptyDraft(retailerId: string): DraftOrder {
  return { id: uuidv7(), retailerId, lines: [], note: '', expectedDeliveryDate: null }
}

function parse(raw: string | null, retailerId: string): DraftOrder | null {
  if (raw === null) return null
  try {
    const held = JSON.parse(raw) as Partial<DraftOrder>
    if (typeof held.id !== 'string' || !Array.isArray(held.lines)) return null
    return {
      id: held.id,
      retailerId,
      lines: held.lines.filter(
        (line): line is DraftLine =>
          typeof line?.id === 'string' &&
          typeof line.variantId === 'string' &&
          Number.isInteger(line.qtyPcs),
      ),
      note: typeof held.note === 'string' ? held.note : '',
      expectedDeliveryDate:
        typeof held.expectedDeliveryDate === 'string' ? held.expectedDeliveryDate : null,
    }
  } catch {
    return null
  }
}

/** The shops this rep holds a draft for. An unreadable index names none. */
async function readIndex(userId: string): Promise<string[]> {
  const raw = await storage.getItem(indexKey(userId))
  if (raw === null) return []
  try {
    const held: unknown = JSON.parse(raw)
    return Array.isArray(held)
      ? held.filter((retailerId): retailerId is string => typeof retailerId === 'string')
      : []
  } catch {
    return []
  }
}

async function writeIndex(userId: string, retailerIds: readonly string[]): Promise<void> {
  if (retailerIds.length === 0) await storage.removeItem(indexKey(userId))
  else await storage.setItem(indexKey(userId), JSON.stringify(retailerIds))
}

/** The trailing save: this rep's draft for its shop, and that shop in this rep's index. */
export async function saveDraft(userId: string, draft: DraftOrder): Promise<void> {
  await storage.setItem(draftKey(userId, draft.retailerId), JSON.stringify(draft))
  const held = await readIndex(userId)
  if (!held.includes(draft.retailerId)) await writeIndex(userId, [...held, draft.retailerId])
}

export interface UseDraft {
  draft: DraftOrder
  /** False until the stored draft (if any) has been read back — the screen must not save over it. */
  restored: boolean
  /** Set a line's quantity in pieces. Zero removes the line. */
  setQty: (
    variantId: string,
    qtyPcs: number,
    enteredUnit: 'piece' | 'case',
    caseSize: number,
  ) => void
  setNote: (note: string) => void
  setExpectedDeliveryDate: (date: string | null) => void
  /** Replace every line — "repeat last order" and a confirmed AI draft both land here. */
  replaceLines: (lines: readonly DraftLine[]) => void
  /** Throw the draft away and start a new order id. */
  clear: () => void
}

export function useOrderDraft(retailerId: string): UseDraft {
  const userId = useSession().session?.user.id ?? null
  const [draft, setDraft] = useState<DraftOrder>(() => emptyDraft(retailerId))
  const [restored, setRestored] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let live = true
    setRestored(false)
    // Nobody signed in: nothing is read, and while `restored` stays false nothing is written either.
    if (userId !== null)
      void storage.getItem(draftKey(userId, retailerId)).then((raw) => {
        if (!live) return
        setDraft(parse(raw, retailerId) ?? emptyDraft(retailerId))
        setRestored(true)
      })
    return () => {
      live = false
    }
  }, [userId, retailerId])

  /*
   * A trailing 300 ms save. Not on every keystroke: a stepper held down fires a dozen times a second
   * and `expo-secure-store` is a Keychain write each time — on the reference phone that is the
   * difference between a stepper that steps and one that stutters.
   */
  useEffect(() => {
    if (!restored || userId === null) return
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void saveDraft(userId, draft)
    }, 300)
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [draft, restored, userId])

  const setQty = useCallback(
    (variantId: string, qtyPcs: number, enteredUnit: 'piece' | 'case', caseSize: number) => {
      setDraft((held) => {
        const lines = held.lines.filter((line) => line.variantId !== variantId)
        if (qtyPcs > 0) {
          const existing = held.lines.find((line) => line.variantId === variantId)
          lines.push({
            id: existing?.id ?? uuidv7(),
            variantId,
            qtyPcs,
            /*
             * What the rep TYPED, kept as typed (docs/17 A3): a line entered as 2 cases stays "2 cs"
             * on the bill even if the pack size changes tomorrow. Pieces that happen to divide into
             * whole cases are still pieces — the unit is the rep's choice, not arithmetic.
             */
            enteredQty:
              enteredUnit === 'case' ? Math.round(qtyPcs / Math.max(1, caseSize)) : qtyPcs,
            enteredUnit,
          })
        }
        return { ...held, lines }
      })
    },
    [],
  )

  const setNote = useCallback((note: string) => {
    setDraft((held) => ({ ...held, note }))
  }, [])

  const setExpectedDeliveryDate = useCallback((date: string | null) => {
    setDraft((held) => ({ ...held, expectedDeliveryDate: date }))
  }, [])

  const replaceLines = useCallback((lines: readonly DraftLine[]) => {
    setDraft((held) => ({ ...held, lines: [...lines] }))
  }, [])

  const clear = useCallback(() => {
    const fresh = emptyDraft(retailerId)
    setDraft(fresh)
    if (userId !== null) void forgetDraft(userId, retailerId)
  }, [retailerId, userId])

  return { draft, restored, setQty, setNote, setExpectedDeliveryDate, replaceLines, clear }
}

/** Drop one rep's stored draft for a shop without mounting the hook — used after a successful submit. */
export async function forgetDraft(userId: string, retailerId: string): Promise<void> {
  await storage.removeItem(draftKey(userId, retailerId))
  const held = await readIndex(userId)
  if (held.includes(retailerId))
    await writeIndex(
      userId,
      held.filter((id) => id !== retailerId),
    )
}

/**
 * Every draft this rep holds on this phone, and the index of them (DOS-167). The sign-out that leaves
 * nothing unsent calls it; a colleague's drafts are under their own keys and are never touched.
 */
export async function forgetDraftsOf(userId: string): Promise<void> {
  for (const retailerId of await readIndex(userId))
    await storage.removeItem(draftKey(userId, retailerId))
  await storage.removeItem(indexKey(userId))
}
