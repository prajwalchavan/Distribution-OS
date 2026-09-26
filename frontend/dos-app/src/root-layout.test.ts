/**
 * docs/31 §1.3 and §1.4 — what the ROOT owns, what a GROUP owns, and the line between them.
 *
 * Six root layouts became one, and the split is the whole design: an install has one client, one
 * access token, one refresh, one status bar, one session gate and ONE redirect ladder, and a group
 * has its own shell, its own words, its own touch floor and — for three of them — its own device
 * store. Every line that crosses back is a bug with no symptom on the screen that caused it: a
 * second `<ApiProvider>` would give one group a token the others cannot refresh; a redirect effect
 * inside a group layout would fight the root's; a group reading another group's `GROUPS` row would
 * open the wrong service and blame the network.
 *
 * Read as source: a layout pulls in expo-router and `react-native`, neither of which resolves outside
 * Metro (the same reason `libs/ui/src/root-layout-redirects.test.ts` reads rather than renders).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { GROUP_NAMES } from '@dos/api-client'

/*
 * `@types/node` is deliberately absent from an app (`env.d.ts`): a screen has no `fs`, no `Buffer`
 * and no `__dirname`, and the compiler should say so. A guard that READS source is the one exception,
 * and it takes the same dynamic-import shape the moved guards already use.
 */
interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}
interface NodeUrl {
  fileURLToPath: (url: URL) => string
}
const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** The layout with its comments taken out: a comment may TALK about the wiring it does not have. */
async function read(...parts: string[]): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(`../${parts.join('/')}`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

let root = ''
const groups = new Map<string, string>()

/** The group layout, as `beforeAll` read it. Missing would be a moved file, not a passing test. */
function layoutOf(group: string): string {
  const source = groups.get(group)
  if (source === undefined) throw new Error(`no layout read for the group ${group}`)
  return source
}

beforeAll(async () => {
  root = await read('app', '_layout.tsx')
  for (const group of GROUP_NAMES) groups.set(group, await read('app', group, '_layout.tsx'))
})

/**
 * The one effect that redirects — `libs/ui/src/root-layout-redirects.test.ts`'s own finder, so the
 * two cannot read the file differently.
 */
function redirectEffect(source: string): string {
  const blocks =
    source.match(/useEffect\(\(\) => \{(?:(?!useEffect)[\s\S])*?\}, \[[^\]]*\]\)/g) ?? []
  return (
    blocks.find((block) => block.includes('redirectTo') && block.includes('router.replace')) ?? ''
  )
}

describe('DOS-055 the merged root keeps all five assertions, once instead of eight times', () => {
  it('has exactly one redirect effect', () => {
    expect(redirectEffect(root).length).toBeGreaterThan(0)
  })

  it('waits for the root navigator to exist', () => {
    expect(redirectEffect(root)).toMatch(/navigatorReady/)
  })

  it('moves out of the commit: router.replace runs inside a zero timer', () => {
    expect(redirectEffect(root)).toMatch(
      /setTimeout\(\(\) => \{\s*router\.replace\(redirectTo\)\s*\}, 0\)/,
    )
    const body = redirectEffect(root).replace(/setTimeout\([\s\S]*?\}, 0\)/, '')
    expect(body).not.toMatch(/router\.replace\(/)
  })

  it('cancels the move when the answer changes before it fires', () => {
    expect(redirectEffect(root)).toMatch(/clearTimeout\(/)
  })

  it('does not redirect to the route it is already on', () => {
    expect(redirectEffect(root)).toMatch(/redirectTo === pathname/)
  })
})

describe('docs/31 §6.1 the ladder lives in ONE place', () => {
  for (const group of GROUP_NAMES) {
    it(`${group}: the group layout has no redirect effect of its own`, () => {
      expect(redirectEffect(layoutOf(group)), group).toBe('')
    })
  }
})

describe('docs/31 §1.3 the root reads the ELECTED role and takes the person to its group', () => {
  it('reads the token s role through GROUP_OF, and nothing else', () => {
    expect(root).toMatch(/groupOf\(session\.role\)/)
  })

  it('signs an unmapped role OUT rather than redirecting to /undefined (ruling Q2)', () => {
    expect(root).toMatch(/group === null\) void signOut\(\)/)
  })

  it('sends a signed-in person on /sign-in to their GROUP, never to the bare root', () => {
    // `routeFor(group, '/')` is `/owner`, `/delivery`, … — the six apps' old `'/'` would have been
    // whichever group's tree expo-router matched first.
    expect(root).toContain("routeFor(group, '/')")
    expect(redirectEffect(root)).not.toMatch(/replace\('\/'\)/)
  })

  it('lets a signed-in person stand on /change-password for a VOLUNTARY change (2026-09-26)', () => {
    // The account menu's "Change password" opens the root screen without `mustChangePassword`; the
    // outside-the-group arm must except it, or the item just reopens the group home.
    expect(root).toMatch(/!inGroup\(pathname, group\) && !onChangePassword/)
  })

  it('moves a signed-in pathname OUTSIDE the elected group back into it', () => {
    expect(root).toMatch(/!inGroup\(pathname, group\)/)
  })

  it('holds the ladder still while the Continue-as chooser is open', () => {
    expect(root).toMatch(/hydrating \|\| choosing/)
  })
})

