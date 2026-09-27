/**
 * UX-F-5 (founder, 2026-09-26): the owner typed a 20-character password wrong three times because
 * the sign-in gave no way to read it back. Every `secure` TextInput now carries a Show / Hide toggle,
 * on both renderers, and starts hidden.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { en } from './strings.js'

const read = (file: string): string => readFileSync(join(import.meta.dirname, file), 'utf8')

describe('UX-F-5: a password field can be read back', () => {
  it('the web field hides by default and the toggle flips its type', () => {
    const web = read('web/controls.tsx')
    expect(web).toContain("type={secure && !revealed ? 'password' : 'text'}")
    expect(web).toMatch(/useState\(false\)/)
    expect(web).toContain('className="dos-input-reveal"')
    expect(web).toContain('aria-pressed={revealed}')
  })

  it('the native field hides by default and the toggle flips secureTextEntry', () => {
    const native = read('native/controls.tsx')
    expect(native).toContain('secureTextEntry={secure === true && !revealed}')
    expect(native).toContain("t(revealed ? 'input.hide' : 'input.show')")
  })

  it('both renderers say the same words, and the words exist', () => {
    for (const file of ['web/controls.tsx', 'native/controls.tsx']) {
      const src = read(file)
      expect(src).toContain("t(revealed ? 'input.hidePassword' : 'input.showPassword')")
      expect(src).toContain("t(revealed ? 'input.hide' : 'input.show')")
    }
    expect(en['input.show']).toBe('Show')
    expect(en['input.hide']).toBe('Hide')
  })
})
