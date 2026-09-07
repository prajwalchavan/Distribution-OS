/**
 * The furniture every shopkeeper screen shares, composed ONLY from the `@dos/ui` contract.
 *
 * Nothing here is a new component in the UX-00 §6 sense. `Panel` is the section heading and hairline
 * §8.1 draws; `Async` is the §6.13 loading / error / empty triple in one place so no screen invents
 * its own; `PageTabs` is the level-2 tab row of §8.1 rendered from `src/nav.ts`; `TwoLine` is the
 * §6.6 row where the trailing stack needs two figures, which `<ListRow>` deliberately does not carry.
 *
 * A field app, so: `text.tertiary` is never used, a register renders as rows and not as a table on a
 * phone, and every tap target inherits the app's own 69 dp floor from the theme.
 *
 * ONLINE ONLY, AND HONEST ABOUT IT (docs/23 §6.4). This app keeps nothing on the device, so `<Async>`
 * distinguishes "there is nothing" from "we could not reach your distributor" and never dresses the
 * second as the first.
 */
import { useSession } from '@dos/api-client/react'
import {
  Box,
  Button,
  Chips,
  EmptyState,
  ErrorState,
  Pressable,
  Row,
  Skeleton,
  Stack,
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

/** A label above its value: the detail row of a bill or a shop card. */
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
 * What a screen looks like while it is loading, when the distributor's service is unreachable, and
 * when the read answered with nothing — decided once.
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
    /*
     * A READ THAT FAILED IS NOT A WRITE THAT IS WAITING.
     *
     * `@dos/api-client`'s default sentence for a lost connection is "No connection. This will send
     * when the signal is back." — true of a mutation, and a promise nothing here is keeping.
     * `<Async>` wraps READS only, so on a shop staring at its dues over a dead connection that line
     * said the app was sending something. It says what is actually true instead.
     */
    const message = failed.error.kind === 'network' ? t('app.noConnection') : failed.error.message
    return (
      <ErrorState
        message={message}
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
// Permissions
// ---------------------------------------------------------------------------

/** "May the shop signed in call this?" — asked of the matrix retailer-service itself enforces. */
export function useCan(): (path: string) => boolean {
  const { session } = useSession()
  const role = session?.role as PermissionRole | undefined
  return (path) => isAllowed(permissionFor(path), role ?? null)
}

// ---------------------------------------------------------------------------
// The chips money and orders wear
// ---------------------------------------------------------------------------

/**
 * The state of the shop's money, as a colour AND a word (UX-00 §3.4: colour is never the only
 * channel). Nothing is derived here that the service has not already computed.
 */
export function duesFamily(overduePaise: number, outstandingPaise: number): StatusFamily {
  if (overduePaise > 0) return 'brick'
  if (outstandingPaise > 0) return 'ochre'
  return 'moss'
}

/** The order state families UX-00 §3.3 fixes, in one place so every screen agrees. */
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

/** The bill state families: what a shopkeeper cares about is whether money is still owed. */
export function billFamily(state: string): StatusFamily {
  switch (state) {
    case 'paid':
      return 'moss'
    case 'partially_paid':
      return 'ochre'
    case 'cancelled':
    case 'written_off':
      return 'neutral'
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

/**
 * A plain text cell. Paise never come through here — a figure goes through `<Money>`.
 *
 * `priority` defaults to `detail`, and a `field`-density `<Register>` DRAWS NO DETAIL COLUMN: it
 * keeps the identity, one value and one chip and drops the rest. In this app — `field` at every
 * width — a detail column is therefore invisible, which is how the account screen came to list
 * forty-one devices with no date on any of them. Any register in this app names its priorities.
 */
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
