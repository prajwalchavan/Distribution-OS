/**
 * DOS-071 — WHETHER THIS BILL OWES A PHOTOGRAPH, AND WHAT THE PANEL SAYS ABOUT IT.
 *
 * The panel's line was computed straight from the tenant's policy, so it went on reading "This shop
 * is on credit — a photo is required before you can record it" AFTER the photo was attached (d-09 on
 * the web, a-13 on the Pixel 7), and it read that same credit sentence under a policy of `always` at
 * a shop that pays cash at the door. Beside it, `always` was treated as unconditional while the
 * server returns early for a FAILED stop whatever the policy is (`assertPodPolicy`,
 * deliveries.service.ts) — so the app asked for a photograph of goods that never left the van.
 *
 * One rule now answers all three questions, and both halves of D4 ask it: the proof panel for its
 * line, and `doorstep.ts` for whether `d4-record` may be pressed at all (DOS-181 put that gate in one
 * place, and this is what feeds it). The device never asks for more than the server would.
 *
 * Pure TypeScript, the `doorstep.ts` pattern: no component, no platform module, so it runs under
 * vitest with no Metro. The SENTENCE for each state is the screen's, out of its own catalogue.
 */

/** `TripPolicy.podRequired`: the tenant's proof-of-delivery rule (`tenant_settings`). */
export type PodPolicy = 'always' | 'credit_only' | 'never'

/** What the outcome of this bill will be, as D4 has computed it from the line entries. */
export type DoorOutcome = 'delivered' | 'partial' | 'failed'

/** Which sentence the `d4-pod` panel carries — the screen maps each to a string key. */
export type PodFooter = 'attached' | 'retake' | 'required_credit' | 'required_always' | 'optional'

export interface PodState {
  /** A photograph (or signature) is required on this bill, by the same rule the server applies. */
  required: boolean
  /** Something about the proof stands between the driver and the doorstep write. */
  blocksRecord: boolean
  footer: PodFooter
}

export function podState(input: {
  policy: PodPolicy
  /** The shop is on credit terms (`payment_terms === 'POST_FULFILLMENT'`). */
  onCredit: boolean
  outcome: DoorOutcome
  hasProof: boolean
  /** The photograph is over `MAX_INLINE_BASE64` and could not travel with an offline write. */
  proofTooBig: boolean
}): PodState {
  // Nothing went in, so there is nothing to prove — the server's own first line.
  const required =
    input.outcome !== 'failed' &&
    (input.policy === 'always' || (input.policy === 'credit_only' && input.onCredit))
  const blocksRecord = (required && !input.hasProof) || input.proofTooBig
  const footer: PodFooter = input.proofTooBig
    ? 'retake'
    : input.hasProof
      ? 'attached'
      : !required
        ? 'optional'
        : input.policy === 'always'
          ? 'required_always'
          : 'required_credit'
  return { required, blocksRecord, footer }
}
