/**
 * `@dos/ui` on the web target — the entry Metro picks through the `browser` export condition, and
 * the one Vitest, `tsc` and the gallery reach as the package's `default`.
 *
 * This is the whole point of the universal-app decision (docs/22 section 8, 2026-09-06): a screen
 * writes `import { Button, Screen, Money } from '@dos/ui'` and the bundler decides which renderer
 * that is. On the web it is a real DOM — HTML tables, a print stylesheet, keyboard focus, text
 * selection, a `<a href>` that can be middle-clicked; on a phone `index.native.ts` gives the same
 * names as React Native views.
 *
 * `@dos/ui/web` and `@dos/ui/native` stay addressable for the gallery and the kit's own tests, where
 * naming the renderer is the point. An app that names one has pinned itself to one platform, so the
 * app ESLint preset refuses both.
 */
export * from './shared.js'
export * from './web/index.js'
