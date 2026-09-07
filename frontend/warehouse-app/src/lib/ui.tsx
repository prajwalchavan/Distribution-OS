/**
 * The furniture every godown screen shares, composed ONLY from the `@dos/ui` contract.
 *
 * Nothing here is a new component in the UX-00 §6 sense. `Panel` is the section heading and hairline
 * §8.1 draws; `Async` is the §6.13 loading / error / empty triple in one place so no screen invents
 * its own; `PageTabs` is the level-2 tab row of §8.1 rendered from `src/nav.ts`; `DeskOnly` is the one
 * sentence this app says a dozen times — the step exists, it is simply not the floor's to take.
 *
 * A field app at the 76 dp floor, so: `text.tertiary` is never used, a register renders as rows and
 * not as a table on a phone, and every tap target inherits the app's own floor from the theme rather
 * than naming a size.
 */
import { useSession } from '@dos/api-client/react'
import {
  Box,
  caseLine,
  Chips,
  EmptyState,
  ErrorState,
  formatCount,
  Row,
  Skeleton,
  Stack,
  StatusChip,
  Tabs,
  Txt,
  useColors,
  useStrings,
  type StatusFamily,
} from '@dos/ui'
import { isAllowed, permissionFor } from '@dos/contracts'
import type { PermissionRole } from '@dos/contracts'
import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'

import { PAGE_TABS } from '../nav'
import { daysUntil, longDate } from './dates'

// ---------------------------------------------------------------------------
// Counting, said correctly
// ---------------------------------------------------------------------------

/**
 * A whole count, grouped the Indian way.
 *
 * UX-00 §4.5 rule 3 is "Indian grouping, always" and rule 1 is "every number is tabular".
 * `<Money>` already does it for paise; a piece count printed with `String(n)` does not, and the
 * godown prints big ones — "65414 of 82693 picked" on the fill-rate line, "On hand 1008" on a lot.
 * Same lakh/crore rule as `formatINR`, by hand, so a Hermes without full ICU behaves like the web.
 */
export function count(value: number): string {
  return formatCount(value)
}

/**
 * A stock figure with its unit, for the two screens that read `inventory.stock.balances`.
 *
 * `StockBalanceRow` is pieces and carries no pack, so this app knows the case size only once the
 * device holds the lot. Given it, the dual-unit line of UX-00 §4.5 rule 7 ("4 cs + 9 pc = 201 pc");
 * without it, the pieces WITH THEIR UNIT — never a bare figure, and never "201 cs" for 201 pieces,
 * which is what a hard-coded case size of 1 printed on the van check-in.
 */
export function qtyLine(
  pieces: number,
  caseSize: number | null,
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string,
): string {
  return caseSize === null || caseSize <= 1
    ? t('w.pieces', { pieces: formatCount(pieces) })
    : caseLine(pieces, caseSize, t)
}

/**
 * A count and its noun, in the right number.
 *
 * `interpolate()` in `@dos/ui` substitutes placeholders and knows nothing about plurals, which is
 * why the kit's own catalogue writes "Filters ({count})" rather than "{count} filters". This app has
 * to say "1 carton" and "8 cartons", so every countable string comes as a `key` / `key.one` PAIR and
 * is read through here. Measured before this existed: eight load sheets reading "1 orders · 1
 * cartons" and twenty-nine cycle counts reading "1 lots".
 */
export function pl(
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string,
  key: string,
  count: number,
): string {
  return t(count === 1 ? `${key}.one` : key, { count })
}

/**
 * A queue depth read one page at a time.
 *
 * None of the list procedures this app calls answers a TOTAL — they answer a page and a cursor
 * (`GrnsListOutput`, `PicklistsListOutput`, …). So "20" on the home strip was the page size, not the
 * work: measured on the pilot database, "Bills to count 20" against 200+ still-to-count receipts,
 * "Sheets waiting 20" against 166, "Waves open 40" against 315. A floor is honest; a page size
 * dressed as a count is not. See the gate report's open points for the backend half.
 */
export function atLeast(
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string,
  page: { readonly items: readonly unknown[]; readonly nextCursor: string | null } | undefined,
): string {
  /*
   * NO ANSWER IS NOT ZERO. With warehouse-service stopped the strip correctly said "Offline since
   * 6:47 am" and every panel said "No connection" — while the four biggest figures on the screen
   * read "Bills to count 0 · Waves open 0 · Packed, no bill 0 · Sheets waiting 0", which is a
   * godown being told there is no work. An unread queue is an em dash (UX-00 §6.13, the same
   * character `<Money>` prints for a null).
   */
  if (page === undefined) return t('w.unknown')
  return page.nextCursor === null
    ? String(page.items.length)
    : t('w1.atLeast', { count: page.items.length })
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

/** A label above its value: the detail row of a sheet, a lot or a receipt. */
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
 * The sentence this app says wherever the floor may read a thing but not decide it.
 *
 * docs/23 §4.1: the desk opens and posts a GRN, reviews the extraction, frees a hold, types the
 * e-way bill and cancels a wave; the manager approves the load-out. The screens all SHOW those
 * things — hiding them would leave the floor guessing why nothing moves — and each says, in one
 * line, whose step it is. A button that would 403 is never drawn.
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
        message={failed.error.kind === 'network' ? t('w.noConnectionRead') : failed.error.message}
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
 * "This sheet has no lines" and "the phone has not finished filling up" are different sentences, and
 * a godown app that prints the first when it means the second sends a picker to an empty rack.
 * `hydrated` is the difference — one completed pull.
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
  return (
    <LocalAsyncBody
      loading={loading}
      hydrated={hydrated}
      empty={empty}
      emptyMessage={emptyMessage}
      waitingMessage={waitingMessage}
      rows={rows}
    >
      {children}
    </LocalAsyncBody>
  )
}

