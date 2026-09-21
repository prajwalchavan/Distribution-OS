/**
 * PLACEHOLDER — what makes this app the ONE app (docs/31 §1.4).
 *
 * The real file carries the `GROUPS` table (role, title, service port, touch floor, density, offline
 * store prefix per group) and `absoluteUrl(group, url)`; the root lane writes it when the six groups
 * are in place. What is here is only what the placeholder layout and `src/api.ts` need to build.
 */
export const APP = {
  /** UX-00 §11: the product's own name, once. The distributor's name is the chrome inside the app. */
  title: 'Distribution OS',
  /** The port `pnpm web` serves on. The six per-role ports 5173-5178 collapse into this one. */
  webPort: 5173,
  /** The fallback theme pair for the three PRE-ELECTION branches (docs/31 §5): no role, no group. */
  touch: 'phone',
  density: 'desk',
} as const

/**
 * Expo inlines every `EXPO_PUBLIC_*` variable at BUILD time. In the one app `EXPO_PUBLIC_API_URL` is
 * the ALL-IN-ONE base (docs/26 §7) and each group's service is a prefix under it; with no base set,
 * every group talks to its own port on this Mac. `serviceFor()` is docs/31 §2, root lane.
 */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL
export const AUTH_URL = process.env.EXPO_PUBLIC_AUTH_URL ?? 'http://127.0.0.1:3000'
