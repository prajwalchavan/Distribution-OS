/**
 * The hand-off from the app's router to the kit — ONE module-level slot, shared by both renderers.
 *
 * expo-router lives in the app, not the kit: `@dos/ui` has to stay installable in a plain Vitest run
 * and in the gallery, neither of which has a router. The app's root layout calls `setRouterNavigate`
 * once with `router.push` / `router.replace`; until it does, `<Link>` is an ordinary anchor and a
 * full page load, and `goTo` does nothing — the correct degraded behaviour rather than a dead control
 * or a crash.
 *
 * It used to be a copy in `web/layout.tsx` and another in `native/layout.tsx`. It is one file now
 * because `route-for.tsx` is renderer-agnostic and has to reach the SAME slot the platform `<Link>`
 * reads; two copies would have given the web `<Link>` a router and `useGo()` none. Both halves still
 * re-export `setRouterNavigate` under their own name, so `parity.types.ts` and every app's root
 * layout are untouched.
 */
export type Navigate = (href: string, replace: boolean) => void

let routerNavigate: Navigate | null = null

export function setRouterNavigate(navigate: Navigate | null): void {
  routerNavigate = navigate
}

/** The app's navigate, or `null` before the root layout has registered one. */
export function getRouterNavigate(): Navigate | null {
  return routerNavigate
}
