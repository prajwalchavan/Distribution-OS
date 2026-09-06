/**
 * Renders the money and quantity components for real (React DOM's static renderer — no browser, no
 * test-library dependency) and asserts what reaches the screen.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ThemeProvider } from './ThemeProvider.js'
import { CompareBars, StackedMix } from './charts.js'
import { KpiStrip } from './list.js'
import { Money, QtyStepper, RupeeInput } from './money.js'
import { StatusChip, BarLadder, AgeingBuckets } from './list.js'
import { TextInput } from './controls.js'
import { FONT_CSS, FONT_URL } from './css.js'

function renderDesk(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <ThemeProvider touch="desk" density="desk">
      {node}
    </ThemeProvider>,
  )
}

function renderField(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <ThemeProvider touch="field" density="field">
      {node}
    </ThemeProvider>,
  )
}

describe('<Money>', () => {
  it('prints integer paise with Indian grouping and two decimals', () => {
    expect(renderDesk(<Money value={1_84_200_00} />)).toContain('₹1,84,200.00')
  })

  it('renders null as the em dash, never as ₹0.00', () => {
    const html = renderDesk(<Money value={null} />)
    expect(html).toContain('—')
    expect(html).not.toContain('0.00')
  })

  it('composes a hero: ₹ and the paise in their own smaller spans', () => {
    const html = renderField(<Money value={2262000} size="hero" />)
    expect(html).toContain('22,620')
    expect(html).toContain('₹')
    expect(html).toContain('.00')
  })

  it('gives a screen reader words', () => {
    expect(renderDesk(<Money value={2116} />)).toContain('aria-label="21 rupees 16 paise"')
  })

  it('drops the symbol when the column head carries it', () => {
    const html = renderDesk(<Money value={51230000} symbol={false} />)
    expect(html).toContain('5,12,300.00')
    expect(html).not.toContain('₹')
  })

  it('marks every money span as tabular', () => {
    expect(renderDesk(<Money value={100} />)).toContain('dos-num')
  })
})

describe('<RupeeInput>', () => {
  it('shows a fixed ₹ prefix and the value in plain editable rupees', () => {
    const html = renderField(
      <RupeeInput label="Cash collected" value={123450} onChange={() => undefined} />,
    )
    expect(html).toContain('₹')
    expect(html).toContain('value="1234.50"')
  })

  it('renders empty for a null value rather than zero', () => {
    const html = renderField(
      <RupeeInput label="Cash collected" value={null} onChange={() => undefined} />,
    )
    expect(html).toContain('value=""')
  })

  it('states what happens over a bound instead of clamping', () => {
    const html = renderField(
      <RupeeInput
        label="Order value"
        value={1_240_000}
        bound={1_000_000}
        boundMessage="₹12,400 over limit. Needs Sunil's approval."
        onChange={() => undefined}
      />,
    )
    expect(html).toContain('over limit')
    expect(html).toContain('value="12400.00"')
  })

  it('prints the expected amount above the field and never inside it', () => {
    const html = renderField(
      <RupeeInput
        label="Cash collected"
        value={null}
        expected={2262000}
        expectedLabel="To collect"
        onChange={() => undefined}
      />,
    )
    expect(html).toContain('To collect')
    expect(html).toContain('22,620')
    expect(html).toContain('value=""')
  })
})

describe('<QtyStepper>', () => {
  it('shows whole cases and the case line beneath', () => {
    const html = renderField(
      <QtyStepper pieces={48} caseSize={24} onChange={() => undefined} availablePieces={960} />,
    )
    expect(html).toContain('2')
    expect(html).toContain('2 cs = 48 pc')
    expect(html).toContain('40 cs available')
  })

  it('reads "Not ordered" at zero and disables the minus', () => {
    const html = renderField(<QtyStepper pieces={0} caseSize={24} onChange={() => undefined} />)
    expect(html).toContain('Not ordered')
    expect(html).toContain('disabled')
  })

  it('accepts over-available and says what happens', () => {
    const html = renderField(
      <QtyStepper pieces={500} caseSize={24} availablePieces={336} onChange={() => undefined} />,
    )
    expect(html).toContain('Only 14 cs available')
  })

  it('shows a business block with its reason, not a silent refusal', () => {
    const html = renderField(
      <QtyStepper
        pieces={48}
        caseSize={24}
        blocked
        blockedReason="Over credit limit — ask the owner"
        onChange={() => undefined}
      />,
    )
    expect(html).toContain('Over credit limit — ask the owner')
  })

  it('prints the applied scheme in rupees on the row', () => {
    const html = renderField(
      <QtyStepper
        pieces={240}
        caseSize={24}
        schemeLabel="−₹68 · 1 free per 10"
        onChange={() => undefined}
      />,
    )
    expect(html).toContain('−₹68 · 1 free per 10')
  })
})

describe('status and ladders', () => {
  it('always carries the word beside the colour', () => {
    expect(renderDesk(<StatusChip label="Out of stock" family="brick" solid />)).toContain(
      'Out of stock',
    )
  })

  it('draws every ageing rung even at zero', () => {
    const html = renderDesk(
      <AgeingBuckets
        buckets={{
          '0-7': 51230000,
          '8-15': 25600000,
          '16-30': 9410000,
          '31-60': 0,
          '61-90': 0,
          '90+': 0,
        }}
      />,
    )
    for (const rung of ['0–7', '8–15', '16–30', '31–60', '61–90', '90+']) {
      expect(html).toContain(rung)
    }
    expect(html).toContain('5,12,300.00')
    expect(html).toContain('0.00')
  })

  it('states ₹ once, in the panel title row', () => {
    const html = renderDesk(
      <BarLadder
        title="Money owed, by age"
        rows={[{ label: '0–7', value: 100, family: 'moss' }]}
      />,
    )
    expect(html.match(/₹/g)).toHaveLength(1)
  })
})

describe('<TextInput> on a phone-sized browser', () => {
  /**
   * The same build IS the website on that phone (docs/08 §0), and a mobile browser capitalises and
   * spell-corrects a text input exactly the way iOS does — which turns `sunil.tarsun` into
   * `Sunil.tarsun` and a correct password into a failed sign-in.
   */
  it('does not capitalise, correct or spell-check by default', () => {
    const html = renderDesk(
      <TextInput label="Username" value="" onChange={() => undefined} testID="u" />,
    )
    expect(html).toContain('autoCapitalize="none"')
    expect(html).toContain('autoCorrect="off"')
    expect(html).toContain('spellCheck="false"')
  })

  it('still lets a prose field ask for capitals', () => {
    const html = renderDesk(
      <TextInput label="Shop name" value="" onChange={() => undefined} capitalize="words" />,
    )
    expect(html).toContain('autoCapitalize="words"')
  })
})

