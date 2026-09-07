/**
 * The furniture every delivery screen shares, composed ONLY from the `@dos/ui` contract.
 *
 * Nothing here is a new component in the UX-00 §6 sense. `Panel` is the section heading and hairline
 * §8.1 draws; `Async` is the §6.13 loading / error / empty triple in one place so no screen invents
 * its own; `LocalAsync` is its offline twin, because "this stop has no bills" and "the phone has not
 * finished filling up" are different sentences and a driver acting on the first when the second is
 * true drives away from a shop that was waiting.
 *
 * A field app: `text.tertiary` is never used (UX-00 §3 rule 3), every tap target inherits the app's
 * own floor from the theme rather than naming a size, and the three STOP actions name `floor`
 * explicitly (UX-00 §5.2: "76 dp for every warehouse target and the delivery stop actions").
 */
import { useSession } from '@dos/api-client/react'
import {
  Box,
  EmptyState,
  ErrorState,
  formatCount,
  Row,
  Skeleton,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  type StatusFamily,
  wordFor,
} from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import type { PermissionRole } from '@dos/contracts'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Counting, said correctly
// ---------------------------------------------------------------------------

/**
 * A whole count, grouped the Indian way (UX-00 §4.5 rule 3). `<Money>` already does it for paise; a
 * piece count printed with `String(n)` does not, and a van carries five-figure piece counts.
 */
export function count(value: number): string {
  return formatCount(value)
}

/** A count and its noun, in the right number — `key` / `key.one` pairs, read through here. */
export function pl(
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string,
  key: string,
  n: number,
): string {
  return t(n === 1 ? `${key}.one` : key, { count: n })
}

// ---------------------------------------------------------------------------
// Panels and section furniture
// ---------------------------------------------------------------------------

export interface PanelProps {
  title?: string
  /** Printed under the heading: a count, an "as of", a reason. */
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

/** A label above its value: the detail row of a stop, a bill, a receipt. */
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

/**
 * The sentence this app says where the crew may see a thing but not decide it — the cashier counts
 * the money, the godown counts the van, the office closes the trip (docs/23 §5.1 D8: `trips.settle`
 * is not the crew's, by design). The screens all SHOW those steps, because hiding them would leave a
 * driver guessing why nothing closes; each says, in one line, whose step it is.
 */
export function DeskOnly({ children }: { children: string }): React.JSX.Element {
  const colors = useColors()
  return (
    <Box background="sunken" pad={3} radius="sm">
      <Txt field="label" desk="meta" color={colors.text.secondary}>
        {children}
      </Txt>
    </Box>
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
 * nothing to show" and the skeleton appears once per screen, not on every revalidation. A network
 * failure says the picture is stale, never that it is sending: a READ is not a write.
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
        message={failed.error.kind === 'network' ? t('d.noConnectionRead') : failed.error.message}
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
 * The offline twin of `<Async>`: a list read from the DEVICE rather than from a service.
 *
 * `hydrated` guards against presenting a half-arrived read set as the whole truth — and it does that
 * by putting the sentence ABOVE the rows, never over them. Drawing "still filling" instead of the
 * rows is what hid a picking sheet's own 23 lines in the warehouse gate; a driver's bill list would
 * fail the same way and worse, because the alternative to reading it is driving off.
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
  waitingMessage: string
  rows?: number
  children: ReactNode
}): React.JSX.Element {
  const colors = useColors()
  if (loading) return <Skeleton rows={rows} />
  if (empty) return <EmptyState message={hydrated ? emptyMessage : waitingMessage} />
  if (hydrated) return <>{children}</>
  return (
    <Stack gap={3}>
      <Txt field="label" desk="meta" color={colors.text.secondary} testID="local-filling">
        {waitingMessage}
      </Txt>
      {children}
    </Stack>
  )
}

/**
 * The sentence a screen that NAMES A TRIP must carry until the device has finished one pull.
 *
 * `useHydrated()` is a fact about the DEVICE, not about a list: until it is true the read set is
 * arriving table by table, and `pickCurrentTrip` is therefore a guess over whatever has landed. It is
 * a guess with consequences — measured in this app's gate, `/` named TRIP-NEXT while `/trip/start`
 * and `/expenses` named TRIP-ACTIVE for the twenty seconds the first pull took, and the start screen
 * put a "Start the trip" button under the wrong one. Screens that decide WHICH TRIP now say so, above
 * the content and never over it (the warehouse gate's rule), and the two screens that would WRITE
 * against that guess wait for the pull rather than post an expense or a departure to another trip.
 */
export function FillingNote({
  hydrated,
  testID,
}: {
  hydrated: boolean
  testID?: string
}): React.JSX.Element | null {
  const t = useStrings()
  const colors = useColors()
  if (hydrated) return null
  return (
    <Txt
      field="label"
      desk="meta"
      color={colors.status.ochre.fg}
      testID={testID ?? 'trip-provisional'}
    >
      {t('d.tripProvisional')}
    </Txt>
  )
}

// ---------------------------------------------------------------------------
// Permissions and identity
// ---------------------------------------------------------------------------

/** "May the person signed in call this?" — asked of the matrix delivery-service itself enforces. */
export function useCan(): (path: string) => boolean {
  const { session } = useSession()
  const role = session?.role as PermissionRole | undefined
  return (path) => isAllowed(permissionFor(path), role ?? null)
}

/** The signed-in crew member's own user id — who a delivery and a receipt are recorded against. */
export function useMyUserId(): string | null {
  const { session } = useSession()
  return session?.user.id ?? null
}

// ---------------------------------------------------------------------------
// The chips a trip, a stop and a delivery wear (UX-00 §3.3)
// ---------------------------------------------------------------------------

/** Colour is never the only channel: every one of these carries its word (UX-00 §3.4). */
export function tripFamily(state: string): StatusFamily {
  switch (state) {
    case 'planned':
      return 'neutral'
    case 'loading':
      return 'clay'
    case 'active':
      return 'moss'
    case 'closing':
      return 'ochre'
    case 'settled':
      return 'moss'
    case 'settled_with_variance':
      return 'ochre'
    case 'cancelled':
      return 'brick'
    default:
      return 'neutral'
  }
}

/** UX-00 §3.3: Delivered moss · Partial ochre · Failed brick SOLID · Not yet neutral. */
export function stopFamily(state: string): StatusFamily {
  switch (state) {
    case 'delivered':
      return 'moss'
    case 'partial':
      return 'ochre'
    case 'failed':
      return 'brick'
    case 'started':
    case 'arrived':
      return 'clay'
    default:
      return 'neutral'
  }
}

export function StopChip({ state, testID }: { state: string; testID?: string }): React.JSX.Element {
  const t = useStrings()
  return (
    <StatusChip
      label={wordFor(t, state)}
      family={stopFamily(state)}
      solid={state === 'failed'}
      {...(testID === undefined ? {} : { testID })}
    />
  )
}
