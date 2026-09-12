/**
 * DOS-029 — which server refusal a surface shows, and when it stops showing it.
 *
 * The manager app threw every refused write away: a dialog closed itself on failure, and the two panels that
 * did print `mutation.error` printed it under the button. The client was never the problem — `useMutation`
 * already stores an `ApiError` carrying the service's own sentence. What was missing is ONE rule for which
 * of those errors a dialog or panel shows, because a surface outlives its writes:
 *
 *  - an error already on a write when the surface opens belongs to an earlier opening and is not shown again;
 *  - the LATEST refusal wins, on a panel serving five writes as much as on a dialog serving one;
 *  - pressing any write on the surface hides it, and a success elsewhere never brings it back;
 *  - a refusal that arrives while another write on the surface is still pending shows once that write settles
 *    (DOS-135): nobody has seen it, so no press has answered it;
 *  - a new scope (another bill, another document on the same open panel) starts over.
 *
 * `refusalStart` / `nextRefusal` are that rule as pure functions; `useRefusal` applies them per render. The
 * three refusals are the finding's own, built the way the transport delivers them (an `ORPCError` with the
 * service's message) and normalised by the real `toApiError`.
 */
import { describe, expect, it } from 'vitest'

import { ORPCError, toApiError, type ApiError } from '../errors.js'
import { nextRefusal, refusalStart, type RefusalState, type WriteOutcome } from './index.js'

/** POST /credit-notes — billing/credit-notes.service.ts, a line asked above what is left to credit. */
const CREDIT_NOTE_400 = 'only 40 pcs of Sunbake Glucose 55 g are left to credit on INV/0634'
/** POST /warehouse/picklists — warehouse/picklists.service.ts, a packed order in a wave. */
const WAVE_409 = 'only a confirmed order can be waved; SO-0850 is packed'
/** POST /docint/documents/:id/approve — docint/documents.service.ts, a brand-DMS bill. */
const BRAND_DMS_501 =
  'a brand-DMS bill is committed through billing.invoices.importBrandDms (never a second legal invoice); docint keeps it reviewed'

const refusal = (code: 'BAD_REQUEST' | 'CONFLICT' | 'NOT_IMPLEMENTED', message: string): ApiError =>
  toApiError(new ORPCError(code, { message }))

const idle: WriteOutcome = { status: 'idle', error: undefined }
const pending: WriteOutcome = { status: 'pending', error: undefined }
const success: WriteOutcome = { status: 'success', error: undefined }
const failed = (error: ApiError): WriteOutcome => ({ status: 'error', error })

/**
 * Renders a surface through a sequence of frames, the way `useRefusal` does: the first frame is the mount,
 * every later one feeds the previous state. Returns what each frame showed and the final state.
 */
function frames(
  sequence: readonly (readonly WriteOutcome[])[],
  scopes: readonly (string | null)[] = [],
): { shown: (ApiError | undefined)[]; state: RefusalState } {
  const [first, ...rest] = sequence
  let state = refusalStart(first ?? [], scopes[0] ?? null)
  const shown: (ApiError | undefined)[] = [state.shown]
  rest.forEach((writes, index) => {
    state = nextRefusal(state, writes, scopes[index + 1] ?? scopes[0] ?? null)
    shown.push(state.shown)
  })
  return { shown, state }
}

