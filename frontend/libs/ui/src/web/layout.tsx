/**
 * The layout vocabulary of docs/08 section 0, for React DOM.
 *
 * `@dos/ui/native` exports the same ten names against the same prop types (`src/types.ts`), so one
 * screen file lays out identically in a browser and on a phone. This is the ONLY structural surface a
 * screen has: no `div`, no `View`, no CSS class, no style object.
 *
 * What "the same" does NOT mean is "the same element". The web renderer spends its difference on the
 * things a distributor's owner and accountant use all day — a real `<a href>` that can be
 * middle-clicked, a `<main>`/`<nav>` outline, keyboard focus, text selection, and a print stylesheet.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { useTheme } from '../theme.js'
import { gap, layout, radius as radii, space, type SemanticColors } from '../tokens.js'
import type {
  BorderEdge,
  BorderTone,
  BoxProps,
  ImgProps,
  LinkProps,
  ListProps,
  PressableProps,
  RadiusName,
  RowProps,
  ScreenProps,
  ScrollProps,
  SpaceStep,
  StackProps,
  SurfaceName,
} from '../types.js'
import { Txt } from './base.js'

// ---------------------------------------------------------------------------
// Token readers — a layout prop is a token NAME; this is where it becomes a value.
// ---------------------------------------------------------------------------

function px(step: SpaceStep | undefined): number | undefined {
  return step === undefined ? undefined : space[step]
}

function surface(colors: SemanticColors, name: SurfaceName | undefined): string | undefined {
  switch (name) {
    case 'ground':
      return colors.bg.ground
    case 'surface':
      return colors.bg.surface
    case 'raised':
      return colors.bg.raised
    case 'sunken':
      return colors.bg.sunken
    default:
      return undefined
  }
}

function corner(name: RadiusName | undefined): number | undefined {
  if (name === undefined || name === 'none') return undefined
  return radii[name]
}

function borderColor(colors: SemanticColors, tone: BorderTone | undefined): string {
  if (tone === 'strong') return colors.border.strong
  if (tone === 'faint') return colors.border.faint
  return colors.border.hairline
}

function borderStyle(
  colors: SemanticColors,
  edge: BorderEdge | undefined,
  tone: BorderTone | undefined,
): CSSProperties {
  if (edge === undefined || edge === 'none') return {}
  const line = `1px solid ${borderColor(colors, tone)}`
  switch (edge) {
    case 'all':
      return { border: line }
    case 'top':
      return { borderTop: line }
    case 'bottom':
      return { borderBottom: line }
    case 'left':
      return { borderLeft: line }
    case 'right':
      return { borderRight: line }
  }
}

const ALIGN: Readonly<Record<string, string>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
}

const JUSTIFY: Readonly<Record<string, string>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
}

function boxStyle(colors: SemanticColors, props: BoxProps): CSSProperties {
  const padAll = px(props.pad)
  return {
    boxSizing: 'border-box',
    paddingTop: px(props.padY) ?? padAll,
    paddingBottom: px(props.padY) ?? padAll,
    paddingLeft: px(props.padX) ?? padAll,
    paddingRight: px(props.padX) ?? padAll,
    marginTop: px(props.marginTop),
    background: surface(colors, props.background),
    borderRadius: corner(props.radius),
    flexGrow: props.grow === true ? 1 : undefined,
    flexShrink: props.grow === true ? 1 : undefined,
    flexBasis: props.grow === true ? 0 : undefined,
    minWidth: props.grow === true ? 0 : undefined,
    width: props.width === 'full' ? '100%' : props.width,
    height: props.height,
    minHeight: props.minHeight,
    maxWidth: props.maxWidth,
    alignSelf: props.align === undefined ? undefined : ALIGN[props.align],
    marginLeft: props.center === true ? 'auto' : undefined,
    marginRight: props.center === true ? 'auto' : undefined,
    ...borderStyle(colors, props.border, props.borderTone),
  }
}

// ---------------------------------------------------------------------------
// Box, Stack, Row
// ---------------------------------------------------------------------------

export function Box(props: BoxProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <div data-testid={props.testID} style={boxStyle(colors, props)}>
      {props.children}
    </div>
  )
}

export function Stack(props: StackProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <div
      data-testid={props.testID}
      style={{
        ...boxStyle(colors, props),
        display: 'flex',
        flexDirection: 'column',
        gap: px(props.gap),
        alignItems: props.align === undefined ? undefined : ALIGN[props.align],
        /*
         * `align` on a Stack or a Row aligns its CHILDREN — never itself.
         *
         * `boxStyle` maps `align` to `alignSelf`, which is right for a `<Box>` (it has no flex
         * children to align) and wrong here: `<Row align="center">` inside a column then centred the
         * ROW in its parent and shrank it to its content. Every list row in the sales app came out
         * 161 px wide in a 343 px column with the money floating in the middle of the screen instead
         * of at the right edge, and the "whole row is the tap target" rule of UX-00 §6.6 quietly
         * stopped being true. `center` is the prop that moves a box in its parent, and it still does.
         */
        alignSelf: props.center === true ? undefined : 'stretch',
      }}
    >
      {props.children}
    </div>
  )
}

