/**
 * DOS-055 — the sign-in redirect moves AFTER the commit, in every app.
 *
 * Every root layout decides one thing before it renders anything: where this person should be, given a session
 * that may still be hydrating and a password somebody else chose. Moving there from inside the effect that
 * decided it is a state update on a tree React is still committing, and on a phone React Native says so — the
 * warehouse gate's first tap on the Pixel 7 opened LogBox over the whole app with "Can't perform a React state
 * update on a component that hasn't mounted yet", naming expo-router's own `<ContextNavigator/>`. LogBox is a
 * dev-build overlay, but the render-phase side effect behind it is real in release too: the redirect fires
 * twice on the launch where the session restores a frame after `hydrating` clears.
 *
 * `useRootNavigationState()` answers the first half — does the navigator EXIST — and the app template and the
 * delivery, retailer and admin apps already answer the second with a zero timer: do the work after the mount,
 * which is exactly what the message asks for. The owner, manager, sales and warehouse layouts still replaced
 * inside the commit. This is the whole rule, kept in one place so a new app generated from the template cannot
 * quietly drop it: every root layout waits for the navigator, moves out of the commit, and cancels the move if
 * the answer changes before the timer fires.
 *
 * Read as source: a root layout pulls in expo-router and `react-native`, neither of which resolves outside
 * Metro, so there is no render to assert on (same reason as `dos-105-retailer-words.guard.test.ts`).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = join(here, '..', '..', '..')

/** The seven apps and the skeleton they are generated from — nobody is exempt. */
const LAYOUTS: readonly string[] = [
  'libs/app-template',
  'owner-app',
  'manager-app',
  'sales-app',
  'warehouse-app',
  'delivery-app',
  'retailer-app',
  'admin-app',
]

/** The layout with its comments taken out: a comment may TALK about the timer it does not have. */
function read(app: string): string {
  return readFileSync(join(frontend, app, 'app', '_layout.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * The one effect that redirects. Every `useEffect(() => { … }, [deps])` in the file is read, and the one
 * carrying both `redirectTo` and `router.replace` is the redirect — the other `router.replace` in these files
 * is the shell's own navigate callback, which is a person's tap and belongs inside the commit it came from.
 */
function redirectEffect(source: string): string {
  const blocks =
    source.match(/useEffect\(\(\) => \{(?:(?!useEffect)[\s\S])*?\}, \[[^\]]*\]\)/g) ?? []
  return (
    blocks.find((block) => block.includes('redirectTo') && block.includes('router.replace')) ?? ''
  )
}

describe('every root layout redirects after the commit, never inside it', () => {
  for (const app of LAYOUTS) {
    describe(app, () => {
      const effect = redirectEffect(read(app))

      it('has exactly one redirect effect', () => {
        expect(effect.length).toBeGreaterThan(0)
      })

      it('waits for the root navigator to exist', () => {
        expect(effect).toMatch(/navigatorReady/)
      })

      it('DOS-055 moves out of the commit: router.replace runs inside a zero timer', () => {
        expect(effect).toMatch(/setTimeout\(\(\) => \{\s*router\.replace\(redirectTo\)\s*\}, 0\)/)
        // Never also called straight from the effect body: one path, the deferred one.
        const body = effect.replace(/setTimeout\([\s\S]*?\}, 0\)/, '')
        expect(body).not.toMatch(/router\.replace\(/)
      })

      it('DOS-055 cancels the move when the answer changes before it fires', () => {
        expect(effect).toMatch(/clearTimeout\(/)
      })

      it('DOS-055 does not redirect to the route it is already on', () => {
        expect(effect).toMatch(/redirectTo === pathname/)
      })
    })
  }
})
