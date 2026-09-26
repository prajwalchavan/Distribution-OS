/**
 * The two parity guarantees the universal-app decision rests on (docs/08 section 0, docs/22 section 8
 * of 2026-09-06):
 *
 * 1. Every name `@dos/ui/web` exports, `@dos/ui/native` exports too, and the other way round.
 * 2. Every `@dos/ui/platform` capability exists as a `.web.ts` / `.native.ts` PAIR exporting the same
 *    names.
 *
 * Both are checked by reading the barrel files rather than by importing them, on purpose: importing
 * `./native/index.js` in Node would pull in `react-native`, which does not resolve outside Metro, and
 * a test that cannot run is not a guarantee. The compiler covers the other half — every component in
 * both renderers is typed against the ONE contract in `src/types.ts`, so a name that matches with the
 * wrong props fails `pnpm typecheck`, and `parity.types.ts` binds the new primitives explicitly.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Every name a barrel re-exports, value and type alike.
 *
 * `export type * from '../types.js'` is deliberately ignored: it is the SAME module on both sides, so
 * it can never differ, and expanding it would need a parser rather than a reader.
 */
function exportedNames(file: string): Set<string> {
  const source = readFileSync(file, 'utf8')
  const names = new Set<string>()

  // export { A, B as C, type D } from '...'   and   export { A, B }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    const body = match[1] ?? ''
    for (const raw of body.split(',')) {
      const part = raw.trim().replace(/^type\s+/, '')
      if (part === '') continue
      const alias = /\s+as\s+(\w+)$/.exec(part)
      names.add(alias ? (alias[1] ?? '') : part)
    }
  }
  // export const x / function x / class x / type x / interface x
  for (const match of source.matchAll(
    /^export\s+(?:declare\s+)?(?:const|let|function|class|type|interface|enum)\s+(\w+)/gm,
  )) {
    names.add(match[1] ?? '')
  }
  names.delete('')
  return names
}

/**
 * The only exports allowed to exist on one side.
 *
 * React Native has no cascade, so the stylesheet generator has no native counterpart and never will;
 * it is used by the web `<ThemeProvider>` and by the gallery, never by a screen. The two provider
 * prop types differ by one web-only field (`className`). Everything else must be a pair — that is
 * what makes one screen file serve three targets.
 */
const RENDERER_PRIVATE = {
  web: new Set([
    'BASE_CSS',
    'FONT_CSS',
    'buildStylesheet',
    'buildThemeVars',
    'cssVar',
    'cssVarName',
    'WebThemeProviderProps',
  ]),
  native: new Set(['NativeThemeProviderProps']),
}

describe('renderer parity: @dos/ui/web and @dos/ui/native', () => {
  const web = exportedNames(join(here, 'web', 'index.ts'))
  const native = exportedNames(join(here, 'native', 'index.ts'))

  it('exports something worth comparing', () => {
    // A regex that silently matched nothing would pass every assertion below.
    expect(web.size).toBeGreaterThan(30)
    expect(native.size).toBeGreaterThan(30)
  })

  it('has a native sibling for every web export', () => {
    const missing = [...web]
      .filter((name) => !native.has(name) && !RENDERER_PRIVATE.web.has(name))
      .sort()
    expect(missing).toEqual([])
  })

  it('has a web sibling for every native export', () => {
    const missing = [...native]
      .filter((name) => !web.has(name) && !RENDERER_PRIVATE.native.has(name))
      .sort()
    expect(missing).toEqual([])
  })

  it('keeps the renderer-private list honest: every name on it is really exported once', () => {
    for (const name of RENDERER_PRIVATE.web) {
      expect(web, `${name} is on the web-private list but web does not export it`).toContain(name)
      expect(native, `${name} is on the web-private list but native exports it too`).not.toContain(
        name,
      )
    }
    for (const name of RENDERER_PRIVATE.native) {
      expect(native).toContain(name)
      expect(web).not.toContain(name)
    }
  })

  it('exports the ten layout primitives of docs/08 §0 on both renderers', () => {
    for (const name of [
      'Screen',
      'Box',
      'Stack',
      'Row',
      'Scroll',
      'List',
      'Pressable',
      'Img',
      'Link',
      'Txt',
    ]) {
      expect(web, `web is missing <${name}>`).toContain(name)
      expect(native, `native is missing <${name}>`).toContain(name)
    }
  })

  it('DOS-125: exports <QrCode> on both renderers — a shop scans the same tile on a counter PC and a phone', () => {
    expect(web, 'web is missing <QrCode>').toContain('QrCode')
    expect(native, 'native is missing <QrCode>').toContain('QrCode')
  })

  it('exports the shell and the viewport hook on both renderers', () => {
    for (const name of ['AppShell', 'TenantSwitcher', 'useViewport']) {
      expect(web, `web is missing ${name}`).toContain(name)
      expect(native, `native is missing ${name}`).toContain(name)
    }
  })
})

