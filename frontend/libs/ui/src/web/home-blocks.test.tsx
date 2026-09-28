/**
 * @vitest-environment jsdom
 *
 * The job home, the shop and the centred screen, rendered into a real DOM and PRESSED (founder,
 * 2026-09-28: "every app opens on its work"; the sign-in page "placed in middle, not boxy").
 *
 * A DOM rather than `renderToStaticMarkup` because three of the promises are about what a tap does and
 * what happens after paint: a button on a job card never also opens the card, an empty `<CartBar>`
 * leaves no strip behind, and "More" opens in place and remembers it. Static markup has no click and
 * runs no layout effect, so none of those three can be seen under it.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { forgetMoreGroups } from '../shop-blocks.js'
import { ThemeProvider } from './ThemeProvider.js'
import { Button, TextInput } from './controls.js'
import { JobCard, JobList, MoreGroup } from './jobs.js'
import { Screen } from './layout.js'
import { Money } from './money.js'
import { BrandTile, CartBar, ProductTile, TileGrid } from './shop.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let mounted: { root: Root; container: HTMLElement } | null = null

afterEach(() => {
  const live = mounted
  mounted = null
  if (live === null) return
  act(() => {
    live.root.unmount()
  })
  live.container.remove()
})

/**
 * jsdom's window is 1024 px wide, which `useViewport()` reads as a DESK. A phone test sets 390 first,
 * so the card lays itself out the way a driver's phone does; a desk test sets 1280.
 */
function setWindowWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

function render(node: React.ReactNode, touch: 'field' | 'desk' | 'floor' = 'field'): HTMLElement {
  setWindowWidth(touch === 'desk' ? 1280 : 390)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <ThemeProvider touch={touch} density={touch === 'desk' ? 'desk' : 'field'}>
        {node}
      </ThemeProvider>,
    )
  })
  mounted = { root, container }
  return container
}

function byTestId(container: HTMLElement, id: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  if (found === null) throw new Error(`no element with data-testid="${id}"`)
  return found
}

function press(element: HTMLElement): void {
  act(() => {
    element.click()
  })
}

// ---------------------------------------------------------------------------
// JobCard
// ---------------------------------------------------------------------------

