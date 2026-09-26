/**
 * DOS-212 and DOS-214 — the editors are REACHED from both desks, write through the contract's own
 * procedures, and say "saved" only after the 2xx.
 *
 * Day 1 of the business simulation found the owner's and the manager's credit dialog passing the shop's
 * mode straight back (`creditMode: current.creditMode`) with no terms at all, and the Prices screens
 * calling none of `priceLists.setItems`, `overrides.upsert`, `schemes.upsert`. `forms.test.ts` proves
 * the payloads; this proves the wiring, read as SOURCE like the other guards in this app (importing a
 * screen in Node pulls in `react-native` and `expo-router`, which resolve only under Metro).
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

/** A file's source with its comments removed: a comment may quote the very call it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('DOS-212 credit mode and payment terms are set from the shop panel', () => {
  it('the credit dialog sends mode AND terms through retailers.setCredit, from the draft', async () => {
    const editors = await read('./editors.tsx')
    const forms = await read('./forms.ts')
    expect({
      callsSetCredit: /api\.api\.retailers\.setCredit\(/.test(editors),
      modeControl: /testID="credit-mode"/.test(editors),
      termsControl: /testID="credit-terms"/.test(editors),
      modeFromDraft: /creditMode:\s*draft\.mode/.test(forms),
      termsFromDraft: /paymentTerms:\s*draft\.terms/.test(forms),
      showsCurrentFirst: /t\('px\.creditNow'/.test(editors),
    }).toEqual({
      callsSetCredit: true,
      modeControl: true,
      termsControl: true,
      modeFromDraft: true,
      termsFromDraft: true,
      showsCurrentFirst: true,
    })
  })

  it('both desks open it, and neither passes the old mode straight back any more', async () => {
    for (const screen of ['../../app/owner/shops/index.tsx', '../../app/manager/shops/index.tsx']) {
      const code = await read(screen)
      expect(
        {
          opensCreditDialog: /<CreditDialog\b/.test(code),
          echoesMode: /creditMode:\s*current\.creditMode/.test(code),
          modeChipOrColumn: /creditMode/.test(code),
        },
        screen,
      ).toEqual({ opensCreditDialog: true, echoesMode: false, modeChipOrColumn: true })
    }
  })
})

describe('DOS-214 prices, shop rates and schemes are edited, not only read', () => {
  it('the editors call the three contract writes', async () => {
    const editors = await read('./editors.tsx')
    expect({
      setItems: /api\.api\.pricing\.priceLists\.setItems\(/.test(editors),
      overrides: /api\.api\.pricing\.overrides\.upsert\(/.test(editors),
      schemes: /api\.api\.pricing\.schemes\.upsert\(/.test(editors),
      finalControl: /testID="override-final"/.test(editors),
      exclusiveControl: /testID="scheme-exclusive"/.test(editors),
      datesControl: /testID="scheme-from"/.test(editors) && /testID="scheme-to"/.test(editors),
      endRate: /endOverride\(/.test(editors),
    }).toEqual({
      setItems: true,
      overrides: true,
      schemes: true,
      finalControl: true,
      exclusiveControl: true,
      datesControl: true,
      endRate: true,
    })
  })

  it('an editor says saved only after the write resolves, and stays open on a refusal', async () => {
    const editors = await read('./editors.tsx')
    // Every save is `.then(success, stay)`: the toast is raised inside the success branch only.
    const thens = editors.match(
      /mutateAsync\([^)]*\)\.then\(\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*\(\)\s*=>\s*\{\s*\}/g,
    )
    expect(thens?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(/onSaved\(/.test(editors)).toBe(true)
    // The service's own sentence is printed where the button is.
    expect((editors.match(/useRefusalText\(/g) ?? []).length).toBeGreaterThanOrEqual(5)
    expect(/\.then\(\s*done\s*,\s*done\s*\)/.test(editors)).toBe(false)
  })

  it('both desks reach every editor, gated on the permission matrix', async () => {
    for (const [screen, gate] of [
      ['../../app/owner/prices/index.tsx', /useMayWrite\(\)/],
      ['../../app/manager/prices/index.tsx', /can\('pricing\.schemes\.upsert'\)/],
    ] as const) {
      const code = await read(screen)
      expect(
        {
          rate: /<PriceRateDialog\b/.test(code),
          scheme: /<SchemeSheet\b/.test(code),
          override: /<OverrideSheet\b/.test(code),
          gated: gate.test(code),
        },
        screen,
      ).toEqual({ rate: true, scheme: true, override: true, gated: true })
    }
  })

  it('the owner reaches every price list and the what-if view (no three-item cap)', async () => {
    const code = await read('../../app/owner/prices/index.tsx')
    expect({
      slicedLists: /listRows\.slice\(0,\s*3\)/.test(code),
      whatIfTab: /id:\s*'quote'/.test(code),
      tabs: /<Tabs\b/.test(code),
    }).toEqual({ slicedLists: false, whatIfTab: true, tabs: true })
  })
})
