/**
 * The furniture every console screen shares, composed ONLY from the `@dos/ui` contract.
 *
 * Nothing here is a new component in the UX-00 §6 sense: `Panel` is the section heading + hairline
 * §8.1 draws, `Async` is the §6.13 loading / error / empty triple in one place so no screen invents
 * its own, and the column helpers are the cells this app writes over and over.
 *
 * ONE RULE WORTH REPEATING HERE. `<Register>` in `field` density draws the `identity`, `value` and
 * `chip` columns and DROPS every `detail` one — and this app is `desk` density on a laptop and
 * `field` on a phone (the theme follows the viewport, docs/08 §0). So every register in this console
 * gives its three most important facts those priorities and hands the rest to a `<Sheet>` opened by
 * `onSelect`, which is also the side panel the desk shell wants. A `detail` column is extra, never
 * the only place a fact lives.
 */
import {
  Button,
  EmptyState,
  ErrorState,
  Money,
  Row,
  Skeleton,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  useTheme,
  useViewport,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Panels and section furniture
// ---------------------------------------------------------------------------

export interface PanelProps {
  title?: string | undefined
  /** Printed under the heading: a range, an "as of", a count. */
  meta?: ReactNode | undefined
  actions?: ReactNode | undefined
  children: ReactNode
  testID?: string | undefined
}

/** UX-00 §8.1: a heading, a hairline, and its content on the ground — never a card, never a shadow. */
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

/** Two panels side by side on a desk viewport, one under the other on a phone. */
export function Columns({ children }: { children: ReactNode }): React.JSX.Element {
  const viewport = useViewport()
  if (viewport.kind === 'phone') return <Stack gap={6}>{children}</Stack>
  return (
    <Row gap={6} align="stretch">
      {children}
    </Row>
  )
}

export function Half({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Stack grow gap={4} width="full">
      {children}
    </Stack>
  )
}

/** A label above its value: the detail-panel row. */
export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): React.JSX.Element {
  const colors = useColors()
  return (
    <Stack gap={1}>
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

/** A sentence the reader should act on, set apart from the data it is about. */
export function Note({
  children,
  tone = 'neutral',
  testID,
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | StatusFamily
  testID?: string
}): React.JSX.Element {
  const colors = useColors()
  const background = tone === 'accent' ? 'raised' : 'sunken'
  return (
    <Stack pad={4} background={background} radius="sm" testID={testID}>
      <Txt field="body" desk="body" color={colors.text.secondary}>
        {children}
      </Txt>
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
  /** How many skeleton rows to reserve — content-shaped, at real row heights (UX-00 §6.13). */
  rows?: number
  /** True when the reads succeeded but there is nothing to draw. */
  empty?: boolean
  emptyMessage?: string
  children: ReactNode
}

/**
 * The one place this app decides what a screen looks like while it is loading, when a service is
 * unreachable and when a query answered with nothing. A cached value repaints first
 * (`@dos/api-client` keeps it), so `isLoading` means "first load with nothing to show".
 */
export function Async({
  state,
  rows = 6,
  empty = false,
  emptyMessage,
  children,
}: AsyncProps): React.JSX.Element {
  const t = useStrings()
  const states: readonly AsyncState[] = Array.isArray(state)
    ? (state as readonly AsyncState[])
    : [state as AsyncState]
  const failed = states.find((s) => s.error !== undefined)
  if (failed?.error !== undefined) {
    // A read that failed is not a write that is waiting: see `app.noConnectionRead` in strings.ts.
    const message =
      failed.error.kind === 'network' ? t('app.noConnectionRead') : failed.error.message
    return (
      <ErrorState
        message={message}
        detail={failed.error.kind}
        actionLabel={failed.refetch === undefined ? undefined : t('app.retry')}
        onAction={failed.refetch}
      />
    )
  }
  if (states.some((s) => s.isLoading)) return <Skeleton rows={rows} />
  if (empty) return <EmptyState message={emptyMessage ?? t('state.empty')} />
  return <>{children}</>
}

// ---------------------------------------------------------------------------
// Cells a register uses over and over
// ---------------------------------------------------------------------------

export function textCell<T>(read: (row: T) => string | number | null): (row: T) => ReactNode {
  return (row) => {
    const value = read(row)
    return (
      <Txt field="body" desk="cell" numeric={typeof value === 'number'} numberOfLines={1}>
        {value === null || value === '' ? '—' : value}
      </Txt>
    )
  }
}

export function textColumn<T>(
  key: string,
  head: string,
  read: (row: T) => string | number | null,
  extra: Partial<RegisterColumn<T>> = {},
): RegisterColumn<T> {
  return { key, head, cell: textCell(read), priority: 'detail', ...extra }
}

/**
 * A count, with its unit when the head is not there to carry it.
 *
 * `<Register>` in `field` density draws the `value` column as a bare trailing figure and no head at
 * all, so a phone showed "2,454" beside a distributorship's name with nothing saying what 2,454
 * WAS. On a desk the column head says it and the unit would be a repetition, so the cell reads the
 * density and prints the unit only where the head has gone.
 */
function Count({ value, unit }: { value: number | null; unit?: string }): React.JSX.Element {
  const { density } = useTheme()
  if (value === null) {
    return (
      <Txt field="body" desk="cell" numeric>
        —
      </Txt>
    )
  }
  const figure = value.toLocaleString('en-IN')
  return (
    <Txt field="body" desk="cell" numeric>
      {unit !== undefined && density === 'field' ? `${figure} ${unit}` : figure}
    </Txt>
  )
}

/** A right-aligned count. Tabular digits, so a column of them lines up on the units place. */
export function countColumn<T>(
  key: string,
  head: string,
  read: (row: T) => number | null,
  extra: Partial<RegisterColumn<T>> & { unit?: string } = {},
): RegisterColumn<T> {
  const { unit, ...rest } = extra
  return {
    key,
    head,
    align: 'right',
    priority: 'detail',
    cell: (row) => <Count value={read(row)} {...(unit === undefined ? {} : { unit })} />,
    ...rest,
  }
}

/**
 * A right-aligned money column with the ₹ in its head (UX-00 §4.5 rule 5). The only money in this
 * console is OUR price to a distributor — a subscription — never a rupee of their own trade.
 */
export function moneyColumn<T>(
  key: string,
  head: string,
  read: (row: T) => number | null,
  extra: Partial<RegisterColumn<T>> = {},
): RegisterColumn<T> {
  return {
    key,
    head,
    align: 'right',
    priority: 'value',
    cell: (row) => <Money value={read(row)} size="cell" symbol={false} />,
    ...extra,
  }
}

export function chipColumn<T>(
  key: string,
  head: string,
  read: (row: T) => { label: string; family: StatusFamily; solid?: boolean } | null,
  extra: Partial<RegisterColumn<T>> = {},
): RegisterColumn<T> {
  return {
    key,
    head,
    priority: 'chip',
    cell: (row) => {
      const chip = read(row)
      return chip === null ? (
        <Txt field="body" desk="cell">
          —
        </Txt>
      ) : (
        <StatusChip label={chip.label} family={chip.family} solid={chip.solid} />
      )
    },
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Status colour, in one place
// ---------------------------------------------------------------------------

/** A distributorship's own state. `suspended` is the one that stops their work, so it is solid. */
export function tenantFamily(status: string): StatusFamily {
  if (status === 'active') return 'moss'
  if (status === 'suspended') return 'brick'
  return 'neutral'
}

/** A subscription's state: paying, on trial, late, stopped. */
export function subscriptionFamily(status: string | null): StatusFamily {
  switch (status) {
    case 'active':
      return 'moss'
    case 'trialing':
      return 'clay'
    case 'past_due':
      return 'ochre'
    case 'suspended':
      return 'brick'
    default:
      return 'neutral'
  }
}

/**
 * A `requested` grant that can never be opened any more.
 *
 * The window is counted from the moment it was ASKED for, not from the moment it is approved
 * (`support.service.ts`: `expiresAt = requestedAt + hours`, and an approval whose window already
 * ended is refused with `request_expired`). So a four-hour ask made yesterday still reads
 * `status: 'requested'` on the wire, and a console that printed "waiting for their owner" would be
 * telling its reader to wait for something that cannot happen. Measured on the pilot's own seeded
 * request, which answered 409 `request_expired` when its owner tried to approve it.
 */
export function askLapsed(
  grant: { status: string; requestedAt: string; requestedHours: number },
  now: number = Date.now(),
): boolean {
  if (grant.status !== 'requested') return false
  const asked = Date.parse(grant.requestedAt)
  return !Number.isNaN(asked) && asked + grant.requestedHours * 3_600_000 <= now
}

/** A support grant: waiting on the owner, open, or shut (refused, handed back, lapsed). */
export function grantFamily(status: string, active: boolean): StatusFamily {
  if (active) return 'moss'
  if (status === 'requested') return 'clay'
  if (status === 'rejected') return 'brick'
  return 'neutral'
}

// ---------------------------------------------------------------------------
// Small shared controls
// ---------------------------------------------------------------------------

/**
 * The count a screen puts in its `context` line — and NOTHING when the read failed.
 *
 * "Showing 0" over a dead connection is a lie in the shape of a fact: it says the platform has no
 * distributorships, when what happened is that nobody answered. Measured with admin-service
 * blocked. The register underneath says why; the header simply stops claiming a number.
 */
export function showingCount(
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string,
  query: { error?: unknown; isLoading: boolean },
  count: number,
): string | undefined {
  if (query.error !== undefined) return t('app.notLoaded')
  if (query.isLoading) return undefined
  return t('app.showing', { count })
}

/**
 * What `<Search>` may honestly claim about its own result. `noResults` says "nothing matches", which
 * is only true when the service ANSWERED and answered with nothing — never when the read failed and
 * never before anyone has typed.
 */
export function searchState(
  query: {
    error?: unknown
    isFetching: boolean
    isLoading: boolean
  },
  term: string,
  count: number,
): 'idle' | 'typing' | 'results' | 'noResults' | 'error' {
  if (query.error !== undefined) return 'error'
  if (query.isFetching || query.isLoading) return 'typing'
  if (count > 0) return 'results'
  return term === '' ? 'idle' : 'noResults'
}

export function ReloadButton({ onPress }: { onPress: () => void }): React.JSX.Element {
  const t = useStrings()
  return <Button label={t('app.reload')} variant="ghost" onPress={onPress} testID="reload" />
}

export function AsOf({ at }: { at: string | number | null | undefined }): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  if (at === null || at === undefined) return <></>
  return (
    <Txt field="label" desk="meta" color={colors.text.secondary}>
      {t('app.asOf', { when: typeof at === 'string' ? at : new Date(at).toISOString() })}
    </Txt>
  )
}
