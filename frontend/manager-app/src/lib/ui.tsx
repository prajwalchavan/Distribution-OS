/**
 * The furniture every manager/accountant screen shares, composed ONLY from the `@dos/ui` contract.
 *
 * Nothing here is a new component in the UX-00 §6 sense: `Panel` is the section heading + hairline
 * that §8.1 draws ("a panel is a heading, a hairline and its content"), `Async` is the §6.13 loading /
 * error / empty triple in one place so no screen invents its own, and `PageTabs` is the level-2 tab
 * row of §8.1 rendered from `src/nav.ts` — one definition, not one per page.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  ErrorState,
  EmptyState,
  Money,
  Row,
  Segments,
  Skeleton,
  Stack,
  Tabs,
  Txt,
  useColors,
  useStrings,
  useViewport,
  type RegisterColumn,
} from '@dos/ui'
import { documents } from '@dos/ui/platform'
import { REGISTER_WINDOW_DAYS, isAllowed, permissionFor } from '@dos/contracts'
import type { PermissionRole, Retailer, ReportExportFormat, ReportRegister } from '@dos/contracts'
import { useRouter } from 'expo-router'
import { useState, type ReactNode } from 'react'

import { PAGE_TABS } from '../nav'
import { absoluteUrl } from '../config'
import { clampWindow, instantWithClock, type DateRange } from './dates'

// ---------------------------------------------------------------------------
// Panels and section furniture
// ---------------------------------------------------------------------------

export interface PanelProps {
  title?: string
  /** Printed under the heading: a range, an "as of", a total. */
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  testID?: string
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

/**
 * Two panels side by side on a desk viewport, one under the other on a phone.
 *
 * It switches on the VIEWPORT rather than wrapping a flex row: `<Half>` grows, so a wrapped row still
 * fitted both halves on one line and shrank them — on a 375 px screen that clipped the ageing ladder's
 * figures off the right edge. A phone gets a column, which is what UX-00 §8.2 draws.
 */
