/**
 * `@dos/ui/web` — the UX-00 section 6 components for React DOM (owner, manager and admin).
 *
 * `@dos/ui/native` exports the same names against the same prop types. Anything that is not a
 * component (tokens, strings, money and quantity helpers, chart geometry, the theme hooks) comes
 * from `@dos/ui`.
 */
export { ThemeProvider, type WebThemeProviderProps } from './ThemeProvider.js'
export { buildStylesheet, buildThemeVars, cssVar, cssVarName, BASE_CSS, FONT_CSS } from './css.js'

export { Eyebrow, Rule, Spinner, Txt, typeStyle, useTypeStyle } from './base.js'
export { Button, Chips, Search, Segments, Tabs, TextInput, useSearchState } from './controls.js'
export { Money, NumberPad, QtyStepper, RupeeInput } from './money.js'
export { AgeingBuckets, BarLadder, Group, KpiStrip, ListRow, Register, StatusChip } from './list.js'
export {
  Avatar,
  ConnectionStrip,
  Dialog,
  EmptyState,
  ErrorState,
  Sheet,
  Skeleton,
  TenantLogo,
  Toast,
  initialsOf,
} from './feedback.js'
export { CompareBars, Sparkline, StackedMix, TrendChart } from './charts.js'

// The contracts both renderers implement, re-exported so a screen needs one import.
export type * from '../types.js'
