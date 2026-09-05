/**
 * `@dos/core/claims` — what the pg-boss worker imports (coordination §3.9: plain functions, no Nest
 * DI). Kept separate from `index.ts` so the worker never resolves the controller.
 */
export { registerClaimSheetRenderer, renderClaimSheet } from './statements.js'
export { CLAIM_EVENTS } from './claims.internals.js'
