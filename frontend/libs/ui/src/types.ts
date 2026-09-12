/**
 * The component contracts of UX-00 section 6, written ONCE.
 *
 * `@dos/ui/web` and `@dos/ui/native` both implement these exact prop types, so a screen written
 * against the contract reads identically on either renderer and a component can be ported without
 * re-reading the design document. Nothing renderer-specific (no DOM event, no RN style) appears here.
 */
import type { ReactNode } from 'react'

import type { SeriesPoint, Series, CompareGroup, MixSlice } from './charts/geometry.js'
import type { AgeingBucket, DeskTypeName, FieldTypeName, SizeName, StatusFamily } from './tokens.js'

/** Every component takes one. Test ids are the only string in the kit that is not translated. */
export interface Testable {
  testID?: string | undefined
}

// ---------------------------------------------------------------------------
// 6.1 Button
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

export interface ButtonProps extends Testable {
  /** Verb + object, <= 20 characters. Never "Submit", "OK", "Done" or "Save" for a ledger write. */
  label: string
  onPress: () => void
  variant?: ButtonVariant | undefined
  /** Defaults to the app's touch floor from the theme; a screen never picks a smaller one. */
  size?: SizeName | undefined
  icon?: ReactNode | undefined
  /** Printed on the button on desk ("⌘P"). */
  shortcut?: string | undefined
  disabled?: boolean | undefined
  /** REQUIRED whenever `disabled`: the reason prints beneath, never a grey word with no cause. */
  disabledReason?: string | undefined
  /** Label stays, spinner takes the icon slot, width does not move, re-taps are swallowed. */
  loading?: boolean | undefined
  /** 200 ms outcome word after a successful commit ("Order placed"). */
  successLabel?: string | undefined
  fullWidth?: boolean | undefined
}

// ---------------------------------------------------------------------------
// 6.2 TextInput
// ---------------------------------------------------------------------------

export type InputState = 'default' | 'disabled' | 'readonly' | 'error' | 'validating'

export interface TextInputProps extends Testable {
  /** Above the field, always. Never a floating placeholder. */
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string | undefined
  /** Helper line; its height is reserved whether or not it has text. */
  helper?: string | undefined
  /** The business problem and the next action. Sets the error state. */
  error?: string | undefined
  state?: InputState | undefined
  size?: SizeName | undefined
  autoFocus?: boolean | undefined
  maxLength?: number | undefined
  secure?: boolean | undefined
  /** Never `type="number"` (UX-02 R21); this picks the on-screen keyboard only. */
  keyboard?: ('text' | 'decimal' | 'phone' | 'email') | undefined
  /**
   * Auto-capitalisation, **default `none`**.
   *
   * A phone capitalises the first letter of a text field unless it is told not to, and the fields
   * in this product are identifiers far more often than prose: a username, a GSTIN, an HSN code, an
   * invoice number, a vehicle number, a UPI reference. `sunil.tarsun` typed on an iPhone arrives as
   * `Sunil.tarsun` and the sign-in fails with the right password. A field that really wants prose —
   * a shop name, a note — asks for `words` or `sentences`.
   */
  capitalize?: ('none' | 'words' | 'sentences') | undefined
  onSubmit?: (() => void) | undefined
}

// ---------------------------------------------------------------------------
// 6.3 Money and RupeeInput
// ---------------------------------------------------------------------------

export type MoneySize = 'hero' | 'moneyL' | 'moneyM' | 'cell' | 'body'
export type MoneyTone = 'default' | 'positive' | 'critical' | 'secondary'

export interface MoneyProps extends Testable {
  /** Integer paise. `null` renders the em dash. */
  value: number | null
  size?: MoneySize | undefined
  tone?: MoneyTone | undefined
  /** `false` in a column whose head already states `₹` (UX-00 section 4.5 rule 5). */
  symbol?: boolean | undefined
}

export interface RupeeInputProps extends Testable {
  label: string
  /** Integer paise, or null for empty. */
  value: number | null
  /** Integer paise, or null when cleared. Never a float. */
  onChange: (paise: number | null) => void
  placeholder?: string | undefined
  helper?: string | undefined
  error?: string | undefined
  disabled?: boolean | undefined
  /**
   * A soft bound (credit limit, expected cash). Over it the value is ACCEPTED and `boundMessage`
   * states what happens — no silent clamping (UX-00 section 6.3).
   */
  bound?: (number | null) | undefined
  boundMessage?: string | undefined
  /** Cash collection prints the expected amount ABOVE the pad and never pre-fills it (UX-01 D6). */
  expected?: (number | null) | undefined
  expectedLabel?: string | undefined
  size?: SizeName | undefined
  autoFocus?: boolean | undefined
}

