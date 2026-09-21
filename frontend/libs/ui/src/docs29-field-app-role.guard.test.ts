/**
 * docs/29 §2 field apps always ask for their own role — and they ask it the TEMPLATE's way.
 *
 * A van phone is shared and droppable. The owner who drives on Tuesdays signs in on it and must get a
 * DELIVERY token, never an owner token that would reach owner-service for the life of its refresh, so
 * the sales, warehouse and delivery apps send `actAs` on every sign-in and every distributor switch,
 * and the owner, manager and retailer apps send nothing at all. That the CLIENT sends it is proven in
 * `@dos/api-client`'s own spec against a stubbed fetch; what is proven here is that the seven apps do
 * it with one shared line generated from `libs/app-template/src/api.ts` rather than seven hand-edited
 * ones, because the moment they diverge an app starts asking for a role of its own devising.
 *
 * Read as source, in the style of `dos-053-warehouse-device-name.guard.test.ts`: the seven `api.ts`
 * files are not byte-equal for good reasons — the field apps export `deviceId()` for `@dos/offline`,
 * the retailer app primes one more key (DOS-102) and the console builds a platform client — so what
 * is compared is the election block itself, character for character.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** The six apps that sign a MEMBER in. The console signs platform staff in and elects nothing. */
const TENANT_APPS = ['owner', 'manager', 'sales', 'warehouse', 'delivery', 'retailer'] as const

const SPREAD = '...(ELECTED_ROLE === undefined ? {} : { actAs: ELECTED_ROLE }),'

function apiSource(pkg: string): string {
  return readFileSync(join(frontend, pkg, 'src', 'api.ts'), 'utf8')
}

describe('docs/29 §2 field apps always ask for their own role', () => {
  const template = apiSource(join('libs', 'app-template'))
  const declaration =
    /const FIELD_APP_ROLES[\s\S]*?const ELECTED_ROLE: MembershipRole \| undefined = FIELD_APP_ROLES\[APP\.role\]/.exec(
      template,
    )?.[0] ?? ''

  it('declares the three field roles once, in the template', () => {
    expect(declaration).toContain("sales: 'salesperson'")
    expect(declaration).toContain("warehouse: 'warehouse'")
    expect(declaration).toContain("delivery: 'delivery'")
    // Never a desk role, and never the shopkeeper: those apps sign in as their own membership.
    expect(declaration).not.toMatch(/owner:|manager:|retailer:|platform_admin:/)
    expect(template).toContain(SPREAD)
  })

  it('carries that exact block in every one of the six tenant apps', () => {
    for (const app of TENANT_APPS) {
      const source = apiSource(`${app}-app`)
      expect(source, `${app}-app`).toContain(declaration)
      expect(source, `${app}-app`).toContain(SPREAD)
    }
  })

  it('leaves the console out: platform staff hold no membership to elect from', () => {
    expect(apiSource('admin-app')).not.toContain('ELECTED_ROLE')
  })

  it('keeps the wrong-role screen, reading the refusal sentence docs/29 §2 states', () => {
    for (const app of ['sales', 'warehouse', 'delivery'] as const) {
      const layout = readFileSync(join(frontend, `${app}-app`, 'app', '_layout.tsx'), 'utf8')
      // A role that cannot elect this app's role never gets a session at all — but a session saved on
      // the device before the election landed still opens here, so the screen stays.
      expect(layout, app).toContain('wrongRole')
      expect(layout, app).toContain("t('app.wrongRoleBody', { role, distributor })")

      const strings = readFileSync(join(frontend, `${app}-app`, 'src', 'strings.ts'), 'utf8')
      const sentence = /'app\.wrongRoleBody':\s*\n?\s*'([^']+)'/.exec(strings)?.[1] ?? ''
      expect(sentence, app).toMatch(
        /^Your login at \{distributor\} is a \{role\}; ask the owner to add \w+ to it\.$/,
      )
    }
  })
})
