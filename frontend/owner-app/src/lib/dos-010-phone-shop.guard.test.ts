/**
 * DOS-010 — on a phone the owner's Orders rows must still say WHOSE order it is.
 *
 * `<Register>` draws a table on the desk and grouped `<ListRow>`s below 1024 px, and the phone
 * rendering keeps exactly three cells: the `identity` column as `primary`, the `chip` column as
 * `secondary`, the `value` column as the trailing money (`ui/src/web/list.tsx:513`,
 * `ui/src/native/list.tsx:394`). Every other column — the Shop one among them — is dropped, so at
 * 390 px and on the Pixel 7 a row read "SO-0689 · Delivered · 6,376.00" and the owner could not tell
 * whose order it was without opening each one.
 *
 * The cure is this app's, not the kit's: the identity cell itself carries the shop WHENEVER THE
 * REGISTER IS NOT A REAL TABLE — a narrow web viewport, and every native width, since the native
 * renderer has no table branch at all. Teaching `<Register>` to render the `detail` priority would
 * change every register in every app, and where a table IS drawn the shop already has its own column
 * — printing it twice there is the other half of the same defect.
 *
 * Read as SOURCE, like `dos-012-refusal.guard.test.ts`: importing a screen in Node pulls in
 * `react-native` and `expo-router`, which resolve only under Metro, and `@types/node` is deliberately
 * absent from an app (`env.d.ts`).
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

/** A screen's source. `fileURLToPath`, never `URL.pathname`: the repository path has a space. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that quotes a call is not read as the call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * The whole of the call whose head matches `marker`, to its balanced closing parenthesis. A regex,
 * not a literal: prettier breaks a long call over several lines and the head is then `textColumn(\n
 * 'orderNo',`.
 */
function callAt(code: string, marker: RegExp, where: string): string {
  const head = marker.exec(code)
  expect(head, `${where} has no ${String(marker)}`).not.toBeNull()
  const start = head?.index ?? -1
  let depth = 0
  for (let i = code.indexOf('(', start); i < code.length; i += 1) {
    const ch = code[i]
    if (ch === '(') depth += 1
    if (ch === ')') {
      depth -= 1
      if (depth === 0) return code.slice(start, i + 1)
    }
  }
  throw new Error(`${where}: ${String(marker)} is never closed`)
}

describe('O5 Orders on a phone', () => {
  it('DOS-010: the identity cell names the shop at phone width, and the desk table keeps its own Shop column', async () => {
    const code = withoutComments(await read('../../app/orders/index.tsx'))

    // The screen knows which shell is on screen; the register's phone rendering is the 1024 px one.
    expect(code).toMatch(/useViewport\(\)/)

    const identity = callAt(code, /textColumn\(\s*'orderNo'/, 'app/orders/index.tsx')
    expect(identity).toContain("priority: 'identity'")
    expect(identity).toMatch(/row\.orderNo/)
    // The shop travels in the identity cell, so the phone row says whose order it is.
    expect(identity, 'the identity cell never names the shop').toMatch(
      /names\.retailer\(row\.retailerId\)/,
    )
    // …and only there: the desk table already has a Shop column, which must not print it twice.
    expect(identity, 'the identity cell is not conditional on the phone shell').toMatch(/\bphone\b/)
    expect(code).toMatch(/textColumn\('shop'/)
  })

  /*
   * The review's second reading of the same defect. `phone` was the VIEWPORT, but the shell that
   * drops the Shop column is the RENDERER: `ui/src/native/list.tsx` is titled "the phone rendering of
   * the one props contract" and has no table branch at any width, while the web Register does. On the
   * web the two agree — `ThemeProvider` feeds `useViewport().kind` into the theme and `theme.tsx`
   * forces density `field` on a phone — but on an Android tablet or an iPad at 1024 dp and wider the
   * viewport is `desk`, the identity cell would drop the shop, and the native register has no Shop
   * column to fall back on. That is DOS-010 again, on a target this repo ships (docs/08 §0: one
   * codebase for web, Android and iOS).
   */
  it('DOS-010: the shop rides in the identity cell on every native width, not only a narrow web one', async () => {
    const code = withoutComments(await read('../../app/orders/index.tsx'))
    const flag = /const phone = [^\n]*/.exec(code)?.[0] ?? ''
    expect(flag.length, 'the screen has no `phone` flag any more').toBeGreaterThan(0)
    expect(flag, 'the flag is the viewport alone, so a native tablet loses the shop').toMatch(
      /native/,
    )
    expect(code).toMatch(/from '@dos\/ui\/platform'/)
  })
})
