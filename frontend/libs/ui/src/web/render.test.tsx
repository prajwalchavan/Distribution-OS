/**
 * Renders the money and quantity components for real (React DOM's static renderer — no browser, no
 * test-library dependency) and asserts what reaches the screen.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ThemeContextProvider } from '../theme.js'
import { ThemeProvider } from './ThemeProvider.js'
import { CompareBars, StackedMix } from './charts.js'
import { KpiStrip } from './list.js'
import { Money, QtyStepper, RupeeInput } from './money.js'
import { StatusChip, BarLadder, AgeingBuckets } from './list.js'
import { TextInput, Tabs, Segments } from './controls.js'
import { ConnectionStrip, Sheet } from './feedback.js'
import { MapView } from './map.js'
import { MenuRow, TenantSwitcher } from './shell.js'
import { Txt } from './base.js'
import { Link, Pressable, Row } from './layout.js'
import { FONT_CSS, FONT_URL } from './css.js'
import type { ConnectionState, MapMarker } from '../types.js'

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
    /*
     * Each bar now carries its label TWICE — once whole in the `<title>` a hover shows, once cut to
     * the width of its own slot in the mark itself (`fitLabel`) — so two same-named groups make
     * four occurrences, and a third bar with a different name makes two more.
     */
    expect(html.split('Demo Docs Staff').length - 1).toBe(4)
    expect(html.split('Vikas Kadam').length - 1).toBe(2)
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

describe('the menus of the shell obey the touch floor (UX-00 §5.2)', () => {
  /** `MenuRow` is the row of every menu, of the phone "More" sheet and of the account menu. */
  function row(touch: 'phone' | 'field' | 'floor' | 'desk', viewport: 'desk' | 'phone'): string {
    // The renderer-agnostic provider, because the WEB one reads the real viewport and overrides
    // anything an app passes — which is exactly the contract (`docs/08 §0`), and unusable here.
    return renderToStaticMarkup(
      <ThemeContextProvider touch={touch} viewport={viewport}>
        <MenuRow label="Sign out" onPress={() => undefined} />
      </ThemeContextProvider>,
    )
  }

  it('is 63 dp for an owner on a phone — never Apple’s 44', () => {
    const html = row('phone', 'phone')
    expect(html).toContain('min-height:63px')
    expect(html).not.toContain('min-height:44px')
  })

  it('is 69 dp in a sales or retailer app and 76 dp in the warehouse app', () => {
    expect(row('field', 'phone')).toContain('min-height:69px')
    expect(row('floor', 'phone')).toContain('min-height:76px')
  })

  it('is the desk size on the laptop the same app opens on', () => {
    expect(row('phone', 'desk')).toContain('min-height:32px')
  })

  it('paints its label in a token, not in the browser’s default black', () => {
    const html = row('phone', 'phone')
    expect(html).toContain('color:#1B1E1A')
    expect(html).not.toContain('color:rgb(0, 0, 0)')
  })

  it('closes a bottom sheet with a control at the app floor, not a desk button', () => {
    const html = renderToStaticMarkup(
      <ThemeProvider touch="floor" density="field">
        <Sheet open onClose={() => undefined} title="More">
          <span />
        </Sheet>
      </ThemeProvider>,
    )
    // 76 dp on a warehouse screen; the desk button is 32 and must not appear on a sheet.
    expect(html).toContain('height:76px')
  })
})

describe('<TenantLogo> inside a 172 px rail', () => {
  it('clamps a long distributor name to one line instead of pushing the rail wider', () => {
    const html = renderToStaticMarkup(
      <ThemeProvider touch="desk" density="desk">
        <TenantSwitcher
          current={{ id: 't2', name: 'Sai Distributors, Dombivli', roleLabel: 'owner' }}
          choices={[{ id: 't2', name: 'Sai Distributors, Dombivli', roleLabel: 'owner' }]}
          onSwitch={() => undefined}
        />
      </ThemeProvider>,
    )
    expect(html).toContain('-webkit-line-clamp:2')
    expect(html).not.toContain('white-space:nowrap')
  })

  it('keeps the switcher inside the rail column when there is more than one distributor', () => {
    const html = renderToStaticMarkup(
      <ThemeProvider touch="desk" density="desk">
        <TenantSwitcher
          current={{ id: 't1', name: 'Tarsun Enterprise', roleLabel: 'retailer' }}
          choices={[
            { id: 't1', name: 'Tarsun Enterprise', roleLabel: 'retailer' },
            { id: 't2', name: 'Sai Distributors, Dombivli', roleLabel: 'retailer' },
            { id: 't3', name: 'Kalyan Agencies', roleLabel: 'retailer' },
          ]}
          onSwitch={() => undefined}
        />
      </ThemeProvider>,
    )
    // Sized by its column, not by its content: without this the caret painted outside the rail.
    expect(html).toContain('max-width:100%')
    expect(html).toContain('box-sizing:border-box')
  })
})