export function Columns({ children }: { children: ReactNode }): React.JSX.Element {
  const viewport = useViewport()
  if (viewport.kind === 'phone') {
    return <Stack gap={6}>{children}</Stack>
  }
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
 * unreachable and when a query answered with nothing.
 *
 * A cached value repaints first (`@dos/api-client` keeps it), so `isLoading` means "first load with
 * nothing to show" and the skeleton appears once per screen, not on every revalidation.
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
    return (
      <ErrorState
        message={failed.error.message}
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
// Level-2 navigation
// ---------------------------------------------------------------------------

/**
 * The page's own tab row (UX-00 §8.1, level 2 of exactly two). Each tab is a real route, so a refresh,
 * a bookmark and the browser's back button all land where the reader was.
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
  return (
    <Tabs
      testID="page-tabs"
      items={tabs.map((tab) => ({ id: tab.href, label: t(tab.labelKey) }))}
      value={active}
      onChange={(href) => {
        router.push(href)
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

export type { RangeId } from './dates'

/** The 7 / 30 / 90 / FY switch every register and every chart on this app offers. */
export function RangeSegments({
  value,
  onChange,
  testID,
}: {
  value: string
  onChange: (id: string) => void
  testID?: string
}): React.JSX.Element {
  const t = useStrings()
  return (
    <Segments
      testID={testID}
      value={value}
      onChange={onChange}
      items={[
        { id: 'd7', label: t('app.days7') },
        { id: 'd30', label: t('app.days30') },
        { id: 'd90', label: t('app.days90') },
        { id: 'fy', label: t('app.fy') },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// Cells a register uses over and over
// ---------------------------------------------------------------------------

/** A money cell. Paise in, formatted at the edge; the head states the ₹ so the cell does not repeat it. */
export function moneyCell<T>(
  read: (row: T) => number | null,
  tone?: 'default' | 'positive' | 'critical' | 'secondary',
): (row: T) => ReactNode {
  return (row) => <Money value={read(row)} size="cell" symbol={false} tone={tone} />
}

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

/** A right-aligned money column with the ₹ in its head, as UX-00 §4.5 rule 5 requires. */
export function moneyColumn<T>(
  key: string,
  head: string,
  read: (row: T) => number | null,
  extra: Partial<RegisterColumn<T>> = {},
): RegisterColumn<T> {
  return { key, head, align: 'right', cell: moneyCell(read), priority: 'value', ...extra }
}

export function textColumn<T>(
  key: string,
  head: string,
  read: (row: T) => string | number | null,
  extra: Partial<RegisterColumn<T>> = {},
): RegisterColumn<T> {
  return { key, head, cell: textCell(read), priority: 'detail', ...extra }
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

// ---------------------------------------------------------------------------
// Name lookups
// ---------------------------------------------------------------------------

/**
 * `retailers.list` and `retailers.get` answer a UNION: a staff row carries `code`, `tier` and the
 * credit block, a retailer-role row carries only the public shape. A manager and an accountant both
 * get the staff row — but the type says "maybe", and the app narrows rather than casting, because the day someone
 * mounts this screen behind another service the compiler is the only thing that will notice.
 */
export function staffRetailer<T extends { name: string }>(row: T): (T & Retailer) | null {
  return 'code' in row ? (row as T & Retailer) : null
}

export interface Names {
  retailer: (id: string | null | undefined) => string
  staff: (id: string | null | undefined) => string
  beat: (id: string | null | undefined) => string
  supplier: (id: string | null | undefined) => string
  location: (id: string | null | undefined) => string
  variant: (id: string | null | undefined) => string
  loading: boolean
}

/**
 * Registers on this contract carry ids, not names — `orders.list` gives a `retailerId`,
 * `receivables.receipts.list` a `receivedBy`. Rather than let every screen invent its own join, one
 * hook loads the three masters the owner app reads on nearly every page under a shared cache key, so
 * the second screen to ask pays nothing. (An API gap: the list rows could carry the name themselves.)
 */
export function useNames(): Names {
  const api = useApi()
  const { session } = useSession()
  const on = session !== null
  const retailers = useQuery(
    ['names', 'retailers'],
    () => api.api.retailers.list({ limit: 500, activeOnly: true }),
    { staleTime: 300_000, enabled: on },
  )
  const staff = useQuery(['names', 'staff'], () => api.api.tenancy.staff.list(), {
    staleTime: 300_000,
    enabled: on,
  })
  const beats = useQuery(['names', 'beats'], () => api.api.retailers.beats.list({}), {
    staleTime: 300_000,
    enabled: on,
  })
  /*
   * The two masters the OWNER app never needed and this one reads on half its screens: a supplier
   * bill, a GRN, a claim and a purchase order all carry `supplierId`, and every stock row, picklist
   * and load sheet carries a `locationId` that is a godown or a vehicle.
   */
  const suppliers = useQuery(['names', 'suppliers'], () => api.api.tenantCatalog.suppliers({}), {
    staleTime: 300_000,
    enabled: on,
  })
  const locations = useQuery(['names', 'locations'], () => api.api.inventory.locations.list({}), {
    staleTime: 300_000,
    enabled: on,
  })
  /*
   * A goods receipt line, a stock ledger row and a claim line all carry a bare `variantId`. The
   * catalog is the master that turns it into the name printed on the case.
   */
  const variants = useQuery(
    ['names', 'variants'],
    () => api.api.tenantCatalog.list({ limit: 500 }),
    { staleTime: 300_000, enabled: on },
  )

  const find = <T,>(
    items: readonly T[] | undefined,
    idOf: (item: T) => string,
    nameOf: (item: T) => string,
    id: string | null | undefined,
  ): string => {
    if (id === null || id === undefined || id === '') return '—'
    const hit = items?.find((item) => idOf(item) === id)
    return hit === undefined ? id.slice(0, 8) : nameOf(hit)
  }

  return {
    retailer: (id) =>
      find(
        retailers.data?.items,
        (r) => r.id,
        (r) => r.name,
        id,
      ),
    staff: (id) =>
      find(
        staff.data?.items,
        (s) => s.userId,
        (s) => s.name,
        id,
      ),
    beat: (id) =>
      find(
        beats.data?.items,
        (b) => b.id,
        (b) => b.name,
        id,
      ),
    supplier: (id) =>
      find(
        suppliers.data?.items,
        (s) => s.id,
        (s) => s.name,
        id,
      ),
    location: (id) =>
      find(
        locations.data?.items,
        (l) => l.id,
        (l) => l.name,
        id,
      ),
    variant: (id) =>
      find(
        variants.data?.items,
        (v) => v.variantId,
        (v) => v.name,
        id,
      ),
    loading: retailers.isLoading || staff.isLoading || beats.isLoading,
  }
}

// ---------------------------------------------------------------------------
// Export — a register's rows, rendered by the worker and handed back as a signed URL
// ---------------------------------------------------------------------------

/**
 * "Every list is exportable" goes through `reporting.exports.request`: the worker
 * renders the register with the SAME filters the screen is showing and answers a short-lived signed
 * URL. The app never builds a CSV itself — a second implementation of a register is a second set of
 * numbers.
 */
export function ExportButton({
  register,
  filters,
  format = 'csv',
  testID,
}: {
  register: ReportRegister
  filters: Readonly<Record<string, unknown>>
  format?: ReportExportFormat
  testID?: string
}): React.JSX.Element {
  /*
   * `exports.request` enforces the register's own window cap BEFORE it queues a job, so a "This FY"
   * range against a 92-day register is a 400 rather than a report. The button narrows the window to
   * what the register serves instead of failing — using the contract's own numbers, not a copy.
   */
  const cap = REGISTER_WINDOW_DAYS[register as keyof typeof REGISTER_WINDOW_DAYS] as
    number | undefined
  const windowed: Readonly<Record<string, unknown>> =
    cap === undefined || typeof filters.from !== 'string' || typeof filters.to !== 'string'
      ? filters
      : {
          ...filters,
          ...clampWindow({ from: filters.from, to: filters.to } satisfies DateRange, cap),
        }
  const t = useStrings()
  const api = useApi()
  const [url, setUrl] = useState<string | null>(null)

  const request = useMutation(
    (_input: null, meta) =>
      api.api.reporting.exports.request({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        register,
        format,
        filters: windowed,
      }),
    {
      onSuccess: (result) => {
        setUrl(result.item.url)
      },
    },
  )

  const job = useQuery(
    ['export', request.data?.item.id ?? 'none'],
    () => api.api.reporting.exports.get({ id: request.data?.item.id ?? '' }),
    { enabled: request.data !== undefined && url === null, staleTime: 1000 },
  )

  const ready = url ?? job.data?.item.url ?? null

  if (ready !== null) {
    return (
      <Button
        testID={testID}
        label={t('app.exportReady')}
        variant="secondary"
        onPress={() => {
          const absolute = absoluteUrl(ready)
          if (absolute !== null) void documents.open(absolute)
        }}
      />
    )
  }

  return (
    <Button
      testID={testID}
      label={request.status === 'pending' ? t('app.exportQueued') : t('app.export')}
      variant="secondary"
      loading={request.status === 'pending' || job.isFetching}
      onPress={() => {
        request.reset()
        setUrl(null)
        request.mutate(null)
      }}
    />
  )
}

export function ReloadButton({ onPress }: { onPress: () => void }): React.JSX.Element {
  const t = useStrings()
  return <Button label={t('app.reload')} variant="ghost" onPress={onPress} testID="reload" />
}

// ---------------------------------------------------------------------------
// Two roles, one app
// ---------------------------------------------------------------------------

/**
 * "May the person signed in call this?" — asked of the SAME `PERMISSIONS` matrix manager-service
 * enforces, never of a second list kept here.
 *
 * This app serves `manager` and `accountant` from one codebase, and the difference between them is
 * not cosmetic: the founder's 2026-09-05 decision makes the accountant the money desk and a reader,
 * and `permissions.ts` already carries that narrowing (`orders.confirm`, `pricing.*.upsert`,
 * `retailers.setCredit`, `warehouse.*`, `billing.invoices.cancel` are owner + manager). So every
 * control that writes asks this before it renders, and a control the matrix would refuse is ABSENT
 * rather than greyed — a disabled button with no cause is the thing UX-00 §6.1 forbids, and here the
 * cause ("you are the accountant") is not something the accountant can act on.
 */
export function useCan(): (path: string) => boolean {
  const { session } = useSession()
  const role = session?.role as PermissionRole | undefined
  return (path) => isAllowed(permissionFor(path), role ?? null)
}

/** The signed-in role, for the one or two places a screen genuinely reads it (an eyebrow, a hint). */
export function useRole(): PermissionRole | null {
  const { session } = useSession()
  return (session?.role as PermissionRole | undefined) ?? null
}

/**
 * How many are waiting — stated ONLY as far as the read actually knows.
 *
 * Two things can make a count a lie on these screens, and this is the one place both are handled.
 * A read that has NOT answered has no count at all (the owner gate found the other half of this:
 * "Needs you (0)" printed over a panel whose own body was reporting a failure). And every list here
 * is PAGED — a page that came back full with a `nextCursor` means there are more behind it, so a
 * 143-deep queue that prints "100" looks like a fact and is not.
 */
export interface PagedCount {
  count: number | undefined
  more: boolean
}

export function pagedCount(result: {
  data?: { items: readonly unknown[]; nextCursor?: string | null | undefined } | undefined
}): PagedCount {
  const items = result.data?.items
  if (items === undefined) return { count: undefined, more: false }
  const cursor = result.data?.nextCursor
  return { count: items.length, more: cursor !== null && cursor !== undefined && cursor !== '' }
}

/** `100` or `100+`; the caller's own "nothing yet" word while the read has not answered. */
export function countText(of: PagedCount, none: string): string {
  return of.count === undefined ? none : `${String(of.count)}${of.more ? '+' : ''}`
}

/** Two paged counts added up, still honest about the cap. */
export function addCounts(a: PagedCount, b: PagedCount): PagedCount {
  if (a.count === undefined && b.count === undefined) return { count: undefined, more: false }
  return { count: (a.count ?? 0) + (b.count ?? 0), more: a.more || b.more }
}

/**
 * A `<Register>` footer figure for a page that MAY BE CAPPED — the other half of `countText`.
 *
 * Every register here sums its own rows into the totals row, and every list here is paged: the
 * billing desk's foot read "200+ · ₹13,28,937.00" over a queue of more than two hundred orders, so
 * the count admitted there were more and the rupee figure beside it silently claimed to be the whole
 * queue. It was the first hundred (or two hundred) rows, to the paisa — a partial sum in the shape
 * of a total, on the screen a manager uses to decide what is left to do today.
 *
 * The rule, in one place: a footer states a MONEY or QUANTITY total only when the whole set is on
 * the page. When it is not, the cell is empty and the count beside it says `200+`. Where a service
 * answers its own `totals` for the filtered set (`receipts.list`, `repProductivity`) that figure is
 * used directly and never goes through here.
 */
export function pageTotal<T>(of: PagedCount, figure: T): T | undefined {
  return of.more || of.count === undefined ? undefined : figure
}
