/**
 * Distribution OS design tokens — layout A "Ledger".
 *
 * This file is `docs/design/UX-00-design-system.md` sections 3, 4, 5 and 7 as code, and it is the ONLY place a
 * hex literal is allowed to live (UX-00 section 16). Screens use the SEMANTIC names below; the
 * primitive ramps of UX-00 section 3.1 are deliberately private to this module and are never exported.
 *
 * Every semantic name exists in both themes. Light is the shipped theme; the dark set is the
 * desk-only v2 theme of UX-00 section 3.2 (field apps never read system appearance, UX-01 U1).
 */

// ---------------------------------------------------------------------------
// Primitive ramps — PRIVATE (UX-00 section 3.1). Not exported: a screen may never name one.
// ---------------------------------------------------------------------------

/** The warm neutral of direction A. `paper950` is the ink. */
const paper = {
  0: '#FFFFFF',
  50: '#F8F8F6',
  100: '#F2F2EF',
  200: '#EAEAE5',
  300: '#D5D6CF',
  400: '#B3B5AC',
  500: '#8E9188',
  600: '#6A6E66',
  700: '#4B4F49',
  800: '#3F433D',
  900: '#2A2D28',
  950: '#1B1E1A',
} as const

/** The one accent. Petrol is action and selection, nothing else. */
const petrol = {
  50: '#EBF3F4',
  100: '#D6E7E9',
  200: '#B7CFD1',
  300: '#7FB3B8',
  500: '#3E8E97',
  600: '#0E6E78',
  700: '#0B5A63',
  800: '#07454C',
  onDark: '#5FC7D2',
} as const

/** Dark desk surfaces (v2). */
const slate = {
  950: '#14161A',
  900: '#1B1E22',
  800: '#20252A',
  700: '#2B2F33',
  500: '#6E767F',
} as const

// ---------------------------------------------------------------------------
// Status families (UX-00 section 3.1, third table)
// ---------------------------------------------------------------------------

/**
 * A status family. `tint` fills, `edge` draws bars and outlines (>= 3:1 on its own tint),
 * `fg` sets text on the tint (>= 7:1), `solid` is the loud variant's fill with white on it.
 */
export interface StatusTone {
  /** Chip and track fill. */
  readonly tint: string
  /** Bar fill, outline, 3:1 non-text mark. */
  readonly edge: string
  /** Text and icon on `tint`. */
  readonly fg: string
  /** Fill of the `solid` variant; white text sits on it. */
  readonly solid: string
}

/** The five status families. `status` is the family name a screen names; never a raw hue. */
export type StatusFamily = 'moss' | 'ochre' | 'clay' | 'brick' | 'neutral'

const lightStatus: Readonly<Record<StatusFamily, StatusTone>> = {
  moss: { tint: '#E8F4EA', edge: '#4E9270', fg: '#0F5B2E', solid: '#0F5B2E' },
  ochre: { tint: '#FDF4E3', edge: '#A8832F', fg: '#6E4200', solid: '#6E4200' },
  clay: { tint: '#FBEDE0', edge: '#A05C1F', fg: '#7C3A08', solid: '#7C3A08' },
  brick: { tint: '#FDEFED', edge: '#BE6A63', fg: '#9E1C1C', solid: '#9E1C1C' },
  neutral: { tint: '#EAEAE5', edge: '#6A6E66', fg: '#3F433D', solid: '#3F433D' },
}

const darkStatus: Readonly<Record<StatusFamily, StatusTone>> = {
  moss: { tint: '#123021', edge: '#4E9270', fg: '#6FD08F', solid: '#6FD08F' },
  ochre: { tint: '#332714', edge: '#A8832F', fg: '#E8B44F', solid: '#E8B44F' },
  clay: { tint: '#33210F', edge: '#A05C1F', fg: '#E09A5C', solid: '#E09A5C' },
  brick: { tint: '#331A18', edge: '#BE6A63', fg: '#F08A82', solid: '#F08A82' },
  neutral: { tint: '#20252A', edge: '#6A6E66', fg: '#B9BEB9', solid: '#B9BEB9' },
}

