/**
 * DOS-065 — THE CREW READS ITS OWN POST, AND THIS DOOR'S PAPERS.
 *
 * Measured on the founder's own data. "Me" -> Inbox was twenty rows of messages the office had sent
 * to SHOPS since June ("Order SO-0459 of ₹8,044.00 confirmed…", "Received ₹3,728.00, receipt
 * RCPT-0024…"), because `notifications.messages.list` was called with no filter at all and a staff
 * caller may read the whole tenant's log. "Send the papers" opened on ten receipts back to July and
 * a dozen order confirmations before anything from today, because it asked for the SHOP's whole
 * timeline. A driver on a one-hand screen was reading every shop's payment history at a shop door.
 *
 * Both filters already exist on the contract — `MessagesListInput.mine`, `MessagesListInput.refType`
 * / `refId`, `ReceiptsListInput.tripId` — so this is what the two screens ASK FOR, and that is what
 * is read here: the source, in the style of `dos-149-door-toast.test.ts`, because importing a screen
 * in Node pulls in `react-native` and `expo-router`, which resolve only under Metro.
 */
import { describe, expect, it } from 'vitest'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** Source with its comments taken out: a comment may quote the very call it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** The arguments of one call, as the 220 characters that follow it (prettier wraps long calls). */
function callsTo(source: string, callee: string): string[] {
  return [...source.matchAll(new RegExp(callee.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map(
    (hit) => source.slice(hit.index, (hit.index ?? 0) + 220),
  )
}

describe('DOS-065 the crew reads its own post and this door’s papers', () => {
  it('DOS-065 the inbox on Me asks only for what is addressed to this crew member', async () => {
    const me = await read('../../app/settings.tsx')
    const calls = callsTo(me, 'notifications.messages.list(')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/mine:\s*true/)
  })

  it('DOS-065 Send the papers opens on THIS trip’s receipts, not the shop’s payment history', async () => {
    const share = await read('../../app/share/[invoiceId].tsx')
    const calls = callsTo(share, 'receivables.receipts.list(')
    expect(calls).toHaveLength(1)
    // This trip, when the stop handed one over — and the shop's history only behind the fold.
    expect(calls[0]).toMatch(/tripId/)
    expect(share).toMatch(/d9-older/)
  })

  it('DOS-065 Send the papers opens on THIS bill’s messages, not every message the shop ever had', async () => {
    const share = await read('../../app/share/[invoiceId].tsx')
    const calls = callsTo(share, 'notifications.messages.list(')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/refType:\s*'invoice'/)
    expect(calls[0]).toMatch(/refId/)
  })

  it('DOS-065 the stop hands its trip to Send the papers, so the papers can be scoped to it', async () => {
    const stop = await read('../../app/stop/[id]/index.tsx')
    expect(stop).toMatch(/\/share\/\$\{[^}]*\}\?tripId=/)
  })
})
