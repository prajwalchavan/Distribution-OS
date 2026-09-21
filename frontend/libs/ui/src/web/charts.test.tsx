/**
 * Renders the web chart components for real (React DOM's static renderer — no browser, no
 * test-library dependency) and asserts what reaches the screen.
 *
 * DOS-125 lives here rather than in render.test.tsx: that file belongs to another lane, and the
 * design named this harness ("libs/ui web render test (existing jsdom harness, e.g.
 * web/charts.test.tsx)"). Two lanes appending to one spec file is a merge conflict, not a test.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ThemeProvider } from './ThemeProvider.js'
import { QrCode } from './charts.js'
import { Txt } from './base.js'

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

describe('<QrCode> (DOS-125)', () => {
  const intent = 'upi://pay?pa=tarsun%40okhdfcbank&am=4561.00&cu=INR&tr=PAY-01A0B1C2D3E4'

  it('renders a labelled SVG image: a white tile, one path of modules, crisp edges', () => {
    const html = renderDesk(<QrCode value={intent} label="UPI QR for ₹4,561" testID="r5-qr" />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="UPI QR for ₹4,561"')
    expect(html).toContain('data-testid="r5-qr"')
    expect(html).toContain('shape-rendering="crispEdges"')
    // Black on white in EVERY theme: a scanner needs contrast, not a palette.
    expect(html).toContain('fill="#fff"')
    expect(html).toContain('fill="#000"')
    expect(html).toContain('width="216"')
    // One path, and it carries real modules.
    expect(html.match(/<path/g)).toHaveLength(1)
    expect(/ d="M\d+ \d+h1v1h-1z/.test(html)).toBe(true)
  })

  it('draws the same tile on the phone floor, at the size the screen asks for', () => {
    const html = renderField(<QrCode value={intent} size={180} />)
    expect(html).toContain('width="180"')
    expect(html).toContain('height="180"')
    expect(html).toContain('fill="#fff"')
  })
})

describe('<Txt wrap="anywhere"> (DOS-125)', () => {
  it('breaks an unbreakable intent string instead of running it off a 390 px screen', () => {
    const html = renderField(
      <Txt field="body" desk="body" wrap="anywhere">
        upi://pay?pa=tarsun%40okhdfcbank&am=4561.00&cu=INR&tr=PAY-01A0B1C2D3E4
      </Txt>,
    )
    expect(html).toContain('overflow-wrap:anywhere')
    expect(html).toContain('word-break:break-all')
  })

  it('leaves prose alone', () => {
    const html = renderField(
      <Txt field="body" desk="body">
        Scan this in any UPI app
      </Txt>,
    )
    expect(html).not.toContain('overflow-wrap')
  })
})
