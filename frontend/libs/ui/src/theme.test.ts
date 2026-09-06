/**
 * The touch floor of UX-00 §5.2, now that ONE build is the website, the tablet and the phone
 * (docs/08 §0). §5.2 says each app's SHELL fixes which floor applies, and the shell is chosen by
 * viewport — so an owner on a laptop must not get the 63 dp phone button.
 */
import { describe, expect, it } from 'vitest'

import { buildTheme } from './theme.js'
import { size } from './tokens.js'

describe('buildTheme: which touch floor applies', () => {
  it('gives the owner and manager 63 dp on a phone and 32 px on a desk', () => {
    expect(buildTheme({ touch: 'phone', viewport: 'phone' }).touchSize).toBe(size.phone)
    expect(buildTheme({ touch: 'phone', viewport: 'desk' }).touchSize).toBe(size.desk)
    expect(buildTheme({ touch: 'phone', viewport: 'desk' }).touch).toBe('desk')
  })

  it('NEVER shrinks the field and warehouse floors: those are stated per screen, not per shell', () => {
    // "every tap target is >= 69 dp in sales, delivery and retailer; >= 76 dp on every warehouse
    // screen" — a big monitor does not repeal a glove.
    expect(buildTheme({ touch: 'field', viewport: 'desk' }).touchSize).toBe(size.field)
    expect(buildTheme({ touch: 'floor', viewport: 'desk' }).touchSize).toBe(size.floor)
    expect(buildTheme({ touch: 'field', viewport: 'phone' }).touchSize).toBe(size.field)
  })

  it('leaves a desk app alone, and defaults to desk when nothing is declared', () => {
    expect(buildTheme({ touch: 'desk', viewport: 'phone' }).touchSize).toBe(size.desk)
    expect(buildTheme({}).touch).toBe('desk')
  })

  it('keeps density independent of the floor it resolves', () => {
    expect(buildTheme({ touch: 'phone', density: 'desk', viewport: 'desk' }).density).toBe('desk')
    expect(buildTheme({ touch: 'phone', viewport: 'desk' }).density).toBe('field')
  })
})

describe('buildTheme: which density applies', () => {
  /**
   * UX-00 §2 ends "every desk screen is designed twice, on purpose, at BOTH densities", and §8.2 is
   * headed "the phone shell (… and the desk apps' phone surfaces)". An owner opening the same build
   * on a phone is on a field surface: 16 sp body, list cards, never a table.
   */
  it('renders a desk app as a FIELD surface on a phone viewport', () => {
    expect(buildTheme({ touch: 'phone', density: 'desk', viewport: 'phone' }).density).toBe('field')
    expect(buildTheme({ touch: 'desk', density: 'desk', viewport: 'phone' }).density).toBe('field')
  })

  it('keeps a desk app dense on a desk viewport', () => {
    expect(buildTheme({ touch: 'phone', density: 'desk', viewport: 'desk' }).density).toBe('desk')
  })

  it('never turns a field app into a table because the monitor is big', () => {
    expect(buildTheme({ touch: 'field', density: 'field', viewport: 'desk' }).density).toBe('field')
    expect(buildTheme({ touch: 'floor', viewport: 'desk' }).density).toBe('field')
  })
})