describe('<Tabs> at the two viewports', () => {
  const items = [
    { id: 'a', label: 'Outstanding' },
    { id: 'b', label: 'Receipts' },
    { id: 'c', label: 'Books' },
    { id: 'd', label: 'Claims' },
  ]

  it('shares the width on a phone, so the fourth tab is on the screen', () => {
    const html = renderField(<Tabs items={items} value="a" onChange={() => undefined} />)
    // One `flex:1 1 0` per tab: the row can no longer be wider than the screen it is in.
    expect(html.match(/flex:1 1 0/g)?.length).toBe(4)
    expect(html).toContain('Claims')
  })

  it('leaves the desk row hugging the left, sized by its own labels', () => {
    const html = renderDesk(<Tabs items={items} value="a" onChange={() => undefined} />)
    expect(html).not.toContain('flex:1 1 0')
  })
})

describe('<Link variant="text"> is a tap target, not a word (UX-00 §5.2)', () => {
  function link(touch: 'phone' | 'field' | 'desk', viewport: 'desk' | 'phone'): string {
    return renderToStaticMarkup(
      <ThemeContextProvider touch={touch} viewport={viewport}>
        <Link href="/money">Open the rows behind this</Link>
      </ThemeContextProvider>,
    )
  }

  it('carries the owner phone floor, not the 21 dp of a bare underlined word', () => {
    const html = link('phone', 'phone')
    expect(html).toContain('min-height:63px')
  })

  it('carries the field floor in a sales or retailer app', () => {
    expect(link('field', 'phone')).toContain('min-height:69px')
  })

  it('is the desk size on the laptop the same screen opens on', () => {
    expect(link('phone', 'desk')).toContain('min-height:32px')
  })

  it('leaves `plain` alone — it wraps something that already has its own size', () => {
    const html = renderToStaticMarkup(
      <ThemeContextProvider touch="phone" viewport="phone">
        <Link href="/money" variant="plain">
          <span>row</span>
        </Link>
      </ThemeContextProvider>,
    )
    expect(html).not.toContain('min-height')
  })
})

describe('<ConnectionStrip> never claims a read it has not had', () => {
  function strip(state: ConnectionState): string {
    return renderToStaticMarkup(
      <ThemeProvider touch="desk" density="desk">
        <ConnectionStrip state={state} now={1_757_000_000_000} />
      </ThemeProvider>,
    )
  }

  it('says so while the first read is still in flight, instead of "Updated just now"', () => {
    const html = strip({ online: true, lastSyncedAt: null })
    expect(html).toContain('Not updated yet')
    expect(html).not.toContain('Updated just now')
  })

  it('keeps the dot grey until something has actually come back', () => {
    // `moss.edge` is the "we have data" dot; `border.strong` is the quiet one.
    expect(strip({ online: true, lastSyncedAt: null })).not.toContain('#4E9270')
    expect(strip({ online: true, lastSyncedAt: 1_757_000_000_000 })).toContain('#4E9270')
    expect(strip({ online: true, lastSyncedAt: 1_757_000_000_000 })).toContain('Updated just now')
  })

  it('still names the clock time it went quiet when the read has failed', () => {
    expect(strip({ online: false, lastSyncedAt: null })).toContain('Offline since')
  })
})

/**
 * `<MapView>` (UX-00 §6.15). MapLibre needs a real canvas and a WebGL context, so what is asserted
 * here is the half that must be true WITHOUT one — because that half is what a rep on an old Android
 * browser, or a build made before the library was added, actually sees. A map that cannot draw is
 * never a blank rectangle: it is the same places, named, with a line saying why.
 */