function LocalAsyncBody({
  loading,
  hydrated,
  empty,
  emptyMessage,
  waitingMessage,
  rows,
  children,
}: {
  loading: boolean
  hydrated: boolean
  empty: boolean
  emptyMessage: string
  waitingMessage: string
  rows: number
  children: ReactNode
}): React.JSX.Element {
  const colors = useColors()
  if (loading) return <Skeleton rows={rows} />
  /*
   * A HALF-FULL DEVICE STILL HAS ROWS, AND HIDING THEM IS ITS OWN LIE.
   *
   * `hydrated` guards against presenting a partial read set as the whole truth. It used to do that
   * by drawing "Still filling this phone from the server" INSTEAD of everything the device holds —
   * so the picking sheet said "1 of 23 picked" in its header and its bottom bar, "22 lines not yet
   * picked" on the disabled confirm, and drew **none of the 23 rows it had in hand** (measured on
   * PICK-0011 at 1440 × 900 and at 375 × 812). On the web the store is the memory adapter, so the
   * whole read set is re-pulled on every reload — about 70 s and 154 pages on the pilot's data —
   * and for all of it the one screen a picker holds was blank over data it already had.
   *
   * The sentence stays; it goes ABOVE the rows instead of over them. "Nothing here" and "not
   * everything is here yet" stay two different sentences, which is the whole point of the latch.
   */
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

// ---------------------------------------------------------------------------
// Level-2 navigation
// ---------------------------------------------------------------------------

/**
 * The page's own tab row (UX-00 §8.1, level 2 of exactly two). Each tab is a real route, so a
 * refresh, a bookmark and the back button all land where the reader was.
 *
 * Over four destinations it renders a CHIP row instead: `<Tabs>` is `items.slice(0, 4)` and drops the
 * fifth without a word, which in the manager app hid four whole features.
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

/** "May the person signed in call this?" — asked of the matrix warehouse-service itself enforces. */
export function useCan(): (path: string) => boolean {
  const { session } = useSession()
  const role = session?.role as PermissionRole | undefined
  return (path) => isAllowed(permissionFor(path), role ?? null)
}

/** The signed-in hand's own user id — who a pick and a count are recorded against. */
export function useMyUserId(): string | null {
  const { session } = useSession()
  return session?.user.id ?? null
}

// ---------------------------------------------------------------------------
// The chips a lot, a sheet and a receipt wear
// ---------------------------------------------------------------------------

/** The three states of a batch date, as a colour AND a word (UX-00 §3.4). */
export function ExpiryChip({
  expiryDate,
  testID,
}: {
  expiryDate: string | null
  testID?: string
}): React.JSX.Element {
  const t = useStrings()
  if (expiryDate === null)
    return <StatusChip label={t('w.noExpiry')} family="neutral" {...(testID ? { testID } : {})} />
  const days = daysUntil(expiryDate)
  if (days < 0)
    return (
      <StatusChip
        label={t('w.expired', { date: longDate(expiryDate) })}
        family="brick"
        solid
        {...(testID ? { testID } : {})}
      />
    )
  if (days <= 90)
    return (
      <StatusChip
        label={t('w.expiringDays', { days })}
        family="ochre"
        {...(testID ? { testID } : {})}
      />
    )
  return (
    <StatusChip
      label={t('w.expiry', { date: longDate(expiryDate) })}
      family="neutral"
      {...(testID ? { testID } : {})}
    />
  )
}

/** The picklist / load-sheet / GRN status families UX-00 §3.3 fixes, in one place so ten screens agree. */
export function workFamily(status: string): StatusFamily {
  switch (status) {
    case 'open':
    case 'draft':
    case 'counting':
      return 'ochre'
    case 'picking':
    case 'extracting':
    case 'verifying':
    case 'uploaded':
      return 'clay'
    case 'picked':
    case 'packed':
    case 'posted':
    case 'confirmed':
    case 'committed':
    case 'reconciled':
      return 'moss'
    case 'cancelled':
    case 'rejected':
    case 'failed':
      return 'brick'
    default:
      return 'neutral'
  }
}