describe('platform parity: @dos/ui/platform', () => {
  const dir = join(here, 'platform')
  const files = readdirSync(dir)
  const webFiles = files.filter((f) => f.endsWith('.web.ts') && f !== 'index.web.ts')
  const nativeFiles = files.filter((f) => f.endsWith('.native.ts') && f !== 'index.native.ts')

  it('ships every capability as a PAIR, and only the ones named here', () => {
    const capabilities = webFiles.map((f) => f.replace('.web.ts', '')).sort()
    expect(capabilities).toEqual([
      'camera',
      // DOS-125: copying a UPI intent a person cannot retype. Web-only in practice (the native half
      // is honestly `available: false`), but a PAIR all the same — a screen writes one file.
      'clipboard',
      'crypto',
      'documents',
      'files',
      'haptics',
      // The dialler and the map app: UX-00 §6.15 says navigating TO a place is a URL hand-off to
      // the phone's own map app, and the scheme differs per platform (`geo:` / Apple Maps / a
      // universal link), so the fork lives here rather than in the delivery app's stop screen.
      'links',
      'location',
      'share',
      'storage',
    ])
    expect(nativeFiles.map((f) => f.replace('.native.ts', '')).sort()).toEqual(capabilities)
  })

  it.each(webFiles.map((f) => f.replace('.web.ts', '')))(
    '%s exports the same names on both platforms',
    (capability) => {
      const web = exportedNames(join(dir, `${capability}.web.ts`))
      const native = exportedNames(join(dir, `${capability}.native.ts`))
      expect(web.size).toBeGreaterThan(0)
      expect([...web].sort()).toEqual([...native].sort())
    },
  )

  it('the two barrels export the same names', () => {
    const web = exportedNames(join(dir, 'index.web.ts'))
    const native = exportedNames(join(dir, 'index.native.ts'))
    expect([...web].sort()).toEqual([...native].sort())
    expect(web).toContain('platform')
  })
})

describe('entry parity: @dos/ui', () => {
  it('both entries re-export the shared half and their own renderer', () => {
    const web = readFileSync(join(here, 'index.web.ts'), 'utf8')
    const native = readFileSync(join(here, 'index.native.ts'), 'utf8')
    expect(web).toContain("export * from './shared.js'")
    expect(web).toContain("export * from './web/index.js'")
    expect(native).toContain("export * from './shared.js'")
    expect(native).toContain("export * from './native/index.js'")
  })
})

/**
 * The screen header lays its chips and its actions out in a `flexDirection: 'row', flexWrap: 'wrap'`
 * box, which sizes a child to its CONTENT. A React Native child that expects the parent to hand it a
 * width therefore collapses to nothing, and does it silently — no error, no warning, just an empty
 * band where a control should be. Two shipped that way and only the phone showed it: the level-2 tab
 * row of UX-00 §8.1 ("Today · Approvals · Live map") and the 7/30/90-day segmented control, which
 * rendered as an empty 2 px pill. The DOM does not have the problem — a `<div>` is block-level and a
 * `<button>` has padding — which is exactly why walking the web build cannot find it.
 *
 * These read the source rather than render it, like everything else in this file: importing
 * `./native/*` in Node pulls in `react-native`, which does not resolve outside Metro.
 */
describe('native controls do not depend on a parent for their width', () => {
  const source = readFileSync(join(here, 'native', 'controls.tsx'), 'utf8')

  function bodyOf(name: string): string {
    const start = source.indexOf(`export function ${name}(`)
    expect(start, `${name} is not exported from native/controls.tsx`).toBeGreaterThan(-1)
    const next = source.indexOf('\nexport ', start + 1)
    return source.slice(start, next === -1 ? undefined : next)
  }

  it('<Tabs> claims the full width on a phone, as the web half already does', () => {
    const body = bodyOf('Tabs')
    expect(body).toContain("width: '100%'")
    expect(body).toContain("theme.density !== 'desk'")
  })

  it('<Segments> sizes each option by its own label instead of dividing a shrink-to-fit box', () => {
    const body = bodyOf('Segments')
    expect(body).toContain('paddingHorizontal: space[4]')
    // Comments mention `flex: 1`; only a style line counts.
    expect(body).not.toMatch(/^\s*flex: 1,/m)
  })

  it('the web half of both still says the same thing', () => {
    const web = readFileSync(join(here, 'web', 'controls.tsx'), 'utf8')
    expect(web).toContain("width: '100%'")
    expect(web).toContain(`padding: \`0 \${space[4]}px\``)
  })
})