describe('the self-hosted typeface', () => {
  /**
   * A `@font-face` whose `src` does not exist is not free: an Expo web server answers an unknown
   * path with `index.html`, so every page of every app logs `OTS parsing error: invalid sfntVersion`
   * for a face that was never going to load. The rule appears the moment `FONT_URL` names a file.
   */
  it('emits no @font-face while the app ships no binary', () => {
    if (FONT_URL === null) {
      expect(FONT_CSS).toBe('')
    } else {
      expect(FONT_CSS).toContain('@font-face')
      expect(FONT_CSS).toContain(FONT_URL)
    }
  })

  /**
   * The type scale carries exactly four weights (`TypeToken`), so the sheet must declare exactly
   * four faces — one file per weight, no variable-font syntax, no weight the scale cannot ask for.
   */
  it('declares one face per weight of the type scale', () => {
    if (FONT_URL === null) return
    for (const weight of [400, 500, 600, 700]) {
      expect(FONT_CSS).toContain(`font-weight: ${String(weight)};`)
    }
    expect(FONT_CSS.match(/@font-face/g)).toHaveLength(4)
    expect(FONT_CSS).toContain(`format('woff2')`)
    expect(FONT_CSS).not.toContain('woff2-variations')
    // Every file the sheet names is one the design system actually ships (assets/fonts).
    for (const file of ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      expect(FONT_CSS).toContain(`IBMPlexSans-${file}.woff2`)
    }
  })
})

/**
 * Two rows of a chart can carry the SAME display name — two staff called "Demo Docs Staff", two beats
 * a distributor named alike, two brands sharing a word. Keying a bar, a segment, a KPI column or an
 * ageing rung by its label alone collapsed one into the other and React logged "Encountered two
 * children with the same key" for every collision. These render both and count what comes out.
 */
describe('duplicate display labels', () => {
  it('draws every bar of a CompareBars even when two groups share a name', () => {
    const html = renderDesk(
      <CompareBars
        groups={[
          { label: 'Demo Docs Staff', current: 10 },
          { label: 'Demo Docs Staff', current: 20 },
          { label: 'Vikas Kadam', current: 30 },
        ]}
      />,
    )
    expect(html.split('Demo Docs Staff').length - 1).toBe(2)
  })

  it('draws every segment of a StackedMix even when two share a name', () => {
    const html = renderDesk(
      <StackedMix
        slices={[
          { label: 'Campa', value: 100 },
          { label: 'Campa', value: 50 },
        ]}
      />,
    )
    // Once in the bar's title, once in the key line, for each of the two slices.
    expect(html.split('Campa').length - 1).toBeGreaterThanOrEqual(2)
  })

  it('draws every KPI column even when two share a label', () => {
    const html = renderDesk(
      <KpiStrip
        items={[
          { label: 'Outstanding', value: '1' },
          { label: 'Outstanding', value: '2' },
        ]}
      />,
    )
    expect(html).toContain('>1<')
    expect(html).toContain('>2<')
  })
})
