/**
 * `@dos/ui/native` — the UX-00 section 6 components for React Native (sales, warehouse, delivery,
 * retailer, and the phone builds of owner and manager).
 *
 * Every name and every prop type is the same as `@dos/ui/web`; a screen written against the contract
 * reads identically on either renderer. Anything that is not a component comes from `@dos/ui`.
 */
export { ThemeProvider, type NativeThemeProviderProps } from './ThemeProvider.js'

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
export { MapView } from './map.js'

// The layout vocabulary of docs/08 §0 — the whole structural surface a screen may use.
export {
  Box,
  Img,
  Link,
  List,
  Pressable,
  Row,
  Screen,
  Scroll,
  Stack,
  setRouterNavigate,
} from './layout.js'
export { AppShell, TenantSwitcher } from './shell.js'
export { useViewport } from './viewport.js'

export type * from '../types.js'