/**
 * A legend key for a mark that is not drawn.
 *
 * `<CompareBars>` decides ONE bar per group or two by looking for a `previous` on any group
 * (`compareBarRects`), but both renderers printed both legend swatches unconditionally. A
 * single-series chart — the manager app's "Strike rate by person", where there is no previous
 * period to compare against — therefore carried a "Previous" key in the paper colour with nothing
 * on the chart in that colour, which reads as "the previous period was zero".
 *
 * Source-read for the same reason as the block above: `./native/*` cannot be imported in Node.
 */
describe('<CompareBars> draws a legend only for the bars it actually drew', () => {
  it('the web half gates the legend on a group having a previous', () => {
    const web = readFileSync(join(here, 'web', 'charts.tsx'), 'utf8')
    expect(web).toContain(
      'const hasPrevious = capped.some((group) => group.previous !== undefined)',
    )
    expect(web).toContain('{hasPrevious ? (')
  })

  it('the native half gates it the same way', () => {
    const native = readFileSync(join(here, 'native', 'charts.tsx'), 'utf8')
    expect(native).toContain('capped.some((group) => group.previous !== undefined)')
  })

  it('the geometry the legend must agree with is unchanged', () => {
    const geometry = readFileSync(join(here, 'charts', 'geometry.ts'), 'utf8')
    expect(geometry).toContain('const hasPrevious = groups.some((g) => g.previous !== undefined)')
  })
})

/**
 * The register's "Clear" is a BUTTON, and UX-00 §5.2 sizes desk buttons at 32 px ("≥ 24 px on desk,
 * where buttons are 32 px"); §4.2/§4.3 put the smallest readable face at 14 px. It carried 24 px and
 * no type style at all, so it inherited a 13 px face — measured on the order queue at both widths.
 */
describe('register clear-filters affordance', () => {
  const web = readFileSync(new URL('./web/list.tsx', import.meta.url), 'utf8')

  it('is a desk button at the button height, not the bare target floor', () => {
    expect(web).toContain('minHeight: isDesk ? 32 : theme.touchSize')
  })

  it('carries a type style rather than inheriting one', () => {
    expect(web).toContain("const clearStyle = useTypeStyle('label', 'meta')")
    expect(web).toContain('...clearStyle,')
  })
})

/**
 * The phone shell's "More" sheet carries every destination that does not fit the four bottom tabs —
 * eleven of them in the manager app, plus a search box and a Close button. `<Sheet>` is anchored to
 * the bottom of the screen, so a sheet taller than the screen grew UPWARD until its own heading sat
 * under the status bar (measured on the iPhone 16 Pro: "More" printed through the 8:15 clock), and
 * whatever went past the bottom could not be reached because the body did not scroll.
 */
describe('native sheet fits the screen', () => {
  const native = readFileSync(new URL('./native/feedback.tsx', import.meta.url), 'utf8')

  it('caps its height so the top stays clear of the notch', () => {
    expect(native).toContain("maxHeight: '86%'")
  })

  it('scrolls its own body rather than overflowing', () => {
    expect(native).toContain('<ScrollView')
    const imported = /import\s*\{([^}]*)\}\s*from\s*'react-native'/.exec(native)
    expect(imported, "native/feedback.tsx has no 'react-native' import").not.toBeNull()
    const names = (imported?.[1] ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .sort()
    expect(names).toEqual(
      ['Image', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'View'].sort(),
    )
  })
})

/**
 * DOS-152: the W5 Short sheet's Short button and the pad's last row sat below the sheet's own
 * ScrollView, behind a Close pinned after it — measured on the Pixel 7: `Short` laid out at y 2293
 * against a 2075 viewport, and a tap where it was drawn hit Close instead and discarded the entry.
 * Close is now the LAST row of the scrollable content, not a footer sibling the ScrollView's own
 * height calculation knows nothing about, so scrolling to the end of the content always reaches it
 * and it never overlaps anything laid out above it.
 */
