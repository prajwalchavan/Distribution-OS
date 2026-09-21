/**
 * One helper between a screen and a route literal — docs/31 §1.1, architect's ruling Q1.
 *
 * The one app gives every group a VISIBLE segment (`app/owner/…` → `/owner/orders`), because a bare
 * `/orders` claimed by four apps resolves by tree order and not by the elected role. That makes every
 * route literal in a moved screen wrong by one segment, and wrong SILENTLY: expo-router does not
 * reject an unknown path, the person simply arrives somewhere else. So no screen writes the base.
 *
 *   const go = useGo()
 *   go.push('/orders/new')          // → /sales/orders/new, inside the sales group
 *   <Link href={go.href('/shops')} />
 *
 * and, outside React (a `nav.ts` section list), `routeFor('sales', '/shops')`.
 *
 * The kit does not know the app's groups — it serves the console too, which has none — so `group` is
 * a plain string here and the app's own `GROUPS` table gives it a union. What the kit owns is the
 * RULE: one base, applied once, never to a pre-election route, never to a URL.
 */
import { createContext, useContext, useMemo } from 'react'

import { getRouterNavigate } from './router-bridge.js'

/**
 * The routes that live at the ROOT of the one app and belong to no group: one sign-in screen and one
 * change-password screen for the whole install (docs/31 §1.2). An account menu inside a group pushes
 * `/change-password` by name today and must keep working, so the rule lives here rather than as an
 * exception every call site has to remember.
 */
export const ROOT_ROUTES: readonly string[] = ['/sign-in', '/change-password']

/** `https://…`, `mailto:…`, `//host/x` — a document or a logo, never a route of ours. */
function isUrl(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')
}

/**
 * The group's base in front of an app path.
 *
 * Idempotent on purpose: a move lane runs over a tree more than once, and `/sales/sales/orders` is
 * the kind of mistake that only shows up as a blank screen. The "already based" test is on the
 * SEGMENT — `/salesman` is not inside `/sales`.
 */
export function routeFor(group: string, path: string): string {
  if (isUrl(path)) return path
  const withSlash = path.startsWith('/') ? path : `/${path}`
  if (ROOT_ROUTES.includes(withSlash)) return withSlash
  const base = `/${group}`
  if (withSlash === base || withSlash.startsWith(`${base}/`)) return withSlash
  if (withSlash === '/') return base
  return `${base}${withSlash}`
}

/**
 * Move, through whatever router the app registered. Inert before it registers one — the same
 * degraded behaviour `<Link>` has, because a kit that throws on a tap in a Vitest run or the gallery
 * is worse than one that does nothing.
 */
export function goTo(group: string, path: string, replace: boolean): void {
  getRouterNavigate()?.(routeFor(group, path), replace)
}

const GroupContext = createContext<string | null>(null)

/** The group layout names its group once; every screen under it inherits the base. */
export function GroupProvider({
  group,
  children,
}: {
  group: string
  children: React.ReactNode
}): React.JSX.Element {
  return <GroupContext.Provider value={group}>{children}</GroupContext.Provider>
}

/** The group this screen is rendering inside. Throws outside a `<GroupProvider>`: see `useGo`. */
export function useGroup(): string {
  const group = useContext(GroupContext)
  if (group === null) {
    throw new Error(
      'useGroup() outside a <GroupProvider>: a screen that builds routes must be mounted inside its group layout.',
    )
  }
  return group
}

export interface Go {
  /** The group this is bound to, for a screen that has to name it (a store prefix, a log line). */
  group: string
  /** `/orders/new` → `/sales/orders/new`, for an href a control renders. */
  href: (path: string) => string
  push: (path: string) => void
  replace: (path: string) => void
}

/**
 * The group-bound router a screen uses instead of a literal.
 *
 * It REFUSES outside a group rather than falling back to the root, because a rootless path is the
 * failure this whole helper exists to prevent: it would resolve, quietly, to another group's screen.
 */
export function useGo(): Go {
  const group = useGroup()
  return useMemo(
    () => ({
      group,
      href: (path: string) => routeFor(group, path),
      push: (path: string) => {
        goTo(group, path, false)
      },
      replace: (path: string) => {
        goTo(group, path, true)
      },
    }),
    [group],
  )
}