describe('useRefusal — the rule a manager surface follows to show a refused write (DOS-029)', () => {
  it("DOS-029: a refused write surfaces the service's own sentence (400 credit note, 409 wave, 501 brand-DMS approve)", () => {
    const cases = [
      { error: refusal('BAD_REQUEST', CREDIT_NOTE_400), sentence: CREDIT_NOTE_400, status: 400 },
      { error: refusal('CONFLICT', WAVE_409), sentence: WAVE_409, status: 409 },
      { error: refusal('NOT_IMPLEMENTED', BRAND_DMS_501), sentence: BRAND_DMS_501, status: 501 },
    ]
    for (const { error, sentence, status } of cases) {
      // The dialog opens, the person presses confirm, the service refuses.
      const { shown, state } = frames([[idle], [pending], [failed(error)]])
      expect(shown.slice(0, 2)).toEqual([undefined, undefined])
      expect(shown[2]).toBe(error)
      expect(shown[2]?.message).toBe(sentence)
      expect(shown[2]?.status).toBe(status)

      // A render with nothing new must hand back the SAME state, or the hook's render-time setState loops.
      expect(nextRefusal(state, [failed(error)], null)).toBe(state)
    }
  })

  it('DOS-029: a refusal left over from an earlier opening of the surface is not shown again, and the next refusal is', () => {
    const earlier = refusal('CONFLICT', WAVE_409)
    const next = refusal('CONFLICT', 'only a confirmed order can be waved; SO-0845 is packed')

    // Reopened for another order: the write still holds the refusal from the last opening.
    const { shown } = frames([[failed(earlier)], [failed(earlier)], [pending], [failed(next)]])
    expect(shown).toEqual([undefined, undefined, undefined, next])
  })

  it('DOS-029: on a surface serving several writes the latest refusal is shown, pressing any write hides it, and a later success elsewhere does not bring it back', () => {
    // The documents panel: start review, save, release, re-match, accept a match.
    const lock = refusal('CONFLICT', 'document is locked for review by Meena Joshi')
    const rerun = refusal('CONFLICT', 'a reviewed document cannot be re-matched')
    const again = refusal('CONFLICT', 'document is locked for review by Vikas Kadam')

    const { shown } = frames([
      [idle, idle, idle, idle, idle],
      [failed(lock), idle, idle, idle, idle],
      // Re-match is refused while the lock refusal is still on its own write: the latest one wins.
      [failed(lock), idle, idle, failed(rerun), idle],
      // Save is pressed: any press hides the line.
      [failed(lock), pending, idle, failed(rerun), idle],
      // Save succeeds: neither older refusal comes back.
      [failed(lock), success, idle, failed(rerun), idle],
      [failed(lock), success, idle, failed(rerun), idle],
      // Start review is pressed again and refused again: that refusal shows.
      [pending, success, idle, failed(rerun), idle],
      [failed(again), success, idle, failed(rerun), idle],
    ])
    expect(shown).toEqual([
      undefined,
      lock,
      rerun,
      undefined,
      undefined,
      undefined,
      undefined,
      again,
    ])
  })

  it('DOS-135: a refusal that arrives while a sibling write on the same surface is still pending is shown once that write settles', () => {
    // The documents panel on a slow network: re-match is pressed and hangs, Start reviewing is pressed and
    // refused at once because another manager holds the review lock, then re-match comes back.
    const lock = refusal(
      'CONFLICT',
      'Sunil Tarsun is reviewing this document (until 2026-10-12T00:00:00.000Z)',
    )
    const rerun = refusal('CONFLICT', 'a reviewed document cannot be re-matched')

    // Writes as [start review, re-match]. Nothing shows while re-match is pending; the lock refusal shows
    // the moment it settles, and a later render keeps it.
    const settled = frames([
      [pending, pending],
      [failed(lock), pending],
      [failed(lock), success],
      [failed(lock), success],
    ])
    expect(settled.shown).toEqual([undefined, undefined, lock, lock])

    // Re-match settles with its own refusal: the latest refusal shows. A press then answers it, and the
    // success that follows brings neither refusal back.
    const refusedToo = frames([
      [pending, pending],
      [failed(lock), pending],
      [failed(lock), failed(rerun)],
      [failed(lock), pending],
      [failed(lock), success],
    ])
    expect(refusedToo.shown).toEqual([undefined, undefined, rerun, undefined, undefined])

    // "Latest" is the order they arrived in, not the order the surface lists its writes: [re-match, start review].
    const listedFirst = frames([
      [pending, pending],
      [pending, failed(lock)],
      [failed(rerun), failed(lock)],
    ])
    expect(listedFirst.shown).toEqual([undefined, undefined, rerun])

    // Start reviewing pressed again before re-match settles: its old refusal is off the write, so nothing shows.
    const pressedAgain = frames([
      [pending, pending],
      [failed(lock), pending],
      [pending, pending],
      [success, pending],
      [success, success],
    ])
    expect(pressedAgain.shown).toEqual([undefined, undefined, undefined, undefined, undefined])
  })

  it('DOS-029: a new scope (another bill or document on the same open panel) hides the previous refusal', () => {
    const onThisBill = refusal('BAD_REQUEST', CREDIT_NOTE_400)
    const onTheNext = refusal(
      'BAD_REQUEST',
      'only 0 pcs of Campa Cola 250 ml are left to credit on INV/0635',
    )

    const { shown } = frames(
      [
        [idle],
        [pending],
        [failed(onThisBill)],
        [failed(onThisBill)],
        [failed(onThisBill)],
        [pending],
        [failed(onTheNext)],
      ],
      ['INV/0634', 'INV/0634', 'INV/0634', 'INV/0635', 'INV/0635', 'INV/0635', 'INV/0635'],
    )
    // The INV/0634 sentence never sits under INV/0635, even while it is still on the write's state.
    expect(shown).toEqual([
      undefined,
      undefined,
      onThisBill,
      undefined,
      undefined,
      undefined,
      onTheNext,
    ])

    // The same refusal is shown again only if it arrives again; a scope change on its own shows nothing.
    const back = frames([[failed(onThisBill)], [failed(onThisBill)]], ['INV/0635', 'INV/0634'])
    expect(back.shown).toEqual([undefined, undefined])
  })
})