// ---------------------------------------------------------------------------
// Ageing ladder (UX-00 section 3.3) — one ordered ladder, six rungs, always the same order
// ---------------------------------------------------------------------------

/** The six receivable buckets of docs/22 section 6, counted from the INVOICE date. */
export const AGEING_BUCKETS = ['0-7', '8-15', '16-30', '31-60', '61-90', '90+'] as const
export type AgeingBucket = (typeof AGEING_BUCKETS)[number]

/** The family each rung is drawn in. `90+` renders `solid` (white on brick). */
export const AGEING_LADDER: Readonly<
  Record<AgeingBucket, { readonly family: StatusFamily; readonly solid: boolean }>
> = {
  '0-7': { family: 'moss', solid: false },
  '8-15': { family: 'neutral', solid: false },
  '16-30': { family: 'ochre', solid: false },
  '31-60': { family: 'clay', solid: false },
  '61-90': { family: 'brick', solid: false },
  '90+': { family: 'brick', solid: true },
}

// ---------------------------------------------------------------------------
// Semantic colours (UX-00 section 3.2) — THIS is what screens use
// ---------------------------------------------------------------------------

export interface SemanticColors {
  readonly bg: {
    /** The page. */
    readonly ground: string
    /** Rail, header, cards, rows, sheets, bottom bar. */
    readonly surface: string
    /** Hover, menus, popovers. */
    readonly raised: string
    /** Wells, segmented track, chart plot area, avatars. Never under text in a field app. */
    readonly sunken: string
    /** Loading placeholders. */
    readonly skeleton: string
    /** The bottom-sheet handle. */
    readonly handle: string
    /** Sheet and dialog backdrop. */
    readonly backdrop: string
  }
  readonly text: {
    readonly primary: string
    readonly secondary: string
    /** DESK ONLY — banned in sales, warehouse, delivery and retailer (UX-00 section 3.5 rule 3). */
    readonly tertiary: string
    /** Disabled labels; state is carried by the outline + reason line, never by greying. */
    readonly disabled: string
    readonly onAccent: string
    readonly onSolid: string
  }
  readonly icon: {
    /** Empty-state and placeholder glyphs. */
    readonly muted: string
  }
  readonly border: {
    /** Rules that structure a page. */
    readonly hairline: string
    /** Rules inside a group. */
    readonly faint: string
    /** Anything interactive or state-bearing. */
    readonly strong: string
  }
  readonly accent: {
    readonly fg: string
    readonly solid: string
    readonly pressed: string
    readonly line: string
    readonly tint: string
  }
  readonly focus: {
    readonly ring: string
  }
  readonly status: Readonly<Record<StatusFamily, StatusTone>>
  readonly chart: {
    /** Primary series, 2 px. */
    readonly primary: string
    /** Second measure on the same chart, 2 px dashed 3 3. */
    readonly secondary: string
    /** Previous period, 2 px dashed 6 3. */
    readonly previous: string
    /** Target, 1 px dashed 2 2. */
    readonly target: string
    /** Categorical mix, max five slices, single-hue ramp then "Other". */
    readonly mix: readonly [string, string, string, string, string]
    readonly grid: string
    readonly baseline: string
  }
}

export const lightColors: SemanticColors = {
  bg: {
    ground: paper[100],
    surface: paper[0],
    raised: paper[50],
    sunken: paper[200],
    skeleton: paper[200],
    handle: paper[400],
    backdrop: 'rgba(27,30,26,0.32)',
  },
  text: {
    primary: paper[950],
    secondary: paper[700],
    tertiary: paper[600],
    disabled: paper[700],
    onAccent: '#FFFFFF',
    onSolid: '#FFFFFF',
  },
  icon: { muted: paper[600] },
  border: { hairline: paper[300], faint: paper[200], strong: paper[500] },
  accent: {
    fg: petrol[700],
    solid: petrol[700],
    pressed: petrol[800],
    line: petrol[600],
    tint: petrol[50],
  },
  focus: { ring: petrol[700] },
  status: lightStatus,
  chart: {
    primary: petrol[600],
    secondary: lightStatus.ochre.edge,
    previous: paper[600],
    target: paper[700],
    mix: [petrol[700], petrol[500], petrol[300], petrol[200], paper[700]],
    grid: paper[200],
    baseline: paper[300],
  },
}

