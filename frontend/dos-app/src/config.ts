/**
 * What makes this app THE app — docs/31 §1.4.
 *
 * There is one Expo project now, and six route groups inside it. Everything the six `src/config.ts`
 * files used to hold one copy of each — the role, the app's own name, the service port, the touch
 * floor, the density, the offline store prefix — is one row of `GROUPS` here, and the ELECTED role in
 * the token says which row applies.
 *
 * Nothing in this file decides anything. The server grants the election, `PERMISSIONS` gates every
 * procedure and RLS reads `app.actor_role`; this is the device saying which group it is rendering.
 */
import { serviceFor, type GroupName } from '@dos/api-client'
import type { MembershipRole } from '@dos/contracts'

export const APP = {
  /** UX-00 §11: the product's own name, once. The distributor's name is the chrome inside the app. */
  title: 'Distribution OS',
  /** The port `pnpm web` serves on. The six per-role ports 5173-5178 collapse into this one. */
  webPort: 5173,
  /**
   * The theme pair for the three PRE-ELECTION branches of the root layout (docs/31 §5): the client
   * still booting, the session still hydrating, and the sign-in / change-password screens. There is
   * no elected role on any of them, so there is no group floor to apply and this is the pair those
   * chrome screens have always been drawn at.
   */
  touch: 'phone',
  density: 'desk',
} as const

export interface GroupConfig {
  /** The role a person must have ELECTED for this group to render (docs/31 §1.3 step 7). */
  readonly role: MembershipRole
  /** UX-00 §11 + docs/29 §1: what the landing panel calls this app. "…- Sales" reads as "Sales app". */
  readonly title: string
  /** This group's service when each runs on its own port (this Mac). `serviceFor` owns the table. */
  readonly port: number
  /** UX-00 §5.2: `field` 69 · `floor` 76 · `phone` 63. The group layout fixes it for its own tree. */
  readonly touch: 'field' | 'floor' | 'phone'
  /** `desk` renders registers as tables and may use `text.tertiary`; `field` never does. */
  readonly density: 'desk' | 'field'
  /**
   * The device store's prefix (docs/31 §4), or `false` for a group that opens no store at all.
   *
   * Owner, manager and retailer are ONLINE (docs/22): they feed `<ConnectionStrip>` from a read's
   * own error and must never open a database. The three field groups each keep their own file, so
   * one person on a shared phone has one clean store per elected role.
   */
  readonly offline: string | false
}

export const GROUPS = {
  owner: {
    role: 'owner',
    title: 'Distribution OS - Owner',
    port: 3001,
    touch: 'phone',
    density: 'desk',
    offline: false,
  },
  manager: {
    role: 'manager',
    title: 'Distribution OS - Manager',
    port: 3002,
    touch: 'phone',
    density: 'desk',
    offline: false,
  },
  sales: {
    role: 'salesperson',
    title: 'Distribution OS - Sales',
    port: 3003,
    touch: 'field',
    density: 'field',
    offline: 'dos-sales',
  },
  warehouse: {
    role: 'warehouse',
    title: 'Distribution OS - Warehouse',
    port: 3004,
    touch: 'floor',
    density: 'field',
    offline: 'dos-warehouse',
  },
  delivery: {
    role: 'delivery',
    title: 'Distribution OS - Delivery',
    port: 3005,
    touch: 'field',
    density: 'field',
    offline: 'dos-delivery',
  },
  retailer: {
    role: 'retailer',
    title: 'Distribution OS - Shop',
    port: 3006,
    touch: 'field',
    density: 'field',
    offline: false,
  },
} as const satisfies Record<GroupName, GroupConfig>

/**
 * Expo inlines every `EXPO_PUBLIC_*` variable at BUILD time, so these are the two knobs that point a
 * build at local, staging or production (`.env.example`).
 *
 * `EXPO_PUBLIC_API_URL` is the ALL-IN-ONE base (docs/26 §7) and NOT one service's URL — that is
 * exactly what the merge removed (docs/31 R10). Each group's service is a prefix under it; with no
 * base set, each group talks to its own port on this Mac.
 */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL
export const AUTH_URL = process.env.EXPO_PUBLIC_AUTH_URL ?? 'http://127.0.0.1:3000'

/** The origin a group's service answers on, in whichever of the two deployments this build is. */
export function apiUrlFor(group: GroupName): string {
  return serviceFor(GROUPS[group].role, API_BASE)
}

/**
 * `AuthTenant.logoUrl`, `tenancy.branding.get`'s `logoUrl` and every document URL come back
 * SERVICE-RELATIVE (`/storage/tenant/…?expires=…&signature=…`). A browser would resolve that against
 * the APP's origin (`localhost:5173`), not the service's, and a phone has no origin to resolve it
 * against at all.
 *
 * THE GROUP IS A PARAMETER NOW, and that is the one thing this merge could get silently wrong
 * (docs/31 R2): with six apps there was one `API_URL` to absolutise against, and with one app a
 * missing or wrong group sends a driver's delivery challan to owner-service, which answers 404 with
 * no error anyone sees — a blank logo and a PDF that never opens. Every call site names its own
 * group, and `useGo().group` is where a screen gets it from without writing it down.
 */
export function absoluteUrl(group: GroupName, url: string | null | undefined): string | null {
  if (url === null || url === undefined || url === '') return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return url
  const base = apiUrlFor(group)
  return `${base.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
}
