/**
 * DOS-086 (merge-review blocker) — the placed-order banner must not send the rep to do the step the
 * phone now does for them.
 *
 * DOS-086 made the queued draft submit ITSELF: `submitLandedDrafts` (queue.ts) sweeps every order
 * whose header and lines have all been acked and sends the same `{ id, idempotencyKey: \`${id}:submit\`
 * }` the manual button sends. The copy on S3 was written before that, and still reads:
 *
 *   s3.queuedBody  "…Submit it from My orders once it lands."
 *   s3.draftBody   "It has no number yet. Submit it from My orders."
 *
 * `orderOutcome` shows `draft` in EXACTLY the window between the office's acceptance and the pull
 * that brings the number back — the moment the sweep is submitting — so the screen contradicts the
 * fix and sends a busy rep to My orders for a draft that has already gone. The two sentences are the
 * whole blocker; the DOS-180 branches themselves stay as they are.
 *
 * This guard reads the STRINGS, not a screen: the sentences are the defect, and a screen renders
 * whatever key the outcome names. It asserts two things, and both must hold for every body S3 can
 * show after a tap:
 *
 *   1. no outcome body tells the rep to submit the order themselves (the manual button still exists
 *      in My orders for the cases the sweep cannot reach — it is just not what the banner points at);
 *   2. the two held/draft bodies say who IS submitting, so the rep reads a promise rather than a chore.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'

/** Every body `orderOutcome` can name, by the branch that names it. */
const OUTCOME_BODIES = [
  's3.placedBody',
  's3.queuedBody',
  's3.queuedBodyTab',
  's3.draftBody',
  's3.refusedBody',
] as const satisfies readonly (keyof typeof strings)[]

/**
 * An instruction to go and submit it by hand. "Submit" alone is not the defect — a sentence may name
 * the act the PHONE is doing; what must not survive is the imperative aimed at the rep.
 */
const TELLS_THE_REP_TO_SUBMIT = /\bsubmit\s+(?:it|the\s+order|this\s+order)\b(?![^.]*\bphone\b)/i

describe('DOS-086 the placed-order banner does not ask for the step the phone takes', () => {
  it('DOS-086 no S3 outcome body tells the rep to submit the order from My orders', () => {
    const offenders = OUTCOME_BODIES.filter((key) => TELLS_THE_REP_TO_SUBMIT.test(strings[key]))

    expect(offenders).toEqual([])
  })

  it('DOS-086 the held body promises that this phone submits the order when it lands', () => {
    const body = strings['s3.queuedBody']

    expect({
      goesOnItsOwn: /as soon as there is a signal/i.test(body),
      thePhoneSubmits: /this phone submits it/i.test(body),
      noChore: TELLS_THE_REP_TO_SUBMIT.test(body),
    }).toEqual({ goesOnItsOwn: true, thePhoneSubmits: true, noChore: false })
  })

  it('DOS-086 the draft body says the phone is submitting now, and where a refusal will show', () => {
    const body = strings['s3.draftBody']

    expect({
      submittingNow: /this phone is submitting it now/i.test(body),
      namesTheTray: /Needs you/.test(body),
      noChore: TELLS_THE_REP_TO_SUBMIT.test(body),
    }).toEqual({ submittingNow: true, namesTheTray: true, noChore: false })
  })
})
