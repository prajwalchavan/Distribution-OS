/**
 * `@dos/offline` in a browser — the entry the bundler picks through the `browser` / `default` export
 * condition, and the one Vitest, `tsc` and the harness reach.
 *
 * `openStore` here is the OPFS-gated one: `expo-sqlite`'s web build when the page is cross-origin
 * isolated, and the in-memory store otherwise — which is honest rather than absent, and says so in
 * the strip (docs/27 §2).
 */
export * from './shared.js'
export { openStore, probeStoreKind } from './store/open.web.js'