/**
 * The full-screen pad a field app opens for money and for counts (UX-00 section 6.3; UX-01 W2, D6).
 * Never parsed from a float. In `money` mode the pad enters RUPEES (`4 7 5 6` is ₹4,756.00 = 475600
 * paise) and reaches paise only after `.` (`4 7 5 6 . 5` is 475650), with Clear beside Done; in
 * `count` mode digits are appended (`1 2 3 4` is 1234).
 */
export interface NumberPadProps extends Testable {
  label: string
  /** Integer paise in `money` mode, an integer count in `count` mode. `null` is empty. */
  value: number | null
  onChange: (value: number | null) => void
  onDone: () => void
  mode?: 'money' | 'count' | undefined
  /** Printed ABOVE the pad and never pre-filled into it. */
  expected?: number | null | undefined
  expectedLabel?: string | undefined
  doneLabel?: string | undefined
}

// ---------------------------------------------------------------------------
// 6.4 QtyStepper
// ---------------------------------------------------------------------------

export interface QtyStepperProps extends Testable {
  /** Integer pieces. */
  pieces: number
  /** From `tenant_products.case_size_override` else `product_variants.default_case_size`. */
  caseSize: number
  onChange: (pieces: number) => void
  /** From `sellable_stock`, in pieces. Over it is accepted with an `ochre` line, never blocked. */
  availablePieces?: (number | null) | undefined
  /** A business block (credit stop, minimum order): `brick`, with the reason and the approval path. */
  blocked?: boolean | undefined
  blockedReason?: string | undefined
  disabled?: boolean | undefined
  /** The applied scheme, in rupees, as it prints on the row: "−₹68 · 1 free per 10". */
  schemeLabel?: string | undefined
  size?: SizeName | undefined
  /** Long-press and the visible "Pieces" button both open the loose-pieces entry. */
  onOpenPieces?: (() => void) | undefined
}

// ---------------------------------------------------------------------------
// 6.5 Search
// ---------------------------------------------------------------------------

export type SearchState = 'idle' | 'typing' | 'results' | 'noResults' | 'error'

export interface SearchProps extends Testable {
  value: string
  onChange: (value: string) => void
  placeholder?: string | undefined
  state?: SearchState | undefined
  /** Shown under the field, never as an overlay. */
  children?: ReactNode | undefined
  /** Offered on `noResults` where the role may create an item. */
  onAddNew?: (() => void) | undefined
  /** On `error`, cached results are shown with their age. */
  staleLabel?: string | undefined
  size?: SizeName | undefined
  autoFocus?: boolean | undefined
}

// ---------------------------------------------------------------------------
// 6.6 Group and ListRow
// ---------------------------------------------------------------------------

export type ListRowState = 'default' | 'selected' | 'waiting' | 'needsAttention' | 'disabled'

export interface ListRowProps extends Testable {
  /** Icon, avatar or checkbox, 40 dp. */
  leading?: ReactNode | undefined
  /** Normally a plain string; a node so a register's identity cell can be handed over as-is. */
  primary: ReactNode
  /** One line, never a figure. */
  secondary?: ReactNode | undefined
  /** Money in the trailing stack, integer paise. */
  trailingMoney?: (number | null) | undefined
  trailingSize?: ('moneyM' | 'moneyL') | undefined
  /** A `<StatusChip>` under the money. */
  trailing?: ReactNode | undefined
  state?: ListRowState | undefined
  /** The reason line for `needsAttention`. */
  reason?: string | undefined
  onPress?: (() => void) | undefined
}

export interface GroupProps extends Testable {
  /** UPPERCASE eyebrow above the card, <= 14 characters. */
  title?: string | undefined
  /** The `accent.tint` footer strip — the scheme row. */
  footer?: ReactNode | undefined
  children: ReactNode
}

// ---------------------------------------------------------------------------
// 6.7 Register
// ---------------------------------------------------------------------------

export type RegisterState = 'ready' | 'loading' | 'empty' | 'error' | 'partial' | 'filtered'

