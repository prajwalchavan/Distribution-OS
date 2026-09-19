/**
 * WHERE THE `offline:` LINES GO (DOS-167 ruling 3 (dd), S-139).
 *
 * The engine says what it cannot do through `onLog`: ruling (t)'s `offline: no persistent store; running in memory`
 * with the reason the opener fell back, ruling (s)'s `offline: kept the store from before ruling 2`, ruling (cc)'s
 * `offline: the device store could not be used; running in memory`, the sweep's skips. Until this, no field app
 * passed an `onLog` at all, so every one of those lines went nowhere — which is why S-138 (a browser whose offline
 * copy never opened, for 240 s, in silence) took a QA gate to find instead of a support call.
 *
 * `console.warn` because it is the one console level `frontend/libs/config/eslint/base.js` allows in a library, and
 * because a warning is what these are: the app carries on, with less. NOT gated on `__DEV__` — there are a handful
 * per session, a support call and a QA gate read them, and a release build is exactly where a stuck store has to be
 * explainable.
 */
export function consoleSink(line: string, detail?: unknown): void {
  if (detail === undefined) console.warn(line)
  else console.warn(line, detail)
}
