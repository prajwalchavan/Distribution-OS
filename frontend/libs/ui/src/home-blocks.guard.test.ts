/**
 * The NATIVE half of the job home, the shop and `<Screen centered>` (founder, 2026-09-28), read as
 * source because `./native/*` pulls in `react-native`, which does not resolve outside Metro — the
 * same reason `parity.test.ts` reads its barrels. The web half is rendered and pressed for real in
 * `web/home-blocks.test.tsx`; this pins that the phone renderer keeps the same promises, so the
 * two cannot drift while only one of them can be run here.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (file: string): string => readFileSync(join(here, file), 'utf8')

/** The body of `export function <name>(` up to the next top-level export. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`)
  expect(start, `${name} is not exported`).toBeGreaterThan(-1)
  const next = source.indexOf('\nexport ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

describe('both renderers export the new blocks from their barrels', () => {
  for (const renderer of ['web', 'native'] as const) {
    it(`${renderer} exports JobCard, JobList, MoreGroup, ProductTile, TileGrid, BrandTile, CartBar`, () => {
      const barrel = read(`${renderer}/index.ts`)
      expect(barrel).toContain("export { JobCard, JobList, MoreGroup } from './jobs.js'")
      expect(barrel).toContain(
        "export { BrandTile, CartBar, ProductTile, TileGrid } from './shop.js'",
      )
    })
  }
})

describe('native <JobCard> keeps the web half s promises', () => {
  const native = read('native/jobs.tsx')
  const card = bodyOf(native, 'JobCard')

  it('renders the body and the actions as SIBLINGS, never a button inside the body', () => {
    expect(card).toMatch(/\{body\}\s*\{actions\}/)
  })

  it('drops a third secondary through the same shared cap', () => {
    expect(card).toContain('visibleSecondaries(secondary)')
  })

  it('draws the phone layout with the adjacent-target gap and the primary full width', () => {
    expect(native).toContain("touch === 'floor' ? gap.warehouse : gap.adjacent")
    expect(card).toContain("actionButton(primary, 'primary', true)")
  })

  it('says "Do this next" in words, not only with the accent bar', () => {
    expect(card).toContain("theme.t('job.next')")
  })

  it('JobList offers "Nothing waiting" and one action; MoreGroup remembers through the shared store', () => {
    expect(bodyOf(native, 'JobList')).toContain("theme.t('job.nothingWaiting')")
    const more = bodyOf(native, 'MoreGroup')
    expect(more).toContain('moreGroupOpen(id, defaultOpen)')
    expect(more).toContain('rememberMoreGroup(id, next)')
    expect(more).toContain('accessibilityState={{ expanded: open }}')
  })
})

describe('native shop blocks keep the web half s promises', () => {
  const native = read('native/shop.tsx')

  it('the tile reuses the kit QtyStepper, stacked, and adds one case with the + ', () => {
    const tile = bodyOf(native, 'ProductTile')
    expect(tile).toContain('<QtyStepper')
    expect(tile).toContain('layout="stacked"')
    expect(tile).toContain('onOpenPieces={onOpenPieces}')
    expect(tile).toContain('onChange(stepByCase(0, 1, caseSize))')
  })

  it('the brand block takes its colour and initial from the shared helpers', () => {
    expect(native).toContain('brandColors(theme.colors, brand)')
    expect(native).toContain('brandInitial(brand)')
  })

  it('the grid counts columns the same way and cuts rows for want of a CSS grid', () => {
    const grid = bodyOf(native, 'TileGrid')
    expect(grid).toContain('tileColumns(viewport.width)')
    expect(grid).toContain('chunkRows(')
  })

  it('an empty cart hides the screen s strip, as on the web', () => {
    const bar = bodyOf(native, 'CartBar')
    expect(bar).toContain('useHideBottomBar(empty)')
    expect(bar).toContain('if (empty) return null')
  })
})

describe('native <Screen centered> and the comfortable controls', () => {
  const layout = read('native/layout.tsx')

  it('centres a scrolling column that avoids the keyboard', () => {
    expect(layout).toContain('function CenteredScreen(')
    expect(layout).toContain('<KeyboardAvoidingView behavior="padding"')
    expect(layout).toContain("justifyContent: 'center'")
    expect(layout).toContain('flexGrow: 1')
  })

  it('provides the comfortable scale to its column and the bar setter to its bottom bar', () => {
    expect(layout).toContain('<ControlScaleContext.Provider value={COMFORTABLE}>')
    expect(layout).toContain('<BottomBarContext.Provider value={setBarHidden}>')
    expect(layout).toContain("display: barHidden ? 'none' : 'flex'")
  })

  it('both renderers read the scale in Button and TextInput, and only ever raise a control', () => {
    for (const renderer of ['web', 'native'] as const) {
      const controls = read(`${renderer}/controls.tsx`)
      for (const name of ['Button', 'TextInput']) {
        expect(bodyOf(controls, name), `${renderer} ${name}`).toContain(
          'scaledHeight(sizeTokens[size ?? theme.touch], scale)',
        )
      }
    }
    expect(read('control-scale.ts')).toContain('Math.max(floor, scale.minHeight)')
  })

  it('both QtyStepper halves carry the stacked layout with the adjacent-target gap', () => {
    for (const renderer of ['web', 'native'] as const) {
      const stepper = bodyOf(read(`${renderer}/money.tsx`), 'QtyStepper')
      expect(stepper, renderer).toContain("layout = 'row'")
      expect(stepper, renderer).toContain("touch === 'floor' ? gap.warehouse : gap.adjacent")
      expect(stepper, renderer).toContain('{stacked ? piecesButton : null}')
    }
  })
})
