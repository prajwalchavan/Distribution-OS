/**
 * The component contracts of UX-00 section 6, written ONCE.
 *
 * `@dos/ui/web` and `@dos/ui/native` both implement these exact prop types, so a screen written
 * against the contract reads identically on either renderer and a component can be ported without
 * re-reading the design document. Nothing renderer-specific (no DOM event, no RN style) appears here.
 */
import type { ReactNode } from 'react'

import type { SeriesPoint, Series, CompareGroup, MixSlice } from './charts/geometry.js'
import type { AgeingBucket, SizeName, StatusFamily } from './tokens.js'

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
 * Digits are appended, never parsed from a float: in `money` mode `1 2 3 4` is 1234 paise.
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

export type { SeriesPoint, Series, CompareGroup, MixSlice }