export function Row(props: RowProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <div
      data-testid={props.testID}
      style={{
        ...boxStyle(colors, props),
        display: 'flex',
        flexDirection: 'row',
        gap: px(props.gap),
        alignItems: ALIGN[props.align ?? 'center'],
        justifyContent: props.justify === undefined ? undefined : JUSTIFY[props.justify],
        flexWrap: props.wrap === true ? 'wrap' : undefined,
        // See `<Stack>`: `align` is for the children; `center` is the one that moves the box itself.
        alignSelf: props.center === true ? undefined : 'stretch',
      }}
    >
      {props.children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scroll
// ---------------------------------------------------------------------------

/** Fires `onEndReached` once per approach to the end, never on every scroll event. */
function useEndReached(
  onEndReached: (() => void) | undefined,
): (event: { currentTarget: HTMLElement }) => void {
  const armed = useRef(true)
  return useCallback(
    (event: { currentTarget: HTMLElement }) => {
      if (!onEndReached) return
      const el = event.currentTarget
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remaining < el.clientHeight * 0.5) {
        if (armed.current) {
          armed.current = false
          onEndReached()
        }
      } else {
        armed.current = true
      }
    },
    [onEndReached],
  )
}

export function Scroll(props: ScrollProps): React.JSX.Element {
  const onScroll = useEndReached(props.onEndReached)
  return (
    <div
      data-testid={props.testID}
      onScroll={onScroll}
      style={{
        overflowX: props.horizontal === true ? 'auto' : 'hidden',
        overflowY: props.horizontal === true ? 'hidden' : 'auto',
        display: props.horizontal === true ? 'flex' : undefined,
        flexDirection: props.horizontal === true ? 'row' : undefined,
        flex: props.grow === true ? 1 : undefined,
        minHeight: 0,
        padding: px(props.pad),
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {props.children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// List — a windowed DOM list (the web half of the virtualisation contract)
// ---------------------------------------------------------------------------

const OVERSCAN = 6

/**
 * Mounts only the rows in view plus six either side. Rows keep their real height through a spacer
 * above and below, so the scrollbar tells the truth and `Cmd+F` still finds what is on screen.
 *
 * `itemHeight` is required maths, not decoration: without it there is no way to know which rows are
 * in view without measuring every one of them, which is exactly the cost virtualisation exists to
 * avoid. A row taller than `itemHeight` is clipped rather than allowed to shift the run.
 */
export function List<Item>(props: ListProps<Item>): React.JSX.Element {
  const {
    items,
    keyExtractor,
    renderItem,
    itemHeight = 64,
    onEndReached,
    separator = false,
    header,
    footer,
    empty,
    grow = true,
    testID,
  } = props
  const { colors } = useTheme()
  const viewport = useRef<HTMLDivElement | null>(null)
  const [range, setRange] = useState({ start: 0, end: 24 })
  const armed = useRef(true)

  const measure = useCallback((): void => {
    const el = viewport.current
    if (!el) return
    const first = Math.max(0, Math.floor(el.scrollTop / itemHeight) - OVERSCAN)
    const visible = Math.ceil(el.clientHeight / itemHeight) + OVERSCAN * 2
    setRange({ start: first, end: first + visible })
    if (!onEndReached) return
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
    if (remaining < el.clientHeight) {
      if (armed.current) {
        armed.current = false
        onEndReached()
      }
    } else {
      armed.current = true
    }
  }, [itemHeight, onEndReached])

  useLayoutEffect(() => {
    measure()
  }, [measure, items.length])

  const window = useMemo(
    () => items.slice(range.start, Math.min(range.end, items.length)),
    [items, range.start, range.end],
  )
  const above = range.start * itemHeight
  const below = Math.max(0, (items.length - range.start - window.length) * itemHeight)

  if (items.length === 0 && empty !== undefined) {
    return (
      <div data-testid={testID} style={{ flex: grow ? 1 : undefined, minHeight: 0 }}>
        {header}
        {empty}
      </div>
    )
  }

  return (
    <div
      data-testid={testID}
      ref={viewport}
      onScroll={measure}
      style={{
        flex: grow ? 1 : undefined,
        minHeight: 0,
        overflowY: grow ? 'auto' : 'visible',
      }}
    >
      {header}
      <div style={{ height: above }} aria-hidden />
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {window.map((item, i) => {
          const index = range.start + i
          return (
            <li
              key={keyExtractor(item, index)}
              style={{
                minHeight: itemHeight,
                overflow: 'hidden',
                borderBottom:
                  separator && index < items.length - 1
                    ? `1px solid ${colors.border.faint}`
                    : undefined,
              }}
            >
              {renderItem(item, index)}
            </li>
          )
        })}
      </ul>
      <div style={{ height: below }} aria-hidden />
      {footer}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pressable, Img, Link
// ---------------------------------------------------------------------------

export function Pressable(props: PressableProps): React.JSX.Element {
  const { touchSize } = useTheme()
  const {
    onPress,
    children,
    disabled = false,
    label,
    minHeight = touchSize,
    grow = false,
    role = 'button',
    testID,
  } = props
  return (
    <button
      type="button"
      data-testid={testID}
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className="dos-row"
      data-pressable={disabled ? 'false' : 'true'}
      style={{
        minHeight,
        width: '100%',
        flex: grow ? 1 : undefined,
        padding: 0,
        background: 'transparent',
        border: 0,
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        /*
         * A COLUMN that stretches its child, exactly like the native half.
         *
         * `@dos/ui/native` renders this as an `RNPressable` with `justifyContent: 'center'` — a View,
         * so `flexDirection: 'column'` and `alignItems: 'stretch'` by default, and its child fills the
         * width. The web half said `flexDirection: row` (the CSS default for `display: flex`) with
         * `alignItems: 'center'`, and a row-direction flex container does NOT stretch a child along
         * the main axis: the child sizes to its content, and `alignSelf: 'stretch'` on that child is
         * about the CROSS axis, so it cannot rescue it either.
         *
         * Measured on the sales app's `My orders` at 1440 px: the `<button>` was 1168 px wide and the
         * row inside it 195 px, so the money column started at x = 304 on a short row and x = 708 on a
         * row whose note ran long — no money column at all, and 973 px of every row was dead to the
         * touch even though UX-00 §6.6 says the whole row is the tap target. It is the same defect on
         * a phone, where it costs a rep the first tap of every order.
         *
         * `justifyContent: 'center'` keeps the vertical centring the old `alignItems: 'center'` gave a
         * child shorter than `minHeight`.
         */
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'center',
      }}
      data-role={role}
    >
      {children}
    </button>
  )
}

export function Img(props: ImgProps): React.JSX.Element {
  const { source, alt, width, height, radius, fit = 'cover', testID } = props
  return (
    <img
      data-testid={testID}
      src={source}
      alt={alt}
      width={width}
      height={height}
      style={{
        width,
        height,
        borderRadius: radius === 'full' ? radii.full : corner(radius),
        objectFit: fit,
        display: 'block',
      }}
    />
  )
}

/**
 * A real anchor. `onNavigate` from the router intercepts the plain left click; every other gesture —
 * middle click, Cmd-click, "copy link address", the browser's own history — is the browser's, which
 * is half the reason the desk apps render to a DOM at all.
 *
 * `text` is a standalone accent word ("Open the rows behind this") and is therefore a TAP TARGET: it
 * carries `theme.touchSize`, the one floor of UX-00 section 5.2, exactly as `<Button>` and the shell's
 * menu rows do. It read 21 dp on a 375 px phone before this — a third of the 63 dp owner floor — and
 * the native half had the condition inverted, giving the floor to `plain` (which wraps something that
 * already has its own size) and nothing to `text`. `plain` keeps no minimum on purpose.
 */
export function Link(props: LinkProps): React.JSX.Element {
  const { colors, touchSize } = useTheme()
  const { href, children, replace = false, variant = 'text', testID } = props
  const navigate = useRouterNavigate()
  return (
    <a
      data-testid={testID}
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        if (!navigate) return
        event.preventDefault()
        navigate(href, replace)
      }}
      style={
        variant === 'text'
          ? {
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: touchSize,
              color: colors.accent.fg,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }
          : { color: 'inherit', textDecoration: 'none' }
      }
    >
      {children}
    </a>
  )
}

// ---------------------------------------------------------------------------
// Router bridge
// ---------------------------------------------------------------------------

type Navigate = (href: string, replace: boolean) => void

let routerNavigate: Navigate | null = null

/**
 * expo-router lives in the app, not the kit — `@dos/ui` must stay installable in a plain Vitest run
 * and in the gallery, neither of which has a router. The app's root layout calls this once with
 * `router.push` / `router.replace`; until it does, `<Link>` is an ordinary anchor and a full page
 * load, which is the correct degraded behaviour rather than a dead control.
 */
export function setRouterNavigate(navigate: Navigate | null): void {
  routerNavigate = navigate
}

function useRouterNavigate(): Navigate | null {
  return routerNavigate
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * One screen's frame. On desk it is the page header of UX-00 section 8.1 — title left, actions right,
 * a hairline under, content at the reading width. On a phone it is section 8.2 — context line, title,
 * chips, the scrolling body, and the bottom bar above the home indicator.
 *
 * The insets are the browser's `env(safe-area-inset-*)`, which is what a home-screen PWA on an iPhone
 * actually needs; the native renderer reads the same idea from `react-native-safe-area-context`.
 */
export function Screen(props: ScreenProps): React.JSX.Element {
  const { colors, density, touch } = useTheme()
  const {
    title,
    context,
    actions,
    chips,
    scroll = true,
    bottomBar,
    readingWidth = true,
    pad,
    children,
    testID,
  } = props
  const desk = density === 'desk'
  const padding = px(pad) ?? (desk ? layout.deskPadding : layout.fieldGutter)
  const hasHeader = title !== undefined || context !== undefined || actions !== undefined
  const barGap = touch === 'floor' ? gap.warehouse : space[3]

  const body = (
    <div
      style={{
        padding,
        maxWidth: readingWidth ? layout.deskMaxWidth : undefined,
        marginLeft: readingWidth ? 'auto' : undefined,
        marginRight: readingWidth ? 'auto' : undefined,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  )

  return (
    <section
      data-testid={testID}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        background: colors.bg.ground,
      }}
    >
      {hasHeader ? (
        <header
          className="dos-no-print"
          style={{
            // Longhands only: React warns (and can paint the wrong box) when a shorthand and a
            // longhand for the same value both change in a rerender, which is what a viewport
            // change is now that one build serves desk and phone.
            // `--dos-inset-top` is how a shell says "I already spent this edge" (the phone shell's
            // header eats the notch). Unset — a screen that IS the window, like sign-in — it falls
            // through to the real inset, so the notch is honoured exactly once.
            paddingTop: `calc(${String(space[3])}px + var(--dos-inset-top, env(safe-area-inset-top, 0px)))`,
            paddingBottom: space[3],
            paddingLeft: padding,
            paddingRight: padding,
            background: desk ? colors.bg.ground : colors.bg.surface,
            borderBottom: `1px solid ${colors.border.hairline}`,
          }}
        >
          <div
            style={{
              maxWidth: readingWidth ? layout.deskMaxWidth : undefined,
              marginLeft: readingWidth ? 'auto' : undefined,
              marginRight: readingWidth ? 'auto' : undefined,
              display: 'flex',
              flexDirection: desk ? 'row' : 'column',
              alignItems: desk ? 'center' : 'stretch',
              justifyContent: 'space-between',
              gap: space[2],
            }}
          >
            <div>
              {context === undefined ? null : (
                <Txt field="label" desk="meta" color={colors.text.secondary} as="div">
                  {context}
                </Txt>
              )}
              {title === undefined ? null : (
                <Txt field="title" desk="pageTitle" as="h1">
                  {title}
                </Txt>
              )}
            </div>
            {actions === undefined ? null : (
              /*
               * Wraps. A page header carries a range switch, an export and sometimes a third verb;
               * on a 375 px phone (where UX-00 §8.2 puts them UNDER the title) an unwrapped row ran
               * "Export CSV" and "Rebuild ageing" off the right edge of the money screen, where a
               * page cannot be scrolled sideways to reach them.
               */
              <div
                style={{
                  display: 'flex',
                  gap: space[2],
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  justifyContent: desk ? 'flex-end' : 'flex-start',
                }}
              >
                {actions}
              </div>
            )}
          </div>
          {chips === undefined ? null : (
            <div
              style={{
                display: 'flex',
                gap: space[2],
                marginTop: space[2],
                flexWrap: 'wrap',
              }}
            >
              {chips}
            </div>
          )}
        </header>
      ) : null}

      {scroll ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{body}</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {body}
        </div>
      )}

      {bottomBar === undefined ? null : (
        <div
          className="dos-no-print"
          style={{
            background: colors.bg.surface,
            borderTop: `1px solid ${colors.border.hairline}`,
            paddingTop: space[3],
            /*
             * On a warehouse phone the bar's own buttons and the shell's tab bar are adjacent
             * targets, and UX-00 §5.2 puts 25 dp between them there. Measured before this: the gate
             * count's "Scan" sat 13 px above "Inbound". Only the 76 dp floor moves; every other
             * app keeps the 12 px it was measured with.
             */
            paddingBottom: `calc(${String(barGap)}px + var(--dos-inset-bottom, env(safe-area-inset-bottom, 0px)))`,
            paddingLeft: padding,
            paddingRight: padding,
          }}
        >
          <div
            style={{
              maxWidth: readingWidth ? layout.deskMaxWidth : undefined,
              marginLeft: readingWidth ? 'auto' : undefined,
              marginRight: readingWidth ? 'auto' : undefined,
            }}
          >
            {bottomBar}
          </div>
        </div>
      )}
    </section>
  )
}