export interface RegisterColumn<Row> {
  key: string
  /** Sentence case, medium, `text.secondary`. Never uppercase. */
  head: string
  /** Money columns are right-aligned and state `₹` in the head. */
  align?: ('left' | 'right') | undefined
  width?: number | undefined
  /** Cells derive nothing: the service sends the value already computed. */
  cell: (row: Row) => ReactNode
  /** What the phone rendering shows: identity, the one number, a chip. */
  priority?: ('identity' | 'value' | 'chip' | 'detail') | undefined
}

export interface RegisterProps<Row> extends Testable {
  columns: readonly RegisterColumn<Row>[]
  rows: readonly Row[]
  rowKey: (row: Row) => string
  /** Column key frozen to the left on desk. */
  frozen?: string | undefined
  /** The totals row: values by column key. */
  totals?: Readonly<Record<string, ReactNode>> | undefined
  onSelect?: ((row: Row) => void) | undefined
  selectedKey?: (string | null) | undefined
  state?: RegisterState | undefined
  /** Chip row naming the active filters, with a one-tap clear. */
  filters?: readonly { id: string; label: string }[] | undefined
  onClearFilters?: (() => void) | undefined
  /** "As of 9:40 am" on `partial`. */
  asOf?: string | undefined
  errorMessage?: string | undefined
  emptyMessage?: string | undefined
}

// ---------------------------------------------------------------------------
// 6.8 KpiStrip and BarLadder
// ---------------------------------------------------------------------------

export interface KpiItem {
  label: string
  /** Already formatted by the caller through `<Money>` or a count. */
  value: ReactNode
  delta?: string | undefined
  tone?: ('positive' | 'critical' | 'neutral') | undefined
  /** A 40x16 sparkline in the column. */
  spark?: readonly number[] | undefined
}

export interface KpiStripProps extends Testable {
  items: readonly KpiItem[]
}

export interface LadderRow {
  label: string
  /** Integer paise or an integer count. */
  value: number
  family: StatusFamily
  /** The `90+` rung: white on brick. */
  solid?: boolean | undefined
}

export interface BarLadderProps extends Testable {
  rows: readonly LadderRow[]
  /** `₹` is stated in the panel title, not on every rung. */
  title?: string | undefined
  /** Defaults to money formatting without the symbol. */
  formatValue?: ((value: number) => string) | undefined
}

/** The ageing instance of `<BarLadder>`: the six rungs of docs/22 section 6, in order. */
export interface AgeingBucketsProps extends Testable {
  /** Paise per bucket. Every rung is drawn even at zero. */
  buckets: Readonly<Record<AgeingBucket, number>>
  title?: string | undefined
}

// ---------------------------------------------------------------------------
// 6.9 StatusChip
// ---------------------------------------------------------------------------

export interface StatusChipProps extends Testable {
  /** The word. Colour is never the only channel. */
  label: string
  family: StatusFamily
  /** Reserved for Out of stock, Overdue and Failed. */
  solid?: boolean | undefined
  icon?: ReactNode | undefined
  /** A chip carrying a figure is set in `moneyM` and is 28 dp tall (32 dp warehouse). */
  figure?: boolean | undefined
}

// ---------------------------------------------------------------------------
// 6.10 Tabs, Chips, Segments
// ---------------------------------------------------------------------------

export interface TabItem {
  id: string
  label: string
  count?: number | undefined
}

export interface TabsProps extends Testable {
  /** At most four. */
  items: readonly TabItem[]
  value: string
  onChange: (id: string) => void
}

export interface ChipItem {
  id: string
  label: string
  selected?: boolean | undefined
}

export interface ChipsProps extends Testable {
  items: readonly ChipItem[]
  onToggle: (id: string) => void
  size?: SizeName | undefined
  /** A filter row never leaves the screen without a summary and a clear. */
  onClear?: (() => void) | undefined
}