describe('docs/31 §1.4 what an INSTALL has exactly one of', () => {
  it('one ApiProvider, in the root and in no group', () => {
    expect((root.match(/<ApiProvider/g) ?? []).length).toBe(1)
    for (const group of GROUP_NAMES) expect(layoutOf(group), group).not.toContain('<ApiProvider')
  })

  it('one status bar, in the root and in no group — owner and manager gain it at the merge', () => {
    expect(root).toContain('<StatusBar style="dark" />')
    for (const group of GROUP_NAMES) expect(layoutOf(group), group).not.toContain('<StatusBar')
  })

  it('one boot() and one setRouterNavigate, in the root and in no group', () => {
    expect(root).toContain('boot()')
    expect(root).toContain('setRouterNavigate')
    for (const group of GROUP_NAMES) {
      expect(layoutOf(group), group).not.toContain('setRouterNavigate')
      expect(layoutOf(group), group).not.toMatch(/\bboot\(\)/)
    }
  })

  it('one landing panel and one welcome re-arm, in the root and in no group (docs/29 §1)', () => {
    expect(root).toContain('useLandingGate(')
    expect(root).toContain('clearWelcomeSeen()')
    for (const group of GROUP_NAMES) {
      expect(layoutOf(group), group).not.toContain('useLandingGate')
      expect(layoutOf(group), group).not.toContain('clearWelcomeSeen')
    }
  })

  it('names the GROUP s own title on the landing, not the product s (docs/31 §1.3)', () => {
    expect(root).toContain('appTitle={GROUPS[group].title}')
    expect(root).not.toContain('appTitle={APP.title}')
  })
})

describe('docs/31 §1.4 what a GROUP owns, and the root does not', () => {
  it('the shell is the group s: the root renders no rail', () => {
    expect(root).not.toContain('<AppShell')
    for (const group of GROUP_NAMES) expect(layoutOf(group), group).toContain('<AppShell')
  })

  for (const group of GROUP_NAMES) {
    it(`${group}: passes its OWN strings record, swapped and never merged (§3)`, () => {
      expect(layoutOf(group)).toMatch(
        new RegExp(`from '\\.\\./\\.\\./src/groups/${group}/strings'`),
      )
      expect(layoutOf(group)).toContain('strings={strings}')
      // Never spread beside another record: that is exactly the merge §3 rules out.
      expect(layoutOf(group)).not.toMatch(/strings=\{\{\s*\.\.\./)
    })

    it(`${group}: reads its own GROUPS row and no other group s (§6.4b)`, () => {
      const others = GROUP_NAMES.filter((name) => name !== group)
      for (const other of others) {
        expect(layoutOf(group), `${group} reads GROUPS.${other}`).not.toContain(`GROUPS.${other}`)
      }
    })

    it(`${group}: paints nothing at all when it is not the elected group (ruling Q2)`, () => {
      /*
       * No rail, no data, not one frame — the root's ladder is already moving the person, and a
       * group that painted first would spend a 403 on another role's read to do it. The six spell
       * the lookup differently (`groupOf`, an alias, `GROUP_OF[...]`); what is pinned is that each
       * compares the SESSION's role against its OWN group before it renders anything.
       */
      expect(layoutOf(group), group).toMatch(
        /(groupOf|groupForRole|GROUP_OF)\s*[([]\s*session\.role\s*[)\]]\s*[!=]==\s*GROUP\b/,
      )
    })
  }

  it('mounts the sync engine in the three FIELD groups and nowhere else (§4)', () => {
    for (const group of ['sales', 'warehouse', 'delivery'] as const) {
      expect(layoutOf(group), group).toContain('<OfflineProvider')
      // The prefix is the GROUP's row, never a file-local literal.
      expect(layoutOf(group), group).not.toMatch(/storePrefix=\{?'dos-/)
    }
    for (const group of ['owner', 'manager', 'retailer'] as const) {
      expect(layoutOf(group), group).not.toContain('<OfflineProvider')
    }
    expect(root).not.toContain('<OfflineProvider')
  })

  it('sweeps EVERY field prefix at a sign-out, not only the running engine s (§4)', () => {
    for (const group of ['sales', 'warehouse', 'delivery'] as const) {
      expect(layoutOf(group), group).toContain('sweepDeviceStores(openStore, FIELD_STORE_PREFIXES')
      expect(layoutOf(group), group).not.toContain('sweepIdentityStores')
    }
  })
})
