/**
 * `@dos/ui` — the Distribution OS design system, layout A "Ledger".
 *
 * This entry point carries everything that is renderer-agnostic: tokens, strings, money and quantity
 * formatting, chart geometry and the theme context. The components live behind two subpaths that
 * expose the SAME contracts:
 *
 *   import { Button, Money } from '@dos/ui/web'      // owner, manager, admin (React DOM)
 *   import { Button, Money } from '@dos/ui/native'   // sales, warehouse, delivery, retailer (RN)
 *
 * A screen imports from `@dos/ui`, `@dos/domain` and `@dos/contracts` only (UX-00 section 6).
 *
 * It is called `shared.ts` rather than `index.ts` because `index.web.ts` and `index.native.ts` sit
 * beside it: a bundler resolving `./index` from inside `index.web.ts` would find `index.web.ts`
 * itself — the platform variant — and the barrel would import itself for ever.
 */
export * from './tokens.js'
export * from './strings.js'
export * from './money.js'
export * from './qty.js'
export * from './theme.js'
export * from './relative-time.js'
export * from './charts/geometry.js'
export * from './types.js'

// The formatters a screen is allowed to call directly. Money still renders through <Money>.
export { formatINR, formatQty, paise, pieces } from '@dos/domain'