export const darkColors: SemanticColors = {
  bg: {
    ground: slate[950],
    surface: slate[900],
    raised: slate[800],
    sunken: slate[950],
    skeleton: slate[800],
    handle: slate[500],
    backdrop: 'rgba(0,0,0,0.56)',
  },
  text: {
    primary: '#ECEDE8',
    secondary: '#B9BEB9',
    tertiary: '#9AA096',
    disabled: '#9AA096',
    onAccent: slate[950],
    onSolid: slate[950],
  },
  icon: { muted: '#9AA096' },
  border: { hairline: slate[700], faint: slate[800], strong: slate[500] },
  accent: {
    fg: petrol.onDark,
    solid: petrol.onDark,
    pressed: '#7FD6DF',
    line: petrol.onDark,
    tint: '#123037',
  },
  focus: { ring: petrol.onDark },
  status: darkStatus,
  chart: {
    primary: petrol.onDark,
    secondary: darkStatus.ochre.edge,
    previous: '#9AA096',
    target: '#B9BEB9',
    mix: [petrol.onDark, petrol[300], petrol[500], petrol[600], '#9AA096'],
    grid: slate[800],
    baseline: slate[700],
  },
}

export type ThemeName = 'light' | 'dark'

export const themes: Readonly<Record<ThemeName, SemanticColors>> = {
  light: lightColors,
  dark: darkColors,
}

/**
 * `{ 'bg.ground': '#F2F2EF', ... }` — every semantic leaf as a dotted name. Used by the token test
 * (every name must resolve in both themes), by the CSS custom-property generator and by tooling.
 */
export function flattenColors(colors: SemanticColors): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      out[path] = value
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        walk(item, `${path}.${i}`)
      })
      return
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key)
    }
  }
  walk(colors, '')
  return out
}

/** Every dotted semantic colour name, sorted. Identical in both themes by construction (see the test). */
export const COLOR_NAMES: readonly string[] = Object.keys(flattenColors(lightColors)).sort()

// ---------------------------------------------------------------------------
// Typography (UX-00 section 4)
// ---------------------------------------------------------------------------

/**
 * IBM Plex Sans, self-hosted (founder, 2026-09-05). The fallbacks matter: until the binary is
 * installed in an app's `public/fonts`, the stack renders in the platform UI face at the same sizes.
 * UX-00 section 4.1 allows no second family and no monospace, so there is exactly one stack here.
 */
export const fontFamily = {
  sans: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  /** React Native resolves a single family name, not a stack. */
  native: 'IBMPlexSans',
} as const

/** One type token. `tracking` is em; `weight` is a numeric CSS/RN weight. */
export interface TypeToken {
  readonly size: number
  readonly line: number
  readonly weight: 400 | 500 | 600 | 700
  readonly tracking: number
}

/** Field scale, sp (1 sp = 1 dp). Body floor 16, money floor 20, nothing below 14 (UX-01 U8). */
export const typeField = {
  keypad: { size: 44, line: 52, weight: 600, tracking: -0.02 },
  hero: { size: 32, line: 38, weight: 700, tracking: -0.02 },
  moneyL: { size: 24, line: 30, weight: 700, tracking: -0.02 },
  moneyM: { size: 20, line: 26, weight: 600, tracking: 0 },
  title: { size: 20, line: 26, weight: 700, tracking: -0.015 },
  body: { size: 16, line: 22, weight: 400, tracking: 0 },
  bodyStrong: { size: 16, line: 22, weight: 600, tracking: 0 },
  label: { size: 14, line: 18, weight: 500, tracking: 0 },
  eyebrow: { size: 14, line: 18, weight: 600, tracking: 0.06 },
} as const satisfies Record<string, TypeToken>