export interface SegmentsProps extends Testable {
  /** Two or three options. */
  items: readonly { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
  size?: SizeName | undefined
}

// ---------------------------------------------------------------------------
// 6.11 ConnectionStrip
// ---------------------------------------------------------------------------

export interface ConnectionState {
  online: boolean
  /** Epoch ms of the last successful read. */
  lastSyncedAt?: (number | null) | undefined
  /** Writes the device is still holding. */
  pendingWrites?: number | undefined
  /** Rejected writes that became work items. */
  needsAttention?: number | undefined
  /** Data older than four hours says so, in `ochre`. */
  staleSince?: (number | null) | undefined
}

export interface ConnectionStripProps extends Testable {
  state: ConnectionState
  /** Opens the waiting list. There is never a "Sync now" button. */
  onOpenQueue?: (() => void) | undefined
  now?: number | undefined
}

// ---------------------------------------------------------------------------
// 6.12 Sheet, Dialog, Toast
// ---------------------------------------------------------------------------

export interface SheetProps extends Testable {
  open: boolean
  onClose: () => void
  title?: string | undefined
  children: ReactNode
}

export interface DialogProps extends Testable {
  open: boolean
  onClose: () => void
  title: string
  /** Exactly what will be written: "Invoice GL/1688 · ₹18,420 · stock leaves Kalyan godown". */
  body: ReactNode
  /** The real verb: "Issue invoice", "Post GRN", "Close trip". Never "OK". */
  confirmLabel: string
  onConfirm: () => void
  cancelLabel?: string | undefined
  destructive?: boolean | undefined
  busy?: boolean | undefined
}

export interface ToastProps extends Testable {
  open: boolean
  /** <= 6 words. Never the record of an event. */
  message: string
  /** Undo only for what the machines can actually reverse. */
  actionLabel?: string | undefined
  onAction?: (() => void) | undefined
  onDismiss: () => void
}

// ---------------------------------------------------------------------------
// 6.13 Avatar, TenantLogo, EmptyState, ErrorState, Skeleton
// ---------------------------------------------------------------------------

export interface AvatarProps extends Testable {
  name: string
  /** 40 dp in rows, 32 dp in headers. */
  size?: number | undefined
}

export interface TenantLogoProps extends Testable {
  /** 28 px rail · 32 dp phone header · 40 dp retailer card. */
  size?: ('rail' | 'header' | 'card') | undefined
  /** Defaults to the tenant on the theme. */
  name?: string | undefined
  logoUrl?: (string | null) | undefined
  /** Draw the display name beside the mark. */
  withName?: boolean | undefined
  /** A second line under the name ("Kalyan · FY 2026-27"). */
  subtitle?: string | undefined
}

export interface EmptyStateProps extends Testable {
  /** One line, <= 8 words. */
  message: string
  icon?: ReactNode | undefined
  /** A secondary button naming the next thing. */
  actionLabel?: string | undefined
  onAction?: (() => void) | undefined
}

export interface ErrorStateProps extends Testable {
  /** Business language plus the next action. Never a status code. */
  message: string
  /** Codes live behind "Details". */
  detail?: string | undefined
  actionLabel?: string | undefined
  onAction?: (() => void) | undefined
}

export interface SkeletonProps extends Testable {
  /** Content-shaped, at real row heights. */
  rows?: number | undefined
  rowHeight?: number | undefined
  width?: (number | string) | undefined
}

// ---------------------------------------------------------------------------
// 6.15 MapView — the owner's live map and the crew's road (docs/08 §0)
// ---------------------------------------------------------------------------

/**
 * ONE contract, two engines: MapLibre GL JS over OpenStreetMap raster tiles on the web (free, and the
 * attribution is not optional — it is rendered by the component itself), `react-native-maps` on a
 * phone (Apple Maps on iOS, the Google Maps SDK on Android). Neither is a hard dependency: a build
 * without the engine, or a browser with no WebGL, draws the SAME markers as a labelled list rather
 * than a blank rectangle, and says why. A missing capability answers honestly; it never throws.
 *
 * Navigating TO a place is never in here: that is a URL hand-off to the phone's own map app
 * (`platform.share` / a `geo:` link), which is what a driver already knows how to use.
 */
export interface MapPoint {
  latitude: number
  longitude: number
}

export interface MapMarker extends MapPoint {
  id: string
  /** The shop's or vehicle's own name — printed beside the pin on desk, in the callout on a phone. */
  label: string
  /** A second line: "3 of 11 stops · seen 6 min ago". */
  detail?: string | undefined
  /** Colour + word, never colour alone (UX-00 §3.4). The word belongs in `detail`. */
  tone?: StatusFamily | undefined
  /** Draws the pin larger and above the rest — the vehicle the reader tapped. */
  selected?: boolean | undefined
}

/** A trip trace or a planned round, drawn as a line under the pins. */
export interface MapPath {
  id: string
  points: readonly MapPoint[]
  tone?: StatusFamily | undefined
}

export interface MapViewProps extends Testable {
  markers?: readonly MapMarker[] | undefined
  paths?: readonly MapPath[] | undefined
  /** Defaults to the extent of the markers; with none, to the centre of the pilot's own district. */
  center?: MapPoint | undefined
  /** 1 (the subcontinent) to 18 (a lane). Ignored when the extent is computed from the markers. */
  zoom?: number | undefined
  height?: number | undefined
  onSelectMarker?: ((id: string) => void) | undefined
  /** Shown instead of the map when there is nothing to draw. */
  emptyMessage?: string | undefined
  /** Force the list rendering — what a screen does when the reader has asked for the register. */
  listOnly?: boolean | undefined
}

// ---------------------------------------------------------------------------
// 6.14 The chart set
// ---------------------------------------------------------------------------

export interface ChartFrame extends Testable {
  height?: number | undefined
  /** Printed on the chart itself: "4 Aug — 3 Sep". */
  range?: string | undefined
  /** Printed on the chart itself: "as of 6:10 pm". */
  asOf?: string | undefined
  /** Defaults to abbreviated money on a zero-based axis. */
  formatValue?: ((value: number) => string) | undefined
}

export interface TrendChartProps extends ChartFrame {
  /** One or two series, 12 to 92 points. Fewer than three points renders as a labelled value list. */
  series: readonly Series[]
  /** A single-series chart carries no legend. */
  legend?: boolean | undefined
}

export interface CompareBarsProps extends ChartFrame {
  /** At most twelve groups. */
  groups: readonly CompareGroup[]
  currentLabel?: string | undefined
  previousLabel?: string | undefined
}

export interface StackedMixProps extends Testable {
  /** At most five segments, "Other" included; labels live in the key line beneath. */
  slices: readonly MixSlice[]
  formatValue?: ((value: number) => string) | undefined
}

export interface SparklineProps extends Testable {
  values: readonly number[]
  width?: number | undefined
  height?: number | undefined
}

// ---------------------------------------------------------------------------
// Layout primitives (docs/08 section 0)
//
// A screen may not touch `View` or `div`, so structure has its own small vocabulary. These ten are
// the WHOLE surface a screen composes with, next to the section 6 components above. Every value is a
// token name, never a number a screen invented: `pad={4}` is `space.4`, `background="surface"` is
// `bg.surface`. Nothing here can express a colour, a font or a shadow.
// ---------------------------------------------------------------------------

/** A step on the one 4 px scale (UX-00 section 5.1). `4` is the field gutter, `5` the desk padding. */
export type SpaceStep = 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12

export type SurfaceName = 'none' | 'ground' | 'surface' | 'raised' | 'sunken'
export type RadiusName = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full'
export type BorderEdge = 'none' | 'all' | 'top' | 'bottom' | 'left' | 'right'
export type BorderTone = 'hairline' | 'faint' | 'strong'
export type AlignName = 'start' | 'center' | 'end' | 'stretch'
export type JustifyName = 'start' | 'center' | 'end' | 'between'

/** The rectangle everything else is built from. */
export interface BoxProps extends Testable {
  children?: ReactNode | undefined
  pad?: SpaceStep | undefined
  padX?: SpaceStep | undefined
  padY?: SpaceStep | undefined
  /** Outer spacing. Prefer a parent `<Stack gap>`; this is for the odd single offset. */
  marginTop?: SpaceStep | undefined
  background?: SurfaceName | undefined
  border?: BorderEdge | undefined
  borderTone?: BorderTone | undefined
  radius?: RadiusName | undefined
  /** Takes the free space on the parent's main axis. */
  grow?: boolean | undefined
  width?: (number | 'full') | undefined
  height?: number | undefined
  minHeight?: number | undefined
  maxWidth?: number | undefined
  align?: AlignName | undefined
  /** Centres the box in its parent — the reading-width column of the desk shell. */
  center?: boolean | undefined
}

/** A vertical run with one gap. The default arrangement of every screen. */
export interface StackProps extends BoxProps {
  gap?: SpaceStep | undefined
}

/** A horizontal run. Wraps only when told to, so a figure never falls under its own label. */
export interface RowProps extends StackProps {
  justify?: JustifyName | undefined
  wrap?: boolean | undefined
}

/**
 * A scrolling region. `<Screen>` already scrolls; this is for the second scroller on a screen
 * (a horizontal chip rail, a panel with its own overflow).
 */
export interface ScrollProps extends Testable {
  children: ReactNode
  horizontal?: boolean | undefined
  grow?: boolean | undefined
  pad?: SpaceStep | undefined
  /** Fires once per approach to the end — the page-two hook of a long register. */
  onEndReached?: (() => void) | undefined
}

/**
 * A VIRTUALISED list: `FlatList` on native, a windowed DOM list on web. A distributor's shop list is
 * tens of thousands of rows on a two-year-old phone (docs/20), so the kit has no unvirtualised
 * alternative — `items` is the whole array and only what fits is ever mounted.
 */
export interface ListProps<Item> extends Testable {
  items: readonly Item[]
  /** Stable across a reorder: the row's own id, never the index. */
  keyExtractor: (item: Item, index: number) => string
  renderItem: (item: Item, index: number) => ReactNode
  /** Row height in dp/px. The windowing maths needs it; rows that vary are clipped to it. */
  itemHeight?: number | undefined
  onEndReached?: (() => void) | undefined
  separator?: boolean | undefined
  header?: ReactNode | undefined
  footer?: ReactNode | undefined
  /** Rendered instead of the rows when `items` is empty — normally an `<EmptyState>`. */
  empty?: ReactNode | undefined
  /** Fills its parent and owns the scrolling (default). `false` renders inline in a page scroll. */
  grow?: boolean | undefined
}

/** Anything tappable that is not a `<Button>`: a row, a card, a tab, a logo. */
export interface PressableProps extends Testable {
  onPress: () => void
  children: ReactNode
  disabled?: boolean | undefined
  /** Spoken name when the children are not words. */
  label?: string | undefined
  /** Defaults to the app's touch floor from the theme; a screen never picks a smaller one. */
  minHeight?: number | undefined
  grow?: boolean | undefined
  role?: ('button' | 'link' | 'tab' | 'row') | undefined
}

export interface ImgProps extends Testable {
  /** A URL, a data URI, or a signed read URL from `files.signRead`. */
  source: string
  /** Required: a logo, a bill photograph and a delivery proof all mean something. */
  alt: string
  width?: number | undefined
  height?: number | undefined
  radius?: RadiusName | undefined
  fit?: ('cover' | 'contain') | undefined
}

/**
 * An expo-router destination. On web it renders a real `<a href>` — middle-click, copy link address
 * and the browser's own back button all work; on a phone it pushes the route.
 */
export interface LinkProps extends Testable {
  /** An already-resolved route: `/orders`, `/orders/0198f1c2-...`. */
  href: string
  children: ReactNode
  /** Replace the current entry instead of pushing one (a sign-in that must not be returned to). */
  replace?: boolean | undefined
  /** `text` is an accent-coloured word; `plain` wraps whatever it is given. */
  variant?: ('text' | 'plain') | undefined
}

/**
 * The only place text styling happens. `field` and `desk` name a token on each scale, so one screen
 * file reads correctly at 16 sp in a van and at 14 px on a desk (UX-00 section 4).
 */
export interface TxtContract extends Testable {
  field: FieldTypeName
  desk: DeskTypeName
  /** A semantic colour from the theme. Never a hex literal (ESLint enforces it in an app). */
  color?: string | undefined
  /** Tabular figures and a capped font-scale multiplier. Every number sets it. */
  numeric?: boolean | undefined
  /** Clamp to N lines. A shop's name is one line; its address is two. */
  numberOfLines?: number | undefined
  /** Web semantics (`h1`, `label`); native maps `h1`–`h3` to the header accessibility role. */
  as?: ('span' | 'div' | 'p' | 'h1' | 'h2' | 'h3' | 'label') | undefined
  children: ReactNode
}

/**
 * The frame of one screen: safe-area insets, the header, the scroll policy and the sticky bottom bar.
 * A hard-coded `paddingTop` is a bug (UX-00 section 8.2).
 */
export interface ScreenProps extends Testable {
  /** Desk: the page title. Phone: the header title. */
  title?: string | undefined
  /** The line ABOVE the title: "Station Road · stop 7 of 18". */
  context?: string | undefined
  /** Page-header actions (Export, Print). Right-aligned on desk, under the title on a phone. */
  actions?: ReactNode | undefined
  /** Status chips under the title — information only, never an action (UX-00 section 8.2). */
  chips?: ReactNode | undefined
  /** Default true. `false` when the screen's own `<List>` owns the scrolling. */
  scroll?: boolean | undefined
  /** The sticky bottom bar: the summary and the one primary action. */
  bottomBar?: ReactNode | undefined
  /** Constrain the content to the desk reading width (1200 px). Default true. */
  readingWidth?: boolean | undefined
  /** Padding around the content. Defaults to the desk padding / the field gutter. */
  pad?: SpaceStep | undefined
  children: ReactNode
}

// ---------------------------------------------------------------------------
// The shell (UX-00 sections 8.1 and 8.2)
// ---------------------------------------------------------------------------

export type ViewportKind = 'phone' | 'desk'

export interface Viewport {
  width: number
  height: number
  /** `desk` at 1024 px and wider, `phone` below. An owner on a phone gets the phone shell. */
  kind: ViewportKind
  /** Desk under 1100 px: the rail is icons only (UX-00 section 8.1). */
  railCollapsed: boolean
}

/** One destination. `permission` is a key from `PERMISSIONS` in `@dos/contracts`. */
export interface NavItem {
  href: string
  /** <= 14 characters; it has to fit a 172 px rail and a phone tab. */
  label: string
  /** The app supplies the glyph; the kit ships no icon set. */
  icon?: ReactNode | undefined
  /** The active glyph, if it differs (a filled version on the phone tab bar). */
  activeIcon?: ReactNode | undefined
  /** `${METHOD} ${pattern}` or a role name — whatever the app's `can()` understands. */
  permission?: string | undefined
  /** A count on the item: approvals waiting, stops left. */
  badge?: number | undefined
}

export interface NavSection {
  /** UPPERCASE eyebrow above the group ("SETUP"). The first section is normally unnamed. */
  title?: string | undefined
  items: readonly NavItem[]
  /**
   * The phone tab bar is built from the section marked `primary` (at most four items, UX-00
   * section 8.2); everything else moves into the overflow sheet.
   */
  primary?: boolean | undefined
}

export interface TenantChoice {
  id: string
  /** `branding.display_name`, else the legal name. */
  name: string
  /** The role this person holds THERE — it can differ per distributor. */
  roleLabel: string
}

/**
 * The tenant switcher of the header. One membership renders as a name, not a menu: there is nothing
 * to switch to, and a dead control is worse than none.
 */
export interface TenantSwitcherProps extends Testable {
  current: TenantChoice
  choices: readonly TenantChoice[]
  onSwitch: (tenantId: string) => void
  /** True while the switch is in flight; the menu closes and the name stays put. */
  busy?: boolean | undefined
  /**
   * The logo only, no name — what fits the 56 px collapsed rail of UX-00 section 8.1. The shell sets
   * it; an app never does. Switching still works: the mark is the button.
   */
  compact?: boolean | undefined
}

export interface AccountMenu {
  name: string
  roleLabel: string
  onSignOut: () => void
  /** Change password, sessions, about. */
  items?: readonly { id: string; label: string; onPress: () => void }[] | undefined
}

/**
 * The shell. It is chosen by VIEWPORT, not by app (docs/08 section 0): the desk shell of UX-00
 * section 8.1 at 1024 px and wider, the phone shell of section 8.2 below it.
 */
export interface AppShellProps extends Testable {
  sections: readonly NavSection[]
  /** The current route. The rail and the tab bar mark the item whose `href` prefixes it. */
  activeHref: string
  onNavigate: (href: string) => void
  /** Hides the items this signed-in role may not reach. Default: everything is allowed. */
  can?: ((item: NavItem) => boolean) | undefined
  tenant?: TenantSwitcherProps | undefined
  /** The app's `<ConnectionStrip>`; the shell places it (rail foot on desk, under the header on a phone). */
  connection?: ReactNode | undefined
  /** The header search box. The phone shell moves it into the overflow sheet. */
  search?: ReactNode | undefined
  account?: AccountMenu | undefined
  children: ReactNode
}

export type { SeriesPoint, Series, CompareGroup, MixSlice }
