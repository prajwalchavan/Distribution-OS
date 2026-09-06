/**
 * `@dos/ui` on Android and iOS — the entry Metro picks through the `react-native` export condition.
 *
 * Every name here is a name `index.web.ts` also exports, against the same prop types in
 * `src/types.ts`; `parity.test.ts` fails the build when the two drift. That equality is what lets one
 * screen file serve website, Android and iOS (docs/08 section 0).
 */
export * from './shared.js'
export * from './native/index.js'
