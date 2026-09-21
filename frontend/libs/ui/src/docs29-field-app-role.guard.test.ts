/**
 * docs/29 §2 — the role is ELECTED, and in one app the PERSON is the elector (docs/31 ruling B3).
 *
 * This guard used to read the six apps' `src/api.ts` and pin one generated line: the sales, warehouse
 * and delivery apps sent `actAs` on every sign-in because installing that app WAS the choice, and a
 * van phone had to hold a delivery token and never an owner token, whoever was driving. It also
 * pinned the wrong-role screen, which those apps showed to a session the election had not covered.
 *
 * The merge takes both away. With one app there is no `APP.role` to send and no wrong app to be in:
 * after the username and the password, a membership that permits more than one role is ASKED —
 * **Continue as …** — and the choice is what the token is minted with. The refusal docs/29 §2 states
 * is printed at that chooser, which is the only place a person can now be told their login does not
 * reach the work they picked.
 *
 * So what is guarded is the chooser, and the three properties that make it honest rather than
 * decorative:
 *
 * 1. the app declares NO role of its own — nothing may ask on the person's behalf again;
 * 2. the list it offers is `@dos/domain`'s own `electableRoles`, the SAME constant the auth service
 *    grants from, never a second table in the app;
 * 3. a change of role MINTS A TOKEN (`electRole`), never a client-side move to another group under
 *    the token already held — that token would keep reaching the old role's service for the life of
 *    its refresh.
 *
 * Read as source, in the style of `dos-053-warehouse-device-name.guard.test.ts`: a screen pulls in
 * expo-router and `react-native`, neither of which resolves outside Metro, so there is no render to
 * assert on here. What the CLIENT does with `actAs` is proven against a stubbed fetch in
 * `@dos/api-client`'s own `election.test.ts`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const app = join(frontend, 'dos-app')

/** A comment may TALK about the wiring it does not have; read the code only. */
function read(...parts: string[]): string {
  return readFileSync(join(app, ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('docs/31 ruling B3 the app elects nothing: the person does', () => {
  const api = read('src', 'api.ts')

  it('declares no role of its own — no constant asks on the person s behalf', () => {
    expect(api).not.toContain('ELECTED_ROLE')
    expect(api).not.toContain('FIELD_APP_ROLES')
    expect(api).not.toContain('actAs')
  })

  it('leaves the console out too: platform staff hold no membership to elect from', () => {
    expect(readFileSync(join(frontend, 'admin-app', 'src', 'api.ts'), 'utf8')).not.toContain(
      'ELECTED_ROLE',
    )
  })

  it('keeps `platform` the DEVICE KIND, never the elected group (ruling B2)', () => {
    // `os` is `web | android | ios` from `@dos/ui/platform`; anything else here would make
    // `auth_sessions` name a role where it promises to name a phone.
    expect(api).toMatch(/platform:\s*os\b/)
  })
})

describe('docs/31 ruling B3 the Continue-as chooser', () => {
  const signIn = read('app', 'sign-in.tsx')
  const election = read('src', 'election.ts')

  it('sends the person s choice as actAs on the login itself', () => {
    expect(signIn).toMatch(/signIn\(\{[\s\S]*?actAs/)
  })

  it('offers @dos/domain s own table, not a second list of its own', () => {
    expect(election).toMatch(/import \{[^}]*electableRoles[^}]*\} from '@dos\/domain'/)
    // Never a hand-written role list beside it: that is how the device and the server drift.
    expect(election).not.toMatch(/\[\s*'owner',\s*'manager'/)
  })

  it('asks only when there is a choice: one permitted role goes straight in', () => {
    expect(election).toMatch(/permittedRoles\(session\)\.length > 1/)
    expect(signIn).toContain('needsChooser(')
  })

  it('remembers the last choice per DEVICE and preselects it (ruling B3, Q7)', () => {
    expect(read('src', 'api.ts')).toContain("'dos.lastRole'")
    expect(election).toContain('preselectedRole')
    expect(signIn).toContain('preselectedRole(session)')
  })

  it('changes role by MINTING A TOKEN, never by rendering another group under this one', () => {
    expect(signIn).toContain('electRole(picked)')
    // No route push into another group from the chooser: the ladder moves people, off the token.
    expect(signIn).not.toMatch(/router\.(push|replace)\(/)
  })

  it('prints the server s own refusal sentence rather than one of its own', () => {
    // docs/29 §2's words are `electionRefusal()` on the server and arrive as the error's message.
    expect(signIn).toMatch(/raw instanceof Error \? raw\.message : t\('elect\.failed'\)/)
    expect(signIn).not.toContain('ask the owner to add')
  })
})

describe('docs/31 §1.3 the wrong-role screen is gone, with its four string pairs', () => {
  const groups = readdirSync(join(app, 'src', 'groups'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  it('covers all six groups', () => {
    expect(groups.sort()).toEqual([
      'delivery',
      'manager',
      'owner',
      'retailer',
      'sales',
      'warehouse',
    ])
  })

  for (const group of groups) {
    it(`${group}: no wrongRole key and no wrongRole screen`, () => {
      const strings = readFileSync(join(app, 'src', 'groups', group, 'strings.ts'), 'utf8')
      expect(/'app\.wrongRole\w*':/.test(strings), `${group} strings`).toBe(false)
      const layout = read('app', group, '_layout.tsx')
      expect(layout, group).not.toContain('wrongRole')
    })
  }
})