/** Desk scale, px. Floor 14 px; the 12 px eyebrow is the one recorded exception (UX-00 section 3.6). */
export const typeDesk = {
  kpi: { size: 24, line: 28, weight: 700, tracking: -0.02 },
  pageTitle: { size: 20, line: 26, weight: 700, tracking: -0.015 },
  railTitle: { size: 14, line: 18, weight: 700, tracking: -0.01 },
  section: { size: 14, line: 20, weight: 600, tracking: 0 },
  body: { size: 14, line: 20, weight: 400, tracking: 0 },
  nav: { size: 14, line: 20, weight: 400, tracking: 0 },
  navActive: { size: 14, line: 20, weight: 600, tracking: 0 },
  cell: { size: 14, line: 20, weight: 400, tracking: 0 },
  cellMoney: { size: 14, line: 20, weight: 500, tracking: 0 },
  label: { size: 14, line: 18, weight: 500, tracking: 0 },
  meta: { size: 14, line: 18, weight: 400, tracking: 0 },
  eyebrow: { size: 12, line: 16, weight: 600, tracking: 0.06 },
} as const satisfies Record<string, TypeToken>

export type FieldTypeName = keyof typeof typeField
export type DeskTypeName = keyof typeof typeDesk

// ---------------------------------------------------------------------------
// Space, touch, shape, elevation (UX-00 section 5)
// ---------------------------------------------------------------------------

/** One 4 px scale. Field gutter = 4; desk main padding = 5; desk content max 1200. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const

export const layout = {
  /** Desk content maximum width. */
  deskMaxWidth: 1200,
  /** Rail width, and the width it collapses to below 1100 px. */
  railWidth: 172,
  railCollapsedWidth: 56,
  /** The viewport below which a desk app takes the phone shell (UX-00 section 2). */
  phoneBreakpoint: 768,
  /**
   * `AppShell` renders the desk shell at this width and wider and the phone shell below it
   * (docs/08 section 0). An owner on a phone gets bottom tabs; a salesperson on a laptop gets the rail.
   */
  deskBreakpoint: 1024,
  railCollapseBreakpoint: 1100,
  /** Desk main padding, all round. */
  deskPadding: space[5],
  /** Field gutter. */
  fieldGutter: space[4],
  /** Desk register row height. */
  deskRowHeight: 32,
  /** Side panel opened from a register row. */
  sidePanelWidth: 360,
} as const

/**
 * The four touch floors of UX-00 section 5.2, as heights in dp (px on desk). An app's shell fixes
 * which one applies; a screen never picks a smaller one.
 *
 * - `field` 69 — sales, retailer, and delivery outside the stop actions
 * - `floor` 76 — every warehouse target and the delivery stop actions
 * - `phone` 63 — the owner and manager phone surfaces
 * - `desk`  32 — buttons on a pointer desk (visible floor 24 px)
 */
export const size = { field: 69, floor: 76, phone: 63, desk: 32 } as const
export type SizeName = keyof typeof size

/** Minimum gaps between adjacent targets (UX-00 section 5.2). */
export const gap = { adjacent: 19, warehouse: 25, destructive: 50 } as const

export const radius = { xs: 4, sm: 6, md: 8, lg: 12, xl: 20, full: 9999 } as const

/** Hairline is 1 device px everywhere; RN rounds it itself. */
export const borderWidth = { hairline: 1, strong: 1, indicator: 3 } as const

/** Exactly four shadows exist (UX-00 section 5.4). Cards, rows, strips, tables, chips and inputs are flat. */
export interface ShadowToken {
  readonly x: number
  readonly y: number
  readonly blur: number
  readonly color: string
  readonly opacity: number
}