describe('DOS-152: sheet Close lives inside the scrollable content, never behind it', () => {
  const source = readFileSync(join(here, 'native', 'feedback.tsx'), 'utf8')

  function bodyOf(name: string): string {
    const start = source.indexOf(`function ${name}(`)
    expect(start, `${name} is not declared in native/feedback.tsx`).toBeGreaterThan(-1)
    const next = source.indexOf('\nfunction ', start + 1)
    const nextExport = source.indexOf('\nexport function ', start + 1)
    const candidates = [next, nextExport].filter((n) => n !== -1)
    const end = candidates.length > 0 ? Math.min(...candidates) : source.length
    return source.slice(start, end)
  }

  it('renders Close before the ScrollView closes, not as a footer sibling after it', () => {
    const body = bodyOf('SheetPanel')
    const scrollClose = body.indexOf('</ScrollView>')
    const closeButton = body.indexOf("theme.t('action.close')")
    expect(scrollClose, 'SheetPanel has no </ScrollView>').toBeGreaterThan(-1)
    expect(closeButton, 'SheetPanel has no Close button').toBeGreaterThan(-1)
    expect(closeButton).toBeLessThan(scrollClose)
  })
})

/**
 * DOS-159: the Sheet's Modal never avoided the soft keyboard, so a bottom sheet stayed anchored
 * under it — measured on the Pixel 7/Gboard: the credit-note Sheet's matching-bill suggestion was
 * laid out at y 1622-1811 while the keyboard covered the lower half of the screen, and a tap there
 * opened Gboard's Clipboard panel instead of picking the bill.
 */
describe('DOS-159: native sheet avoids the soft keyboard', () => {
  const source = readFileSync(join(here, 'native', 'feedback.tsx'), 'utf8')

  it('imports KeyboardAvoidingView from react-native', () => {
    expect(source).toContain('KeyboardAvoidingView')
  })

  it('wraps the sheet panel in a KeyboardAvoidingView, padding on both platforms', () => {
    const start = source.indexOf('function SheetPanel(')
    expect(start, 'SheetPanel is not declared in native/feedback.tsx').toBeGreaterThan(-1)
    const end = source.indexOf('\nfunction DialogPanel', start)
    const body = source.slice(start, end === -1 ? undefined : end)
    expect(body).toContain('<KeyboardAvoidingView')
    expect(body).toContain('behavior="padding"')
  })
})

/**
 * The phone shell has to BE the window, not merely be at least as tall as it.
 *
 * Expo's web template sets `body { overflow: hidden }` and `#root { height: 100% }`, so nothing
 * outside the shell can scroll. The phone shell declared `min-height: 100dvh` and no height, which
 * for a flex column means "grow with your content" — a shop card in the sales app came out 1942 px
 * inside an 812 px window, `<main flex:1 minHeight:0>` had no bounded height to shrink into, and
 * `<Screen>`'s own `overflow-y: auto` region never became a scroller. Everything past the first
 * screenful was clipped by body's hidden overflow with no way to reach it, and the sticky bottom bar
 * of UX-00 §8.2 went with it: "Place order" sat 1 155 px below the fold on the screen the pilot is
 * decided on.
 *
 * The desk shell beside it always said `height: '100dvh'`. Both halves say it now, and this reads the
 * source because a static render has no layout to measure.
 */
describe('both shells clamp themselves to the viewport (UX-00 §8.2)', () => {
  const source = readFileSync(join(here, 'web', 'shell.tsx'), 'utf8')

  function shellBody(name: string): string {
    const start = source.indexOf(`function ${name}(`)
    expect(start, `${name} is not declared in web/shell.tsx`).toBeGreaterThan(-1)
    const next = source.indexOf('\nfunction ', start + 1)
    return source.slice(start, next === -1 ? undefined : next)
  }

  it('the phone shell sets a height, not only a minimum', () => {
    expect(shellBody('PhoneShell')).toContain("height: '100dvh'")
  })

  it('the desk shell still does', () => {
    expect(shellBody('DeskShell')).toContain("height: '100dvh'")
    // The ROW, not only the rail: `height: '100%'` on the row resolved to auto under the one app's
    // nested providers and the desk stopped scrolling (Money owed, 685 shops, 2026-09-26).
    expect(shellBody('DeskShell')).toMatch(
      /display: 'flex',\s*height: '100dvh',\s*minHeight: '100dvh'/,
    )
  })
})

