/**
 * DOS-148 — A BILL THAT IS NOT ON THIS VAN NEVER SENDS A DRIVER TO THE CAMERA.
 *
 * Measured on the Pixel 7: stop 1 offered "Deliver this bill" for INV/0831, whose order was still
 * `packed` and on no confirmed load sheet. The crew pressed `−`, chose a reason, photographed the signed
 * bill, typed who signed it, pressed Record — and the office answered with the order machine's own
 * `TransitionError` in red: `order: cannot apply "deliver_partial" in state "packed"`. A driver standing
 * at a shop with a signed bill for goods that were never on his van, reading developer text.
 *
 * `deliveries.record` now refuses it before the photo policy runs, in a sentence naming the bill and the
 * next action (delivery.spec.ts pins that). This is the other half: with a signal, D4 asks `orders.get`
 * what the office has, and when it is not out for delivery the camera and the Record button are both
 * refused with the same sentence — so the photograph is never taken in the first place.
 *
 * THE RULE IS THE DOMAIN'S, not a second copy of it: `orderMachine` comes from `@dos/domain`, the same
 * machine the server asks, so the device can refuse only what the office would refuse. A failed attempt
 * on a bill already back in the godown stays allowed on both sides — `return_undelivered` leaves such an
 * order exactly where it is, and it always has.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { doorstepOrderBlock, doorstepOrderRefusal } from './at-the-door'

/** The delivery app's own catalogue, as `<ThemeProvider>` merges it: key in, sentence out. */
const t = (key: string): string => (strings as Record<string, string>)[key] ?? key

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

/** One element of a screen, from its testID to the end of its props. */
function element(source: string, testID: string): string {
  const start = source.indexOf(`testID="${testID}"`)
  if (start < 0) return ''
  const end = source.indexOf('/>', start)
  return source.slice(start, end < 0 ? source.length : end)
}

describe('DOS-148 D4 refuses a bill that is not on this van before the camera', () => {
  it('DOS-148 a packed bill — the one INV/0831 was — is refused as still in the godown', () => {
    for (const state of ['draft', 'submitted', 'confirmed', 'picking', 'packed']) {
      expect(doorstepOrderBlock(state, 'partial')).toBe('godown')
      expect(doorstepOrderBlock(state, 'delivered')).toBe('godown')
    }
    expect(doorstepOrderRefusal(t, 'godown')).toBe(
      'This bill was not loaded on this van — it is still in the godown. Tell the office; do not hand anything over.',
    )
    // The sentence names the goods and the next action, never the machine that refused it.
    expect(doorstepOrderRefusal(t, 'godown')).not.toContain('deliver_partial')
    expect(doorstepOrderRefusal(t, 'elsewhere')).not.toContain('cannot apply')
  })

  it('DOS-148 a dispatched bill is never refused, and a bill already recorded elsewhere is', () => {
    for (const outcome of ['delivered', 'partial', 'failed'] as const)
      expect(doorstepOrderBlock('dispatched', outcome)).toBeNull()
    expect(doorstepOrderBlock('delivered', 'partial')).toBe('elsewhere')
    expect(doorstepOrderBlock('closed', 'delivered')).toBe('elsewhere')
    expect(doorstepOrderRefusal(t, 'elsewhere')).toBe(
      'This bill is not out for delivery on this van. Tell the office before you hand anything over.',
    )
  })

  it('DOS-148 the device refuses no more than the office would: a move already applied still passes', () => {
    // `applyFulfilmentEvent` is idempotent by state, so each of these is a no-op at the office too.
    expect(doorstepOrderBlock('delivered', 'delivered')).toBeNull()
    expect(doorstepOrderBlock('partially_delivered', 'partial')).toBeNull()
    // "Nothing from this bill" on an order back in the godown has always been accepted; it still is.
    expect(doorstepOrderBlock('packed', 'failed')).toBeNull()
  })

  it('DOS-148 a device that does not know says nothing, and lets the office answer', () => {
    expect(doorstepOrderBlock(null, 'partial')).toBeNull()
    expect(doorstepOrderBlock(undefined, 'partial')).toBeNull()
    // A state a later build invents is not a refusal this one may make up.
    expect(doorstepOrderBlock('awaiting_customs', 'partial')).toBeNull()
  })

  it('DOS-148 D4 asks the office what the order is, and refuses the camera and Record with one sentence', async () => {
    const deliver = await read('../../../../app/delivery/stop/[id]/deliver.tsx')
    expect({
      asksTheOffice: /api\.api\.orders\.get\(/.test(deliver),
      usesTheDomainRule: /doorstepOrderBlock\(/.test(deliver),
      cameraRefused: /notOnTheVan/.test(element(deliver, 'd4-photo')),
      recordRefused: /notOnTheVan/.test(element(deliver, 'd4-record')),
    }).toEqual({
      asksTheOffice: true,
      usesTheDomainRule: true,
      cameraRefused: true,
      recordRefused: true,
    })
  })
})
