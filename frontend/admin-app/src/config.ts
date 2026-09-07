/**
 * What makes this app THIS app — and this one is not like the other six.
 *
 * `admin-app` is Distribution OS's OWN console (docs/22 §2 row 7, the founder's decision of
 * 2026-09-05). Its reader is our staff, not a distributor's, so the product's own name IS the chrome
 * here — the single exception to the white-label rule of docs/22 §9 item 10, stated in the `admin`
 * contract's own header. The person signing in holds no membership: `platform_admin` has no tenant,
 * no distributor to switch to, and no branding to inherit.
 */
export const APP = {
  /** The platform role this app serves. It is NOT a membership role (`permissions.ts` PLATFORM). */
  role: 'platform_admin',
  /** UX-00 §11: the product name, then the app. Here it is also the name in the rail. */
  title: 'Distribution OS - Admin',
  /** The name that stands where a distributor's own name stands in the other six apps. */
  brand: 'Distribution OS',
  /** The port `pnpm web` serves on. owner 5173 · manager 5174 · sales 5175 · warehouse 5176 · delivery 5177 · retailer 5178 · admin 5179. */
  webPort: 5179,
  /** The service this app talks to: admin-service, the only one that mounts the `admin` key. */
  servicePort: 3007,
  /**
   * Which of the four touch floors of UX-00 section 5.2 this app's shell fixes:
   * `field` 69 (sales, retailer) · `floor` 76 (warehouse) · `phone` 63 (owner, manager) · `desk` 32.
   * A console is a desk surface; on a phone the shell drops to the `phone` floor by itself.
   */
  touch: 'phone',
  /** `desk` renders registers as tables and may use `text.tertiary`; `field` never does. */
  density: 'desk',
} as const

/**
 * Expo inlines every `EXPO_PUBLIC_*` variable at BUILD time, so these are the knobs that point a
 * build at local, staging or production (`.env.example`). The fallbacks are the founder's Mac.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? `http://127.0.0.1:${String(APP.servicePort)}`
export const AUTH_URL = process.env.EXPO_PUBLIC_AUTH_URL ?? 'http://127.0.0.1:3000'
/** All-in-one deployment (docs/26 section 7): every service behind one origin under its own prefix. */
export const API_PREFIX = process.env.EXPO_PUBLIC_API_PREFIX

/**
 * Where a DISTRIBUTOR's own service lives.
 *
 * The console never reads a distributor's rows through :3007 — `admin.*` serves counts and our own
 * subscription figures and nothing else. The one way in is an owner-approved support window, and it
 * is opened against the DISTRIBUTOR's service with the `x-support-grant` pass, which is why this app
 * needs a second address at all. Locally that is owner-service :3001; in a deployment it is the one
 * host every distributor's service sits behind.
 */
export const TENANT_API_URL = process.env.EXPO_PUBLIC_TENANT_API_URL ?? 'http://127.0.0.1:3001'

/**
 * A service-relative signed URL (`/storage/…?expires=…&signature=…`) made absolute against the
 * service that issued it. A browser would otherwise resolve it against the APP's origin
 * (`localhost:5179`) and a phone has no origin to resolve it against at all.
 */
export function absoluteUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url === '') return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return url
  return `${API_URL.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
}