describe('<MapView> degrades to the same places, named', () => {
  const vans: readonly MapMarker[] = [
    {
      id: 'v1',
      label: 'MH 05 AB 1234',
      detail: '3 of 11 stops · seen 6 min ago',
      latitude: 19.2437,
      longitude: 73.1355,
      tone: 'moss',
    },
    {
      id: 'v2',
      label: 'MH 04 CD 9911',
      detail: 'No signal since 4:20 pm',
      latitude: 19.21,
      longitude: 73.09,
      tone: 'ochre',
    },
  ]

  it('names every marker and its detail line', () => {
    const html = renderDesk(<MapView markers={vans} listOnly />)
    expect(html).toContain('MH 05 AB 1234')
    expect(html).toContain('3 of 11 stops · seen 6 min ago')
    expect(html).toContain('MH 04 CD 9911')
  })

  it('never paints a blank rectangle: the frame says what it is doing', () => {
    // Before the library has loaded (and this static render never loads it) the frame is not silent.
    const html = renderDesk(<MapView markers={vans} />)
    expect(html).toContain('Loading the map')
    expect(html).toContain('MH 05 AB 1234')
  })

  it('says the map is unavailable, in words, when the engine is not there', () => {
    const html = renderDesk(<MapView markers={vans} listOnly />)
    expect(html).toContain('Map not available on this device')
    expect(html).toContain('Showing the same places as a list')
  })

  it('prints the OpenStreetMap attribution wherever tiles could be drawn', () => {
    const html = renderDesk(<MapView markers={vans} />)
    expect(html).toContain('Map data © OpenStreetMap contributors')
  })

  it('with nothing to draw says so, and hides the frame rather than unmounting it', () => {
    /*
     * Hidden, not absent. MapLibre attaches to a DOM node and the markers arrive from SQLite a tick
     * after the first paint, so a frame that is conditionally RENDERED hands the map `null` on mount
     * and the map is never built — which is how the live map came up empty on the harness.
     */
    const html = renderDesk(<MapView markers={[]} />)
    expect(html).toContain('Nothing to show on the map')
    expect(html).toContain('display:none')
  })

  it('gives each row the app touch floor, not a 21 dp target', () => {
    const html = renderField(<MapView markers={vans} onSelectMarker={() => undefined} />)
    expect(html).toContain('min-height:69px')
  })
})

/**
 * A pressable list row is the whole row — on the web as well as on the phone.
 *
 * `@dos/ui/native` renders `<Pressable>` as an `RNPressable`, which is a View: column direction,
 * `alignItems: 'stretch'`, so its child fills the width. The web half rendered a row-direction flex
 * `<button>`, and a row-direction container does not stretch a child along the main axis — the child
 * sized to its content. Measured on the sales app's `My orders` at 1440 px: a 1168 px button with a
 * 195 px row inside it, the money starting at x = 304 on a short row and x = 708 on a long one, and
 * 973 px of every row dead to the touch (UX-00 §6.6: the whole row is the tap target).
 */
describe('<Pressable> stretches its child like the native half does', () => {
  it('is a stretching column, not a shrink-to-fit row', () => {
    const html = renderField(
      <Pressable onPress={() => undefined} role="row">
        <Row justify="between">
          <Txt field="bodyStrong" desk="cell">
            Sai Baba Kirana
          </Txt>
          <Money value={26_982_00} />
        </Row>
      </Pressable>,
    )
    expect(html).toContain('flex-direction:column')
    expect(html).toContain('align-items:stretch')
    // The vertical centring the old `align-items:center` provided for a short child.
    expect(html).toContain('justify-content:center')
    expect(html).toContain('width:100%')
  })

  it('still carries the app touch floor', () => {
    expect(renderField(<Pressable onPress={() => undefined}>x</Pressable>)).toContain(
      'min-height:69px',
    )
  })
})

/**
 * A segment is a tap target, so a segment is the app's touch floor.
 *
 * The button used to be `height - 4` so the group's 2 px inset kept the OUTER pill at the floor —
 * but the floor is about the thing a thumb hits. Measured 65 dp against a 69 dp floor on five
 * screens of the sales app at 375 × 812 (My orders, Catalog, Visits, AI drafts, Inbox).
 */
describe('<Segments> meets the app touch floor (UX-00 §5.2)', () => {
  const items = [
    { id: 'a', label: 'Travelling' },
    { id: 'b', label: 'All' },
    { id: 'c', label: 'Drafts' },
  ]

  it('gives each segment the field floor, not four less', () => {
    const html = renderField(<Segments items={items} value="a" onChange={() => undefined} />)
    expect(html).toContain('height:69px')
    expect(html).not.toContain('height:65px')
  })

  it('and the desk size on a desk', () => {
    const html = renderDesk(<Segments items={items} value="a" onChange={() => undefined} />)
    expect(html).toContain('height:32px')
  })
})