export const elevation = {
  sheet: { x: 0, y: -2, blur: 16, color: '#1B1E1A', opacity: 0.12 },
  dialog: { x: 0, y: 8, blur: 32, color: '#1B1E1A', opacity: 0.16 },
  /** Sticky bottom bar — ONLY while content scrolls under it. */
  stickyBar: { x: 0, y: -1, blur: 8, color: '#1B1E1A', opacity: 0.08 },
  menu: { x: 0, y: 4, blur: 16, color: '#1B1E1A', opacity: 0.12 },
} as const satisfies Record<string, ShadowToken>

export type ElevationName = keyof typeof elevation

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '')
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  }
}

/** `0 8px 32px rgba(27,30,26,0.16)` for a CSS `box-shadow`. */
export function cssShadow(name: ElevationName): string {
  const s = elevation[name]
  const { r, g, b } = hexToRgb(s.color)
  return `${s.x}px ${s.y}px ${s.blur}px rgba(${r},${g},${b},${s.opacity})`
}

/** The same shadow as React Native style props (iOS shadow* plus an Android elevation). */
export function nativeShadow(name: ElevationName): {
  shadowColor: string
  shadowOffset: { width: number; height: number }
  shadowOpacity: number
  shadowRadius: number
  elevation: number
} {
  const s = elevation[name]
  return {
    shadowColor: s.color,
    shadowOffset: { width: s.x, height: s.y },
    shadowOpacity: s.opacity,
    shadowRadius: s.blur / 2,
    elevation: Math.round(s.blur / 4),
  }
}

/** Focus ring: 2 px ring, 2 px offset, 1 px surface halo (UX-00 section 5.3). */
export const focusRing = { width: 2, offset: 2 } as const

// ---------------------------------------------------------------------------
// Motion (UX-00 section 7)
// ---------------------------------------------------------------------------

export const motion = {
  duration: {
    /** Press, checkbox, chip, stepper bump. */
    micro: 80,
    /** Row insert, chip, strip, sticky-bar shadow. */
    enter: 150,
    exit: 150,
    /** Sheet, dialog, side panel. */
    surface: 250,
    /** Route push/pop — never re-implemented; the navigator owns it. */
    screen: 300,
  },
  easing: {
    micro: 'cubic-bezier(0.2, 0, 0, 1)',
    enter: 'cubic-bezier(0, 0, 0, 1)',
    exit: 'cubic-bezier(0.3, 0, 1, 1)',
    surfaceIn: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
    surfaceOut: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  },
  /** The pressed state of every button and row. */
  pressScale: 0.98,
} as const

// ---------------------------------------------------------------------------
// Chart geometry constants (UX-00 sections 3.4, 6.14)
// ---------------------------------------------------------------------------

export const chart = {
  /** Series stroke width. Target lines are 1 px. */
  strokeWidth: 2,
  targetStrokeWidth: 1,
  /** The dot on the last point only. */
  endDotRadius: 3,
  gridWidth: 1,
  /** Dash patterns, in the order UX-00 section 3.4 lists them. */
  dash: { secondary: '3 3', previous: '6 3', target: '2 2' } as const,
  /** Maximum slices in a categorical mix, "Other" included. */
  maxMixSlices: 5,
  /** A TrendChart draws between 12 and 92 points; fewer than 3 renders as a value list. */
  minPoints: 3,
  maxPoints: 92,
  /** Money axes carry at most five ticks. */
  maxTicks: 5,
  /** BarLadder rung track height. */
  ladderTrackHeight: 16,
} as const

// ---------------------------------------------------------------------------
// The whole token set, for a screen that wants one import
// ---------------------------------------------------------------------------

export const tokens = {
  space,
  size,
  gap,
  radius,
  borderWidth,
  elevation,
  focusRing,
  motion,
  layout,
  chart,
  typeField,
  typeDesk,
  fontFamily,
} as const