describe('<JobCard> — one job, its buttons on it', () => {
  function card(
    calls: string[],
    state: 'next' | 'default' | 'done' = 'default',
  ): React.JSX.Element {
    return (
      <JobCard
        testID="stop"
        title="Shree Ganesh Kirana"
        subtitle="Station Road · 6 items"
        trailing={<Money value={18_420_00} />}
        chip={{ label: 'Waiting', family: 'ochre' }}
        state={state}
        onPress={() => calls.push('card')}
        primary={{
          label: 'Delivered, all items',
          onPress: () => calls.push('primary'),
          testID: 'stop-delivered',
        }}
        secondary={[
          { label: 'Some items', onPress: () => calls.push('partial'), testID: 'stop-partial' },
          {
            label: 'Could not deliver',
            onPress: () => calls.push('failed'),
            testID: 'stop-failed',
          },
          { label: 'A third', onPress: () => calls.push('third'), testID: 'stop-third' },
        ]}
      />
    )
  }

  it('says what the job is, where, how much and its state in one word', () => {
    const view = render(card([]))
    const text = view.textContent ?? ''
    expect(text).toContain('Shree Ganesh Kirana')
    expect(text).toContain('Station Road · 6 items')
    expect(text).toContain('₹18,420.00')
    expect(text).toContain('Waiting')
  })

  it('pressing a button does its job and NEVER also opens the card', () => {
    const calls: string[] = []
    const view = render(card(calls))
    press(byTestId(view, 'stop-delivered'))
    press(byTestId(view, 'stop-partial'))
    press(byTestId(view, 'stop-failed'))
    expect(calls).toEqual(['primary', 'partial', 'failed'])
  })

  it('pressing the body opens the detail screen that exists today', () => {
    const calls: string[] = []
    const view = render(card(calls))
    press(byTestId(view, 'stop-open'))
    expect(calls).toEqual(['card'])
  })

  it('never nests a button inside another button', () => {
    const view = render(card([]))
    expect(view.querySelectorAll('button button')).toHaveLength(0)
  })

  it('carries one primary and at most two secondaries: a third is dropped, not squeezed', () => {
    const view = render(card([]))
    expect(view.querySelector('[data-testid="stop-third"]')).toBeNull()
    expect(byTestId(view, 'stop-delivered').className).toContain('dos-btn-primary')
    expect(byTestId(view, 'stop-partial').className).toContain('dos-btn-secondary')
  })

  it('draws its buttons at the role s touch floor', () => {
    const field = render(card([]), 'field')
    expect(byTestId(field, 'stop-delivered').style.height).toBe('69px')
  })

  it('a warehouse card keeps the 76 dp floor and 25 dp between adjacent buttons', () => {
    const view = render(card([]), 'floor')
    const delivered = byTestId(view, 'stop-delivered')
    expect(delivered.style.height).toBe('76px')
    // The actions column: primary, then the row of secondaries, 25 px apart.
    const column = delivered.parentElement?.parentElement
    // jsdom's style object drops the `gap` shorthand; the attribute keeps what React wrote.
    expect(column?.getAttribute('style')).toContain('gap: 25px')
  })

  it('on a desk the buttons stand in one row at the right, the next step last', () => {
    const view = render(card([]), 'desk')
    const order = [...byTestId(view, 'stop').querySelectorAll('button')].map((b) =>
      b.getAttribute('data-testid'),
    )
    expect(order).toEqual(['stop-open', 'stop-partial', 'stop-failed', 'stop-delivered'])
    expect(byTestId(view, 'stop').style.flexDirection).toBe('row')
    expect(byTestId(view, 'stop-delivered').style.height).toBe('32px')
  })

  it('on a phone the next step is full width, above the other two sharing a row', () => {
    const view = render(card([]), 'field')
    expect(byTestId(view, 'stop').style.flexDirection).toBe('column')
    const primaryWrap = byTestId(view, 'stop-delivered').parentElement as HTMLElement
    expect(primaryWrap.style.width).toBe('100%')
    const pair = byTestId(view, 'stop-partial').parentElement?.parentElement?.parentElement
    expect(pair?.contains(byTestId(view, 'stop-failed'))).toBe(true)
    expect(pair?.contains(byTestId(view, 'stop-delivered'))).toBe(false)
  })

  it('marks the one to do now, in words as well as colour', () => {
    const view = render(card([], 'next'))
    expect(view.textContent).toContain('Do this next')
    expect(byTestId(view, 'stop').getAttribute('data-state')).toBe('next')
  })

  it('folds a done job to one quiet line with no buttons, still opening the detail', () => {
    const calls: string[] = []
    const view = render(card(calls, 'done'))
    expect(view.querySelector('[data-testid="stop-delivered"]')).toBeNull()
    expect(view.querySelectorAll('button')).toHaveLength(1)
    expect(view.textContent).toContain('Shree Ganesh Kirana')
    expect(view.textContent).toContain('Waiting')
    expect(view.textContent).not.toContain('Station Road')
    press(byTestId(view, 'stop'))
    expect(calls).toEqual(['card'])
  })

  it('prints why a button is off as text under it, never only as a tooltip', () => {
    const view = render(
      <JobCard
        title="GL/1688"
        primary={{
          label: 'Approve',
          onPress: () => undefined,
          disabled: true,
          disabledReason: 'Waiting for the count',
          testID: 'approve',
        }}
      />,
    )
    expect((byTestId(view, 'approve') as HTMLButtonElement).disabled).toBe(true)
    expect(view.textContent).toContain('Waiting for the count')
    expect(view.querySelector('[title]')).toBeNull()
  })

  it('shows a spinner and swallows the second tap while the write is in flight', () => {
    const calls: string[] = []
    const view = render(
      <JobCard
        title="Om Sai Provision"
        primary={{
          label: 'Mark delivered',
          onPress: () => calls.push('write'),
          loading: true,
          testID: 'busy',
        }}
      />,
    )
    press(byTestId(view, 'busy'))
    expect(calls).toEqual([])
    expect(byTestId(view, 'busy').getAttribute('aria-busy')).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// JobList
// ---------------------------------------------------------------------------

describe('<JobList> — the jobs in order, one slim line above', () => {
  it('prints the one summary line, then the cards in the order given', () => {
    const view = render(
      <JobList summary="1 of 3 delivered · ₹18,420 to collect" testID="jobs">
        <JobCard key="a" title="First shop" />
        <JobCard key="b" title="Second shop" />
      </JobList>,
    )
    const text = view.textContent ?? ''
    expect(text.indexOf('1 of 3 delivered')).toBeLessThan(text.indexOf('First shop'))
    expect(text.indexOf('First shop')).toBeLessThan(text.indexOf('Second shop'))
    expect(view.querySelectorAll('[role="listitem"]')).toHaveLength(2)
  })

  it('says "Nothing waiting" and offers ONE action when there is no job', () => {
    const calls: string[] = []
    const view = render(
      <JobList emptyActionLabel="See past trips" onEmptyAction={() => calls.push('past')}>
        {null}
        {false}
      </JobList>,
    )
    expect(view.textContent).toContain('Nothing waiting')
    const buttons = view.querySelectorAll('button')
    expect(buttons).toHaveLength(1)
    press(buttons[0] as HTMLElement)
    expect(calls).toEqual(['past'])
  })

  it('shows placeholders, not an empty state, while the first read is in flight', () => {
    const view = render(<JobList loading />)
    expect(view.textContent).not.toContain('Nothing waiting')
    expect(view.querySelectorAll('.dos-skeleton').length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// MoreGroup
// ---------------------------------------------------------------------------

describe('<MoreGroup> — everything that is not a job, folded below the list', () => {
  beforeEach(() => {
    forgetMoreGroups()
  })

  it('starts closed, with its title and how many things are inside', () => {
    const view = render(
      <MoreGroup id="t.more" count={6} testID="more">
        <span data-testid="inside">Money owed</span>
      </MoreGroup>,
    )
    expect(view.textContent).toContain('More')
    expect(view.textContent).toContain('6')
    expect(view.querySelector('[data-testid="inside"]')).toBeNull()
    expect(byTestId(view, 'more-toggle').getAttribute('aria-expanded')).toBe('false')
  })

  it('opens in place and remembers it for the next time the home is drawn', () => {
    const first = render(
      <MoreGroup id="t.more" count={6} testID="more">
        <span data-testid="inside">Money owed</span>
      </MoreGroup>,
    )
    press(byTestId(first, 'more-toggle'))
    expect(first.querySelector('[data-testid="inside"]')).not.toBeNull()
    expect(byTestId(first, 'more-toggle').getAttribute('aria-expanded')).toBe('true')
    act(() => {
      mounted?.root.unmount()
    })
    mounted = null

    const again = render(
      <MoreGroup id="t.more" count={6} testID="more">
        <span data-testid="inside">Money owed</span>
      </MoreGroup>,
    )
    expect(again.querySelector('[data-testid="inside"]')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The shop
// ---------------------------------------------------------------------------

describe('<ProductTile> — a shopping app, before there are photographs', () => {
  function tile(pieces: number, seen: number[], onOpenPieces?: () => void): React.JSX.Element {
    return (
      <ProductTile
        testID="campa"
        name="Campa Cola 750 ml"
        brand="Campa"
        pack="24 pc case"
        rate={34_00}
        rateUnit="a piece"
        mrp={40_00}
        offer="1 free per 10"
        pieces={pieces}
        caseSize={24}
        onChange={(next) => seen.push(next)}
        {...(onOpenPieces === undefined ? {} : { onOpenPieces })}
      />
    )
  }

  it('shows the brand s initial, the name, the pack, the rate, the MRP and the offer', () => {
    const view = render(tile(0, []))
    const text = view.textContent ?? ''
    expect(text).toContain('C')
    expect(text).toContain('Campa Cola 750 ml')
    expect(text).toContain('24 pc case')
    expect(text).toContain('₹34.00')
    expect(text).toContain('a piece')
    expect(text).toContain('MRP ₹40.00')
    expect(text).toContain('1 free per 10')
  })

  it('a large + adds one case', () => {
    const seen: number[] = []
    const view = render(tile(0, seen))
    const add = byTestId(view, 'campa-add')
    expect(add.textContent).toContain('Add')
    expect(add.textContent).toContain('+')
    expect(add.style.height).toBe('69px')
    press(add)
    expect(seen).toEqual([24])
  })

  it('once a quantity is set, the + becomes the kit s own stepper, Pieces entry included', () => {
    const seen: number[] = []
    let opened = 0
    const view = render(
      tile(48, seen, () => {
        opened += 1
      }),
    )
    expect(view.querySelector('[data-testid="campa-add"]')).toBeNull()
    expect(view.textContent).toContain('2 cs = 48 pc')
    press(view.querySelector<HTMLElement>('[aria-label="One case more"]') as HTMLElement)
    press(view.querySelector<HTMLElement>('[aria-label="One case less"]') as HTMLElement)
    expect(seen).toEqual([72, 24])
    const pieces = [...view.querySelectorAll('button')].find((b) => b.textContent === 'Pieces')
    expect(pieces).toBeDefined()
    press(pieces as HTMLElement)
    expect(opened).toBe(1)
  })

  it('keeps − and + at the floor with 19 dp between them, stacked to fit two tiles across', () => {
    const view = render(tile(48, []))
    const more = view.querySelector<HTMLElement>('[aria-label="One case more"]') as HTMLElement
    expect(more.style.height).toBe('69px')
    expect(more.parentElement?.getAttribute('style')).toContain('gap: 19px')
  })

  it('prints the em dash for a rate it does not know, never ₹0.00', () => {
    const view = render(
      <ProductTile
        name="MOM Makhana 60 g"
        brand="MOM"
        rate={null}
        pieces={0}
        caseSize={30}
        onChange={() => undefined}
      />,
    )
    expect(view.textContent).toContain('—')
    expect(view.textContent).not.toContain('₹0.00')
  })
})

describe('<TileGrid> and <BrandTile>', () => {
  it('lays tiles out in equal columns with 19 dp between two tiles buttons', () => {
    const view = render(
      <TileGrid testID="grid">
        <span>a</span>
        <span>b</span>
      </TileGrid>,
    )
    const grid = byTestId(view, 'grid')
    expect(grid.style.display).toBe('grid')
    expect(grid.style.columnGap).toBe('19px')
    expect(Number(grid.getAttribute('data-columns'))).toBeGreaterThanOrEqual(2)
  })

  it('a brand tile is one button: its initial on its colour, its name, and what it holds', () => {
    const calls: string[] = []
    const view = render(
      <BrandTile
        name="Too Yumm"
        detail="12 items"
        onPress={() => calls.push('brand')}
        testID="brand"
      />,
    )
    const tileButton = byTestId(view, 'brand')
    expect(tileButton.tagName).toBe('BUTTON')
    expect(tileButton.textContent).toContain('T')
    expect(tileButton.textContent).toContain('Too Yumm')
    expect(tileButton.textContent).toContain('12 items')
    press(tileButton)
    expect(calls).toEqual(['brand'])
  })
})

describe('<CartBar> — the bottom of the shop', () => {
  function shop(count: number): React.JSX.Element {
    return (
      <Screen
        testID="shop"
        bottomBar={
          <CartBar
            count={count}
            total={1_564_00}
            actionLabel="See my order"
            onAction={() => undefined}
            testID="cart"
          />
        }
      >
        <span>tiles</span>
      </Screen>
    )
  }

  it('says how many items, the total and one button', () => {
    const view = render(shop(3))
    const bar = byTestId(view, 'cart')
    expect(bar.textContent).toContain('3 items')
    expect(bar.textContent).toContain('₹1,564.00')
    expect(byTestId(view, 'cart-action').textContent).toContain('See my order')
    expect(render(shop(1)).textContent).toContain('1 item')
  })

  it('an empty cart draws no bar at all: not the content, and not the screen s strip around it', () => {
    const view = render(shop(0))
    expect(view.querySelector('[data-testid="cart"]')).toBeNull()
    const strip = byTestId(view, 'shop').lastElementChild as HTMLElement
    expect(strip.style.display).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// <Screen centered> — the sign-in page and its three neighbours
// ---------------------------------------------------------------------------

describe('<Screen centered> — in the middle of the window, not boxy (founder, 2026-09-28)', () => {
  function signIn(touch: 'desk' | 'field'): HTMLElement {
    return render(
      <Screen centered title="Distribution OS" subtitle="Sign in to start your day." testID="s">
        <TextInput label="Username" value="" onChange={() => undefined} testID="u" />
        <TextInput label="Password" value="" onChange={() => undefined} secure testID="p" />
        <Button label="Sign in" variant="primary" onPress={() => undefined} testID="go" />
      </Screen>,
      touch,
    )
  }

  it('has no header band and no hairline: the heading is part of the centred column', () => {
    const view = signIn('desk')
    const screen = byTestId(view, 's')
    expect(screen.getAttribute('data-centered')).toBe('true')
    expect(screen.querySelector('header')?.style.borderBottom ?? '').toBe('')
    const title = screen.querySelector('h1') as HTMLElement
    expect(title.textContent).toBe('Distribution OS')
    expect(title.style.textAlign).toBe('center')
    expect(view.textContent).toContain('Sign in to start your day.')
  })

  it('centres the column both ways with auto margins, and scrolls it when a keyboard squeezes it', () => {
    const view = signIn('field')
    const screen = byTestId(view, 's')
    expect(screen.style.height).toBe('100dvh')
    const scroller = screen.firstElementChild as HTMLElement
    expect(scroller.style.overflowY).toBe('auto')
    const column = scroller.firstElementChild as HTMLElement
    expect(column.style.marginTop).toBe('auto')
    expect(column.style.marginBottom).toBe('auto')
    expect(column.style.marginLeft).toBe('auto')
    expect(column.style.marginRight).toBe('auto')
  })

  it('lifts the desk s 32 px fields and button to 52 px, with soft corners', () => {
    const view = signIn('desk')
    expect(byTestId(view, 'u').style.height).toBe('52px')
    expect(byTestId(view, 'u').style.borderRadius).toBe('12px')
    expect(byTestId(view, 'go').style.height).toBe('52px')
    expect(byTestId(view, 'go').style.borderRadius).toBe('12px')
  })

  it('never lowers a phone s own floor: 69 stays 69', () => {
    const view = signIn('field')
    expect(byTestId(view, 'u').style.height).toBe('69px')
    expect(byTestId(view, 'go').style.height).toBe('69px')
  })

  it('keeps the password Show / Hide working', () => {
    const view = signIn('field')
    const field = byTestId(view, 'p') as HTMLInputElement
    const reveal = byTestId(view, 'p-reveal')
    expect(field.type).toBe('password')
    press(reveal)
    expect(field.type).toBe('text')
    press(reveal)
    expect(field.type).toBe('password')
  })

  it('leaves every other screen exactly as it was: a header band, 32 px desk fields', () => {
    const view = render(
      <Screen title="Orders" testID="plain">
        <TextInput label="Shop" value="" onChange={() => undefined} testID="f" />
      </Screen>,
      'desk',
    )
    const screen = byTestId(view, 'plain')
    expect(screen.getAttribute('data-centered')).toBeNull()
    expect(screen.querySelector('header')?.style.borderBottom).toContain('1px solid')
    expect(byTestId(view, 'f').style.height).toBe('32px')
  })
})
