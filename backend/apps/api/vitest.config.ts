import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'
import preset from '@dos/config/vitest'

// NestJS constructor injection relies on `design:paramtypes` metadata, which esbuild (vitest's
// default transform) never emits. SWC does, so tests see the same DI behaviour as `tsc` builds.
export default defineConfig({
  ...preset,
  test: { ...preset.test, include: ['src/**/*.{test,spec}.ts'] },
  plugins: [swc.vite({ jsc: { transform: { legacyDecorator: true, decoratorMetadata: true } } })],
})
