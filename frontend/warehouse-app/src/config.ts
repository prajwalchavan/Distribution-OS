/**
 * What makes this app THIS app.
 *
 * `pnpm --filter @dos/app-template new <role> <port>` rewrites the block below, `app.json` and the
 * package name, and nothing else: every other file in the template is identical in all seven apps.
 */
export const APP = {
  /** The membership role this app serves; `template` is the skeleton itself. */
  role: 'warehouse',
  /** UX-00 section 11: the product name, then the app. The distributor's own name is the chrome. */
  title: 'Distribution OS - Warehouse',
  /** The port `pnpm web` serves on. owner 5173 · manager 5174 · sales 5175 · warehouse 5176 · delivery 5177 · retailer 5178 · admin 5179. */
  webPort: 5176,
  /** The service this app talks to. owner 3001 · manager 3002 · sales 3003 · warehouse 3004 · delivery 3005 · retailer 3006 · admin 3007. */
  servicePort: 3004,
  /**
   * Which of the four touch floors of UX-00 section 5.2 this app's shell fixes:
   * `field` 69 (sales, retailer) · `floor` 76 (warehouse) · `phone` 63 (owner, manager) · `desk` 32.
   */
  touch: 'floor',
  /** `desk` renders registers as tables and may use `text.tertiary`; `field` never does. */
  density: 'field',
} as const

/**
 * Expo inlines every `EXPO_PUBLIC_*` variable at BUILD time, so these are the two knobs that point a
 * build at local, staging or production (`.env.example`). The fallbacks are the founder's Mac.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? `http://127.0.0.1:${String(APP.servicePort)}`
export const AUTH_URL = process.env.EXPO_PUBLIC_AUTH_URL ?? 'http://127.0.0.1:3000'
/** All-in-one deployment (docs/26 section 7): every service behind one origin under its own prefix. */
export const API_PREFIX = process.env.EXPO_PUBLIC_API_PREFIX

/**
 * `AuthTenant.logoUrl` and `tenancy.branding.get`'s `logoUrl` come back SERVICE-RELATIVE
 * (`/storage/tenant/…?expires=…&signature=…`). A browser would resolve that against the APP's origin
 * (`localhost:5173`), not the service's, and a phone has no origin to resolve it against at all — so
 * every app absolutises it against its own `API_URL` before handing it to `<TenantLogo>`.
 */
export function absoluteUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url === '') return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return url
  return `${API_URL.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
}
