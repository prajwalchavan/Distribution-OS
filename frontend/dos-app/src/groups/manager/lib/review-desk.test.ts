/**
 * DOS-031 — M3 inbound documents: the panel offers Start reviewing only where `review.start` can take
 * the document.
 *
 * The server takes the review lock only from `extracted` or `needs_review` and answers 409 from anything
 * else; its guard and the transition it then fires both read the `start_review` rows of
 * `documentMachine`. The worklist also lists `reviewed` and `failed` documents, and selecting a row
 * clears the panel's session, so every Reviewed or Failed row used to open on a Start reviewing button
 * the server always refused.
 *
 * The third case reads the screen's source rather than rendering it, like
 * `sales-app/src/order-entry-layout.test.ts`: importing the screen in Node pulls in `react-native` and
 * `expo-router`, which do not resolve outside Metro, and without it the rule could stay green while the
 * screen never asks it. `@types/node` is deliberately absent from an app (`env.d.ts`), so the two Node
 * functions come in through a non-literal specifier and their shapes are named here. Every pattern
 * tolerates whitespace, so `pnpm format` reflowing the JSX cannot turn it red.
 */
import type { DocumentStatus } from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import { mayStartReview } from './review-desk'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/**
 * Whether `review.start` accepts a document in each status, written out by hand: `extracted` and
 * `needs_review`, nothing else. `satisfies` fails `pnpm typecheck` when the contract gains a status
 * without a row here.
 */
const REVIEW_START_ACCEPTS = {
  uploaded: false,
  verifying: false,
  extracting: false,
  extracted: true,
  needs_review: true,
  reviewed: false,
  committed: false,
  rejected: false,
  failed: false,
} satisfies Record<DocumentStatus, boolean>

/** The documents screen's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(
    fileURLToPath(new URL('../../../../app/manager/inbound/documents.tsx', import.meta.url)),
    'utf8',
  )
}

/** Block and line comments removed, so a comment that names a `<Button>` or the rule is not counted. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const START_TEST_ID = /testID\s*=\s*\{?\s*["'`]docint-start["'`]\s*\}?/g
const GATE = /mayStartReview\s*\(\s*doc\s*\.\s*status\s*\)/g
const IMPORTS_RULE =
  /import\s*\{[^}]*\bmayStartReview\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/\.\.\/src\/groups\/manager\/lib\/review-desk["']/

describe('DOS-031 M3 documents panel: Start reviewing only where review.start can take the document', () => {
  it('DOS-031: Start reviewing is not offered on a reviewed or failed document (the two worklist states review.start refuses)', () => {
    expect(mayStartReview('reviewed')).toBe(false)
    expect(mayStartReview('failed')).toBe(false)
  })

  it('DOS-031: Start reviewing is offered on exactly the statuses review.start accepts (extracted, needs_review), for every DocumentStatus', () => {
    const statuses = Object.keys(REVIEW_START_ACCEPTS) as DocumentStatus[]
    expect(statuses).toHaveLength(9)
    for (const status of statuses) {
      expect(mayStartReview(status), status).toBe(REVIEW_START_ACCEPTS[status])
    }
  })

  it('DOS-031: documents.tsx renders the docint-start button only inside a mayStartReview(doc.status) branch', async () => {
    const code = withoutComments(await readScreen())

    expect(
      code,
      'documents.tsx does not import mayStartReview from ../../../src/groups/manager/lib/review-desk',
    ).toMatch(IMPORTS_RULE)

    const starts = [...code.matchAll(START_TEST_ID)]
    expect(starts, 'testID="docint-start" must occur exactly once in documents.tsx').toHaveLength(1)
    const startAt = starts[0]?.index ?? -1

    const gates = [...code.slice(0, startAt).matchAll(GATE)]
    expect(
      gates.length,
      'no mayStartReview(doc.status) before testID="docint-start"',
    ).toBeGreaterThan(0)
    const lastGate = gates[gates.length - 1]
    const gateEnd = lastGate === undefined ? startAt : lastGate.index + lastGate[0].length

    const buttons = code.slice(gateEnd, startAt).match(/<Button\b/g) ?? []
    expect(
      buttons,
      'exactly one <Button between the last mayStartReview(doc.status) and testID="docint-start"',
    ).toHaveLength(1)
  })
})
