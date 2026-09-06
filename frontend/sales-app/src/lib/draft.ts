/**
 * The order being typed in a doorway: held on the phone, restored after a crash, sent when it can be.
 *
 * UX-01 S4 asks for a draft that persists within 500 ms of every keystroke and restores to where the
 * rep was. So the lines live in React state, are written to the platform store (Keychain /
 * EncryptedSharedPreferences on a phone, `localStorage` in a browser) on a 300 ms trailing timer, and
 * are read back on mount — one key per shop, so a rep can start an order in one doorway and finish it
 * in the next without losing either.
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
  const [draft, setDraft] = useState<DraftOrder>(() => emptyDraft(retailerId))
  const [restored, setRestored] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let live = true
    setRestored(false)
    void storage.getItem(`${KEY_PREFIX}${retailerId}`).then((raw) => {
      if (!live) return
      setDraft(parse(raw, retailerId) ?? emptyDraft(retailerId))
      setRestored(true)
    })
    return () => {
      live = false
    }
  }, [retailerId])

  /*
   * A trailing 300 ms save. Not on every keystroke: a stepper held down fires a dozen times a second
   * and `expo-secure-store` is a Keychain write each time — on the reference phone that is the
   * difference between a stepper that steps and one that stutters.
   */
  useEffect(() => {
    if (!restored) return
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void storage.setItem(`${KEY_PREFIX}${retailerId}`, JSON.stringify(draft))
    }, 300)
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [draft, restored, retailerId])

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
    void storage.removeItem(`${KEY_PREFIX}${retailerId}`)
  }, [retailerId])

  return { draft, restored, setQty, setNote, setExpectedDeliveryDate, replaceLines, clear }
}

/** Drop a shop's stored draft without mounting the hook — used after a successful submit. */
export async function forgetDraft(retailerId: string): Promise<void> {
  await storage.removeItem(`${KEY_PREFIX}${retailerId}`)
}
