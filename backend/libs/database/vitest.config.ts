import { defineConfig } from 'vitest/config'
import preset from '@dos/config/vitest'

export default defineConfig({
  ...preset,
  test: { ...preset.test, setupFiles: ['src/test-setup.ts'] },
})
