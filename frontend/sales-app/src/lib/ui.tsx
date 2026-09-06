/**
 * The furniture every sales screen shares, composed ONLY from the `@dos/ui` contract.
 *
 * Nothing here is a new component in the UX-00 §6 sense. `Panel` is the section heading and hairline
 * §8.1 draws; `Async` is the §6.13 loading / error / empty triple in one place so no screen invents
 * its own; `PageTabs` is the level-2 tab row of §8.1 rendered from `src/nav.ts`; `OrderLineRow` is
 * the row §6.6 specifies for the order editors, which is not a `<ListRow>` because a 69 dp stepper
 * and three 20 sp figures do not fit in 96 dp.
 *
 * A field app, so: `text.tertiary` is never used, a register renders as rows and not as a table, and
 * every tap target inherits the app's own 69 dp floor from the theme rather than naming a size.
 */
import { useSession } from '@dos/api-client/react'
import {
  Box,
  Button,
  Chips,
  EmptyState,
  ErrorState,
  Money,
  Pressable,
  QtyStepper,
  Row,
  Skeleton,
  Stack,
  StatusChip,
  Tabs,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import type { PermissionRole } from '@dos/contracts'
import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'

import { PAGE_TABS } from '../nav'
import { instantWithClock } from './dates'

// ---------------------------------------------------------------------------
// Panels and section furniture
// ---------------------------------------------------------------------------

export interface PanelProps {
  title?: string
  /** Printed under the heading: a range, an "as of", a count. */
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  testID?: string
}

/** UX-00 §8.1: a heading, a hairline and its content on the ground — never a card, never a shadow. */
export function Panel({ title, meta, actions, children, testID }: PanelProps): React.JSX.Element {
  const colors = useColors()
  const hasHead = title !== undefined || meta !== undefined || actions !== undefined
  return (
    <Stack gap={3} testID={testID}>
      {hasHead ? (
        <Stack gap={1} border="bottom" borderTone="hairline" padY={2}>
          <Row justify="between" align="center" gap={3} wrap>
            {title === undefined ? null : (
              <Txt field="title" desk="section" as="h2">
                {title}
              </Txt>
            )}
            {actions}
          </Row>
          {meta === undefined ? null : (
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {meta}
            </Txt>
          )}
        </Stack>
      ) : null}
      {children}
    </Stack>
  )
}

/** A label above its value: the detail row of a shop card. */
export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): React.JSX.Element {
  const colors = useColors()
  return (
    <Stack gap={1} grow>
      <Txt field="label" desk="meta" color={colors.text.secondary}>
        {label}
      </Txt>
      {typeof children === 'string' || typeof children === 'number' ? (
        <Txt field="body" desk="body">
          {children}
        </Txt>
      ) : (
        children
      )}
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// Loading, error and empty — once
// ---------------------------------------------------------------------------

export interface AsyncState {
  isLoading: boolean
  error?: { message: string; kind?: string } | undefined
  refetch?: (() => void) | undefined
}

export interface AsyncProps {
  state: AsyncState | readonly AsyncState[]
  rows?: number
  empty?: boolean
  emptyMessage?: string
  children: ReactNode
}

/**
 * What a screen looks like while it is loading, when the service is unreachable, and when the read
 * answered with nothing — decided once.
 *
 * A cached value repaints first (`@dos/api-client` keeps it), so `isLoading` means "first load with
 * nothing to show" and the skeleton appears once per screen, not on every revalidation.
 */
export function Async({
  state,
  rows = 4,
  empty = false,
  emptyMessage,
  children,
}: AsyncProps): React.JSX.Element {
  const t = useStrings()
  const states: readonly AsyncState[] = Array.isArray(state)
    ? (state as readonly AsyncState[])
    : [state as AsyncState]
  const failed = states.find((one) => one.error !== undefined)
  if (failed?.error !== undefined) {
    return (
      <ErrorState
        message={failed.error.message}
        detail={failed.error.kind}
        actionLabel={failed.refetch === undefined ? undefined : t('action.retry')}
        onAction={failed.refetch}
      />
    )
  }
  if (states.some((one) => one.isLoading)) return <Skeleton rows={rows} />
  if (empty) return <EmptyState message={emptyMessage ?? t('state.empty')} />
  return <>{children}</>
}

/**
 * The offline twin of `<Async>`: a list read from the device rather than from a service.
 *
 * "No shops on this beat" and "the phone has not finished filling up" are different sentences, and a
 * field app that prints the first when it means the second is the most damaging thing this app can
 * do. `hydrated` is the difference — one completed pull.
 */
export function LocalAsync({
  loading,
  hydrated,
  empty,
  emptyMessage,
  waitingMessage,
  rows = 4,
  children,
}: {
  loading: boolean
  hydrated: boolean
  empty: boolean
  emptyMessage: string
  waitingMessage?: string
  rows?: number
  children: ReactNode
}): React.JSX.Element {
  const t = useStrings()
  if (loading) return <Skeleton rows={rows} />
  if (!hydrated) return <EmptyState message={waitingMessage ?? t('s0.filling')} />
  if (empty) return <EmptyState message={emptyMessage} />
  return <>{children}</>
}

// ---------------------------------------------------------------------------
// Level-2 navigation
// ---------------------------------------------------------------------------

/**
 * The page's own tab row (UX-00 §8.1, level 2 of exactly two). Each tab is a real route, so a
 * refresh, a bookmark and the back button all land where the reader was.
 *
 * Over four destinations it renders a CHIP row instead: `<Tabs>` is `items.slice(0, 4)` and drops the
 * fifth without a word, which in the manager app hid four whole features. A screen is never lost to
 * a silent slice here.
 */
export function PageTabs({ group, active }: { group: string; active: string }): React.JSX.Element {
  const t = useStrings()
  const router = useRouter()
  const { session } = useSession()
  const role = session?.role as PermissionRole | undefined
  const tabs = (PAGE_TABS[group] ?? []).filter(
    (tab) => tab.permission === undefined || isAllowed(permissionFor(tab.permission), role ?? null),
  )
  if (tabs.length < 2) return <></>
  const items = tabs.map((tab) => ({ id: tab.href, label: t(tab.labelKey) }))
  if (items.length > 4) {
    return (
      <Chips
        testID="page-tabs"
        items={items.map((item) => ({ ...item, selected: item.id === active }))}
        onToggle={(href) => {
          router.push(href)
        }}
      />
    )
  }
  return (
    <Tabs
      testID="page-tabs"
      items={items}
      value={active}
      onChange={(href) => {
        router.push(href)
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Permissions and identity
// ---------------------------------------------------------------------------

/** "May the person signed in call this?" — asked of the matrix sales-service itself enforces. */
export function useCan(): (path: string) => boolean {
  const { session } = useSession()
  const role = session?.role as PermissionRole | undefined
  return (path) => isAllowed(permissionFor(path), role ?? null)
}

/** The signed-in rep's own user id — the scope of nearly every read on this app. */
export function useMyUserId(): string | null {
  const { session } = useSession()
  return session?.user.id ?? null
}

// ---------------------------------------------------------------------------
// The chips a shop row and a shop card wear
// ---------------------------------------------------------------------------

/**
 * The state of a shop's money, as a colour AND a word (UX-00 §3.4: colour is never the only channel).
 * Nothing is derived here that the service has not already computed — the buckets arrive summed.
 */
export function duesFamily(overduePaise: number, outstandingPaise: number): StatusFamily {
  if (overduePaise > 0) return 'brick'
  if (outstandingPaise > 0) return 'ochre'
  return 'moss'
}

/** The order state families UX-00 §3.3 fixes, in one place so twelve screens agree. */
export function orderFamily(state: string): StatusFamily {
  switch (state) {
    case 'draft':
      return 'neutral'
    case 'submitted':
      return 'ochre'
    case 'cancelled':
      return 'brick'
    case 'delivered':
    case 'closed':
      return 'moss'
    default:
      return 'clay'
  }
}

/**
 * A row of a register that is a phone list: identity, one figure, one chip.
 *
 * It is a `<Pressable>` rather than a `<ListRow>` where the trailing stack needs two figures, which
 * `<ListRow>` deliberately does not carry.
 */
export function TwoLine({
  primary,
  secondary,
  trailing,
  onPress,
  testID,
}: {
  primary: ReactNode
  secondary?: ReactNode
  trailing?: ReactNode
  onPress?: () => void
  testID?: string
}): React.JSX.Element {
  const colors = useColors()
  const body = (
    <Row
      gap={3}
      align="center"
      justify="between"
      padY={2}
      padX={1}
      border="bottom"
      borderTone="faint"
    >
      <Stack gap={1} grow>
        <Txt field="bodyStrong" desk="cell" numberOfLines={1}>
          {primary}
        </Txt>
        {secondary === undefined ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary} numberOfLines={1}>
            {secondary}
          </Txt>
        )}
      </Stack>
      {trailing}
    </Row>
  )
  return onPress === undefined ? (
    <Box testID={testID}>{body}</Box>
  ) : (
    <Pressable onPress={onPress} role="row" testID={testID}>
      {body}
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// The order editor's row (UX-00 §6.6 `<OrderLineRow>`)
// ---------------------------------------------------------------------------

export interface OrderLineRowProps {
  name: string
  /** `2 cs + 4 pc = 52 pc`, already built by `@dos/ui`'s `formatQty`. */
  qtyLine: string
  /** `₹34.00/pc · 24 pc case` — the rate the shop pays, never a cost. */
  rateLine?: string | undefined
  lineTotalPaise: number | null
  /** "−₹68 · 1 free per 10", the scheme as it prints on the row. */
  schemeLabel?: string | undefined
  editing: boolean
  onPress: () => void
  /** Only rendered while editing. */
  stepper?: ReactNode | undefined
  testID?: string
}

/**
 * Collapsed: 80 dp, name, the case line, the line total over the scheme chip. Editing: the rate line,
 * the 69 dp `<QtyStepper>` and the availability line, so the stepper sits under the thumb.
 */
export function OrderLineRow({
  name,
  qtyLine,
  rateLine,
  lineTotalPaise,
  schemeLabel,
  editing,
  onPress,
  stepper,
  testID,
}: OrderLineRowProps): React.JSX.Element {
  const colors = useColors()
  return (
    <Stack
      gap={2}
      padY={3}
      padX={3}
      border="bottom"
      borderTone="faint"
      background={editing ? 'raised' : 'none'}
      testID={testID}
    >
      <Pressable onPress={onPress} role="row" label={name}>
        <Row gap={3} justify="between" align="start">
          <Stack gap={1} grow>
            <Txt field="bodyStrong" desk="cell" numberOfLines={2}>
              {name}
            </Txt>
            <Txt field="moneyM" desk="cell" numeric color={colors.text.secondary}>
              {editing && rateLine !== undefined ? rateLine : qtyLine}
            </Txt>
          </Stack>
          <Stack gap={1} align="end">
            <Money value={lineTotalPaise} size="moneyM" />
            {schemeLabel === undefined ? null : (
              <StatusChip label={schemeLabel} family="clay" figure />
            )}
          </Stack>
        </Row>
      </Pressable>
      {editing ? stepper : null}
      {editing && rateLine !== undefined ? (
        <Txt field="moneyM" desk="cell" numeric color={colors.text.secondary}>
          {qtyLine}
        </Txt>
      ) : null}
    </Stack>
  )
}

/** The stepper, with the app's own floor and the scheme line the row carries. */
export function LineStepper(props: React.ComponentProps<typeof QtyStepper>): React.JSX.Element {
  return <QtyStepper {...props} />
}

// ---------------------------------------------------------------------------
// "As of", the honesty line every read carries
// ---------------------------------------------------------------------------

export function AsOf({ at }: { at: string | number | null | undefined }): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  if (at === null || at === undefined) return <></>
  const iso = typeof at === 'number' ? new Date(at).toISOString() : at
  return (
    <Txt field="label" desk="meta" color={colors.text.secondary}>
      {t('app.asOf', { when: instantWithClock(iso) })}
    </Txt>
  )
}

export function ReloadButton({ onPress }: { onPress: () => void }): React.JSX.Element {
  const t = useStrings()
  return <Button label={t('app.reload')} variant="ghost" onPress={onPress} testID="reload" />
}

// ---------------------------------------------------------------------------
// Counting honestly
// ---------------------------------------------------------------------------

export interface PagedCount {
  count: number | undefined
  more: boolean
}

/**
 * How many are waiting, stated only as far as the read knows. A page that came back full with a
 * `nextCursor` means there are more behind it, so a queue that prints "100" looks like a fact and
 * is not.
 */
export function pagedCount(result: {
  data?: { items: readonly unknown[]; nextCursor?: string | null | undefined } | undefined
}): PagedCount {
  const items = result.data?.items
  if (items === undefined) return { count: undefined, more: false }
  const cursor = result.data?.nextCursor
  return { count: items.length, more: cursor !== null && cursor !== undefined && cursor !== '' }
}

export function countText(of: PagedCount, none: string): string {
  return of.count === undefined ? none : `${String(of.count)}${of.more ? '+' : ''}`
}

/** A plain text cell. Paise never come through here — a figure goes through `<Money>`. */
export function textColumn<T>(
  key: string,
  head: string,
  read: (row: T) => string | number | null,
  extra: Partial<RegisterColumn<T>> = {},
): RegisterColumn<T> {
  return {
    key,
    head,
    priority: 'detail',
    cell: (row) => {
      const value = read(row)
      return (
        <Txt field="body" desk="cell" numeric={typeof value === 'number'} numberOfLines={1}>
          {value === null || value === '' ? '—' : value}
        </Txt>
      )
    },
    ...extra,
  }
}
