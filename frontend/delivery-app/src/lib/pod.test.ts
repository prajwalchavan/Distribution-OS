/**
 * DOS-071 — THE PROOF PANEL SAYS WHAT IS ACTUALLY BEING ASKED FOR.
 *
 * Two things were wrong at the door. The panel's own line was computed from the policy alone, so
 * after "Photo attached" it went on reading "This shop is on credit — a photo is required before you
 * can record it" (d-09, a-13), and it read that same credit sentence under a policy of `always` at a
 * shop that pays cash. And `podRequired` treated `always` as unconditional, while the server returns
 * early for a FAILED stop whatever the policy is (deliveries.service.ts `assertPodPolicy`) — so the
 * app demanded a photograph of goods that never left the van.
 *
 * One rule decides all of it: whether a photograph is required on THIS bill, whether that stands
 * between the driver and the write, and which sentence the panel carries. `doorstep.ts` asks it for
 * the button (DOS-181 put the gate there); the panel asks the same one.
 *
 * Pure TypeScript, the `doorstep.ts` pattern — no component, no platform module.
 */
import { describe, expect, it } from 'vitest'

import { podState } from './pod'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** A screen's source with its comments taken out — importing one in Node needs Metro. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-071 what the proof panel asks for', () => {
  it('DOS-071 a credit shop under credit_only owes a photo, and says so until one is attached', () => {
    const before = podState({
      policy: 'credit_only',
      onCredit: true,
      outcome: 'delivered',
      hasProof: false,
      proofTooBig: false,
    })
    expect(before).toEqual({ required: true, blocksRecord: true, footer: 'required_credit' })

    const after = podState({
      policy: 'credit_only',
      onCredit: true,
      outcome: 'delivered',
      hasProof: true,
      proofTooBig: false,
    })
    expect(after).toEqual({ required: true, blocksRecord: false, footer: 'attached' })
  })

  it('DOS-071 under a policy of always a cash shop is asked in the office’s words, not the credit ones', () => {
    expect(
      podState({
        policy: 'always',
        onCredit: false,
        outcome: 'delivered',
        hasProof: false,
        proofTooBig: false,
      }),
    ).toEqual({ required: true, blocksRecord: true, footer: 'required_always' })
    // A shop that pays at the door under `credit_only` is asked for nothing.
    expect(
      podState({
        policy: 'credit_only',
        onCredit: false,
        outcome: 'delivered',
        hasProof: false,
        proofTooBig: false,
      }),
    ).toEqual({ required: false, blocksRecord: false, footer: 'optional' })
    expect(
      podState({
        policy: 'never',
        onCredit: true,
        outcome: 'delivered',
        hasProof: false,
        proofTooBig: false,
      }),
    ).toEqual({ required: false, blocksRecord: false, footer: 'optional' })
  })

  it('DOS-071 nothing went in, so there is nothing to prove — under every policy, as the server has it', () => {
    for (const policy of ['always', 'credit_only', 'never'] as const) {
      expect(
        podState({
          policy,
          onCredit: true,
          outcome: 'failed',
          hasProof: false,
          proofTooBig: false,
        }),
      ).toEqual({ required: false, blocksRecord: false, footer: 'optional' })
    }
  })

  it('DOS-071 the expenses screen refuses a big expense with no bill photographed, and says the amount', async () => {
    const screen = await read('../../app/expenses.tsx')
    // The amount is the office's, read off the trip policy — never a number typed into the screen.
    expect(screen).toMatch(/policy\.expenseProofMinPaise/)
    // One rule, named once, and the button is disabled by it with the sentence beneath.
    expect(screen).toMatch(/const proofNeeded =[\s\S]{0,160}?proof === null/)
    expect(screen).toMatch(/disabled=\{[\s\S]{0,200}?proofNeeded/)
    expect(screen).toMatch(/proofNeeded[\s\S]{0,120}?t\('d7\.proofRequired'/)
  })

  it('DOS-071 a photo too big to travel blocks the write and asks for another, whatever the policy', () => {
    expect(
      podState({
        policy: 'never',
        onCredit: false,
        outcome: 'delivered',
        hasProof: true,
        proofTooBig: true,
      }),
    ).toEqual({ required: false, blocksRecord: true, footer: 'retake' })
  })
})
