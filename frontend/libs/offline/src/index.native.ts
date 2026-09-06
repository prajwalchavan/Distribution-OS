/**
 * `@dos/offline` on Android and iOS — the entry Metro picks through the `react-native` export
 * condition. `openStore` is `expo-sqlite` on the device's own file system, WAL, with the in-memory
 * store as the fallback for a build whose binary was made before the dependency existed (docs/27 §2).
 */
export * from './shared.js'
export { openStore, probeStoreKind } from './store/open.native.js'
