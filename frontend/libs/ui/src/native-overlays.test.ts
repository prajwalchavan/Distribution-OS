/**
 * DOS-164: the native Sheet and Dialog present through the overlay stack.
 *
 * The rules live in `overlay-stack.ts` and are pinned by `overlay-stack.test.ts`. What that spec cannot
 * see is whether the native components USE the stack: `./native/*` imports `react-native`, which does
 * not resolve outside Metro, so — like the source-reading blocks of `parity.test.ts` — this reads the
 * files. It stops a later edit to the same Sheet or Dialog body from bringing back a raw sibling
 * `<Modal visible={open}>`, which is exactly what iOS refuses to present over an open Sheet.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

function read(file: string): string {
  const path = join(here, 'native', file)
  expect(existsSync(path), `native/${file} is missing`).toBe(true)
  return readFileSync(path, 'utf8')
}

/** From a top-level `export function name(` or `export const name =` to the next top-level declaration. */
function bodyOf(source: string, file: string, name: string): string {
  const fn = source.indexOf(`export function ${name}(`)
  const start = fn === -1 ? source.indexOf(`export const ${name} =`) : fn
  expect(start, `${name} is not declared in native/${file}`).toBeGreaterThan(-1)
  const rest = source.slice(start + 1)
  const next = rest.search(/\n(?:export )?(?:function|const) /)
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next)
}

describe('DOS-164: native overlays share one modal per presentation', () => {
  it('DOS-164: native Sheet and Dialog present through the overlay stack, never a Modal bound to their own open prop, and the native ThemeProvider mounts the stack', () => {
    const feedback = read('feedback.tsx')
    expect(feedback, 'a kit overlay binds a Modal to its own open prop').not.toMatch(
      /visible=\{open\}/,
    )
    for (const name of ['Sheet', 'Dialog']) {
      const body = bodyOf(feedback, 'feedback.tsx', name)
      expect(body, `<${name}> does not go through the overlay stack`).toContain('useOverlay(')
      expect(body, `<${name}> does not hand its panel to the stack as a layer`).toContain(
        'useLayerContent(',
      )
      expect(body, `<${name}> does not render the layers opened over it`).toContain(
        '<OverlayOutlet',
      )
    }
    expect(read('ThemeProvider.tsx')).toContain('<OverlayStackProvider>')
  })

  it("DOS-164: a layer renders as a plain View inside its host's Modal, never a nested Modal (one native presentation per overlay stack)", () => {
    const body = bodyOf(read('overlay-host.tsx'), 'overlay-host.tsx', 'OverlayOutlet')
    expect(body, 'a nested Modal is a second, chained UIKit presentation').not.toContain('<Modal')
    expect(body).toContain('accessibilityViewIsModal')
  })
})
