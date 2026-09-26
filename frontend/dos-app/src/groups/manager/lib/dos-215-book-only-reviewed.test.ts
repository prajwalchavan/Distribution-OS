/**
 * DOS-215 — the Documents panel offered "Book it as a supplier bill" on an `Extracted` document.
 *
 * Day 1 of the business simulation: the manager pressed it on GUR/26-27/00496 while it read
 * `Extracted`, confirmed the dialog, and read the server's refusal —
 * `POST …/docint/documents/<id>/approve → 409 "document … is extracted; only a reviewed document can
 * be approved"`. The right order (Start reviewing → This reading is right → Book it) works; the
 * button just did not say so.
 *
 * The rule is written against a hand-made table of what `documents.approve` ACCEPTS — the service's
 * guard is `doc.status !== 'reviewed'` → 409, and a committed document answers its own draft again —
 * so a change to `documentMachine` that would let the button through somewhere the server refuses
 * turns this red. `satisfies` fails the typecheck when the contract gains a status without a row.
 */
import type { DocumentStatus } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import { approveOffer, mayReject } from './review-desk'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}
interface NodeUrl {
  fileURLToPath: (url: URL) => string
}
const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** What the panel should do with the button, status by status, for a supplier bill with lines. */
const EXPECTED = {
  uploaded: 'still-reading',
  verifying: 'still-reading',
  extracting: 'still-reading',
  extracted: 'review-first',
  needs_review: 'review-first',
  reviewed: 'ready',
  committed: 'hidden',
  rejected: 'hidden',
  failed: 'hidden',
} satisfies Record<DocumentStatus, 'still-reading' | 'review-first' | 'ready' | 'hidden'>

function offerFor(status: DocumentStatus, reviewing = false, lineCount = 4) {
  return approveOffer({ status, kind: 'supplier_invoice', reviewing, lineCount })
}

describe('DOS-215: Book it is pressable only where documents.approve takes the document', () => {
  it('DOS-215: an Extracted document says to start reviewing first, and cannot be pressed', () => {
    expect(offerFor('extracted')).toEqual({ kind: 'disabled', reason: 'm3.approveStartReview' })
  })

  it('DOS-215: with the review open, it says to press This reading is right first', () => {
    expect(offerFor('needs_review', true)).toEqual({
      kind: 'disabled',
      reason: 'm3.approveSubmitFirst',
    })
  })

  it('DOS-215: every status, against what the service accepts', () => {
    for (const status of Object.keys(EXPECTED) as DocumentStatus[]) {
      const offer = offerFor(status)
      const want = EXPECTED[status]
      if (want === 'ready') expect(offer, status).toEqual({ kind: 'ready' })
      if (want === 'hidden') expect(offer, status).toEqual({ kind: 'hidden' })
      if (want === 'review-first')
        expect(offer, status).toEqual({ kind: 'disabled', reason: 'm3.approveStartReview' })
      if (want === 'still-reading')
        expect(offer, status).toEqual({ kind: 'disabled', reason: 'm3.approveStillReading' })
    }
  })

  it('DOS-215: a reviewed reading with no lines still says why', () => {
    expect(offerFor('reviewed', false, 0)).toEqual({ kind: 'disabled', reason: 'm3.noLines' })
  })

  it('DOS-215: a brand-DMS bill is never booked here (the service answers NOT_IMPLEMENTED)', () => {
    expect(
      approveOffer({
        status: 'reviewed',
        kind: 'brand_dms_invoice',
        reviewing: false,
        lineCount: 3,
      }),
    ).toEqual({ kind: 'disabled', reason: 'm3.approveBrandDms' })
  })

  it('DOS-215: Give it up is not offered on a booked, given-up or failed document', () => {
    expect(mayReject('committed')).toBe(false)
    expect(mayReject('rejected')).toBe(false)
    expect(mayReject('failed')).toBe(false)
    expect(mayReject('extracted')).toBe(true)
    expect(mayReject('reviewed')).toBe(true)
  })

  it('DOS-215: every reason key is a sentence in the manager strings', async () => {
    const { readFileSync } = (await import(NODE_FS)) as NodeFs
    const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
    const strings = readFileSync(fileURLToPath(new URL('../strings.ts', import.meta.url)), 'utf8')
    for (const key of [
      'm3.approveStartReview',
      'm3.approveSubmitFirst',
      'm3.approveStillReading',
      'm3.approveBrandDms',
      'm3.noLines',
    ])
      expect(strings, key).toContain(`'${key}':`)
  })

  it('DOS-215: documents.tsx disables the button from approveOffer and says its reason', async () => {
    const { readFileSync } = (await import(NODE_FS)) as NodeFs
    const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
    const code = readFileSync(
      fileURLToPath(new URL('../../../../app/manager/inbound/documents.tsx', import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\s*\}/g, '')
      .replace(/\s+/g, ' ')
    expect(code).toMatch(/const offer = approveOffer\(/)
    expect(code).toContain("mayApprove && offer.kind !== 'hidden'")
    expect(code).toContain("disabled={offer.kind === 'disabled'}")
    expect(code).toContain(
      "disabledReason={offer.kind === 'disabled' ? t(offer.reason) : undefined}",
    )
    expect(code).toContain('mayReject(doc.status)')
  })
})