/**
 * DOS-060: the phone's amount pad counted paise (4 7 5 6 was ₹47.56) while the web field took rupees.
 * The rupee-first rule lives in pure helpers in `money.ts` (pinned by money.test.ts); this pins that
 * BOTH `<NumberPad>` renderers press their money keys through them. The native half is where the
 * defect was seen and it cannot be imported under vitest, so, like the blocks above, this reads it.
 */
describe('<NumberPad> money mode goes through the shared rupee-first pad helpers', () => {
  function padBody(renderer: 'web' | 'native'): string {
    const source = readFileSync(join(here, renderer, 'money.tsx'), 'utf8')
    const start = source.indexOf('export function NumberPad(')
    expect(start, `NumberPad is not exported from ${renderer}/money.tsx`).toBeGreaterThan(-1)
    const next = source.indexOf('\nexport ', start + 1)
    return source.slice(start, next === -1 ? undefined : next)
  }

  it('DOS-060: both NumberPad renderers route money-mode keys through the shared pad helpers (the native half cannot be imported under vitest)', () => {
    for (const renderer of ['web', 'native'] as const) {
      const body = padBody(renderer)
      for (const helper of [
        'MONEY_PAD_KEYS',
        'padEntryFromPaise(value)',
        'reconcilePadEntry(entry, value)',
        'pressMoneyPadKey(',
        'paiseFromPadEntry(',
        'formatPadEntry(',
      ]) {
        expect(body, `${renderer} <NumberPad> does not use ${helper}`).toContain(helper)
      }
      // The paise-append reducer may still serve count mode, never the money preview.
      expect(body, `${renderer} <NumberPad> still previews money from the raw value`).not.toContain(
        'formatMoney(value ?? 0)',
      )
    }
  })
})

/**
 * DOS-157: a Register's chip column (a `<StatusChip>` node, e.g. the Load-out waiting panel's
 * "Waiting for your approval" / "Approved") is handed to `<ListRow secondary>`, which unconditionally
 * wrapped it in `<Txt numberOfLines={1}>`. A View nested inside a native `Text` renders as a single
 * inline "attachment" glyph, and `numberOfLines={1}` then has exactly one glyph to keep — measured on
 * the Pixel 7: uiautomator read the row's content-desc as "13 Sep, ￼, 1375 rupees", the chip
 * collapsed to a lone "…". A non-string `secondary` (a chip, or any other node) is now rendered
 * directly, never nested inside that `Txt`.
 */
describe('DOS-157: native ListRow never puts a ReactNode secondary inside a numberOfLines Txt', () => {
  const source = readFileSync(join(here, 'native', 'list.tsx'), 'utf8')

  function bodyOf(name: string): string {
    const start = source.indexOf(`export function ${name}(`)
    expect(start, `${name} is not exported from native/list.tsx`).toBeGreaterThan(-1)
    const next = source.indexOf('\nexport ', start + 1)
    return source.slice(start, next === -1 ? undefined : next)
  }

  it('branches on whether secondary is a string before wrapping it in a numberOfLines Txt', () => {
    const body = bodyOf('ListRow')
    expect(body).toContain("typeof secondary === 'string'")
  })
})

/**
 * DOS-158: a dialog's confirm Button set `accessibilityState={{ disabled: off, busy: loading }}`
 * with no `accessibilityLabel`, so a screen reader named the control from its own state rather than
 * its own label. Once a write settled (`loading` back to `false`), Fabric on Android kept announcing
 * "busy" instead of the button's real label — measured on the Pixel 7 after a refused write ('Make a
 * picking sheet' stayed 'busy' with no spinner shown). `busy` is now present only while `loading` is
 * true, and the label is explicit, so a screen reader always has the real name to fall back to.
 */
describe('DOS-158: native Button clears its accessibility "busy" state once loading settles', () => {
  const source = readFileSync(join(here, 'native', 'controls.tsx'), 'utf8')

  function bodyOf(name: string): string {
    const start = source.indexOf(`export function ${name}(`)
    expect(start, `${name} is not exported from native/controls.tsx`).toBeGreaterThan(-1)
    const next = source.indexOf('\nexport ', start + 1)
    return source.slice(start, next === -1 ? undefined : next)
  }

  it('carries an explicit accessibilityLabel', () => {
    const body = bodyOf('Button')
    expect(body).toContain('accessibilityLabel={successLabel ?? label}')
  })

  it('never sets accessibilityState.busy unconditionally: Fabric only clears "busy" once the key is absent', () => {
    const body = bodyOf('Button')
    expect(body).not.toContain('accessibilityState={{ disabled: off, busy: loading }}')
  })
})
