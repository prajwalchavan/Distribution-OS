import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'
import preset from '@dos/config/vitest'

export default defineConfig({
  ...preset,
  test: { ...preset.test, include: ['src/**/*.{test,spec}.ts'], setupFiles: ['src/test-setup.ts'] },
  plugins: [swc.vite({ jsc: { transform: { legacyDecorator: true, decoratorMetadata: true } } })],
})
