/**
 * docs/29 §1 — the two screens that stand either side of sign-in.
 *
 * **Welcome** is the first thing a device shows when no session exists on it: the Distribution OS
 * wordmark, one line about what the product is, this app's own name, and one button. It is shown
 * ONCE per device — a driver at 6 am opens straight into the trip, not into an introduction — so a
 * flag in `platform.storage` is set the moment "Sign in" is pressed and cleared when the session
 * goes away. That flag is the whole of the "once", and it is what this file pins.
 *
 * **Landing** is the two seconds after a fresh sign-in (and after a distributor switch): whose
 * distributorship this is, who you are signed in as, and which app this is. It is not a route and
 * it never delays a launch that restored a session — `landingStarts` is that rule, written once.
 *
 * The rendering of both is asserted in `web/render.test.tsx`, where there is a real renderer. What
 * is here is the part no render can see: the flag, the rule, and the wiring every app must share.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it } from 'vitest'

import { appShortName } from './strings.js'
import {
  LANDING_HOLD_MS,
  clearWelcomeSeen,
  landingStarts,
  markWelcomeSeen,
  welcomeSeen,
} from './web/welcome.js'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = join(here, '..', '..', '..')

/** The seven apps and the skeleton they are generated from — nobody is exempt. */
const APPS: readonly string[] = [
  'libs/app-template',
  'owner-app',
  'manager-app',
  'sales-app',
  'warehouse-app',
  'delivery-app',
  'retailer-app',
  'admin-app',
]

function readScreen(app: string, file: string): string {
  return readFileSync(join(frontend, app, 'app', file), 'utf8')
}

/** A comment may TALK about the wiring it does not have; read the code only. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('docs/29 §1 Welcome — this app’s own name', () => {
  it('takes the app name out of APP.title, which is the only place it is written', () => {
    expect(appShortName('Distribution OS - Delivery')).toBe('Delivery')
    expect(appShortName('Distribution OS - Admin')).toBe('Admin')
    expect(appShortName('Distribution OS - Template')).toBe('Template')
  })

  it('leaves a title that names no app alone rather than returning an empty heading', () => {
    expect(appShortName('Distribution OS')).toBe('Distribution OS')
    expect(appShortName('Distribution OS - ')).toBe('Distribution OS -')
  })
})

describe('docs/29 §1 Welcome — shown once per device', () => {
  beforeEach(() => {
    clearWelcomeSeen()
  })

  it('has not been seen on a device that has never been past it', () => {
    expect(welcomeSeen()).toBe(false)
  })

  it('is seen from the moment Sign in is pressed, not from the moment sign-in succeeds', () => {
    markWelcomeSeen()
    expect(welcomeSeen()).toBe(true)
  })

  it('comes back for the next person once the session is gone', () => {
    markWelcomeSeen()
    clearWelcomeSeen()
    expect(welcomeSeen()).toBe(false)
  })
})

describe('docs/29 §1 Welcome — every app wires it the same way', () => {
  for (const app of APPS) {
    describe(app, () => {
      const source = readScreen(app, 'sign-in.tsx')

      it('imports Welcome from the kit and from nowhere else', () => {
        const kitImport = /import \{([^}]*)\} from '@dos\/ui'/.exec(source)?.[1] ?? ''
        expect(kitImport.split(',').map((name) => name.trim())).toContain('Welcome')
      })

      it('wraps its own sign-in form in the kit Welcome, character for character', () => {
        expect(source).toContain('    <Welcome appTitle={APP.title} role={APP.role}>\n')
        expect(source).toContain('    </Welcome>\n')
      })

      it('leaves the form itself inside the wrapper, not replaced by it', () => {
        expect(source).toContain('testID="sign-in-submit"')
        expect(source).toContain('sign-in-username')
        expect(source).toContain('sign-in-password')
      })
    })
  }
})

/**
 * docs/29 §1 Landing — the two seconds after a fresh sign-in.
 *
 * `landingStarts` is the whole rule, written once and read by both renderers: it answers "has a
 * session just ARRIVED", which is not the same question as "is there a session". A launch that
 * restored a session must not be held up by two seconds of being told where one already is.
 */
describe('docs/29 §1 Landing — when it starts, and when it must not', () => {
  it('starts on a fresh sign-in: a session where a settled render had none', () => {
    expect(landingStarts(null, 'tarsun:sunil')).toBe(true)
  })

  it('starts on a distributor switch: a different distributorship under the same person', () => {
    expect(landingStarts('tarsun:meena', 'sai:meena')).toBe(true)
  })

  it('NEVER starts on a launch that restored a session — the first settled render is not an arrival', () => {
    expect(landingStarts(undefined, 'tarsun:sunil')).toBe(false)
  })

  it('never starts on a sign-out, and never on a render that changed nothing', () => {
    expect(landingStarts('tarsun:sunil', null)).toBe(false)
    expect(landingStarts('tarsun:sunil', 'tarsun:sunil')).toBe(false)
    expect(landingStarts(undefined, null)).toBe(false)
  })

  it('holds for two seconds, and both renderers hold for the same two', () => {
    expect(LANDING_HOLD_MS).toBe(2000)
    const held = (file: string): string =>
      /const LANDING_HOLD_MS = (\d+)/.exec(readFileSync(join(here, file), 'utf8'))?.[1] ?? ''
    expect(held('web/welcome.tsx')).toBe('2000')
    expect(held('native/welcome.tsx')).toBe('2000')
  })
})

describe('docs/29 §1 Landing — every root layout wires it the same way', () => {
  for (const app of APPS) {
    describe(app, () => {
      const source = stripComments(readScreen(app, '_layout.tsx'))

      it('takes the landing and the welcome flag from the kit, not from a second copy', () => {
        const kitImport = /import \{([\s\S]*?)\} from '@dos\/ui'/.exec(source)?.[1] ?? ''
        const names = kitImport.split(',').map((name) => name.trim())
        expect(names).toContain('Landing')
        expect(names).toContain('clearWelcomeSeen')
        expect(names).toContain('useLandingGate')
      })

      it('asks the gate with the hydration flag, so a restored session is never held up', () => {
        expect(source).toMatch(/useLandingGate\(\s*hydrating,/)
      })

      it('renders the landing over the app, with the person, the app and the gate’s own done', () => {
        expect(source).toMatch(/<Landing\b/)
        expect(source).toContain('personName={session.user.name}')
        expect(source).toContain('appTitle={APP.title}')
        expect(source).toContain('onDone={landing.done}')
      })

      it('gives the welcome back to the next person whichever way this app signs out', () => {
        expect(source).toContain('clearWelcomeSeen()')
      })
    })
  }

  it('is not a route: no app has a landing screen to navigate to or bookmark', () => {
    for (const app of APPS) {
      expect(existsSync(join(frontend, app, 'app', 'landing.tsx'))).toBe(false)
    }
  })
})
