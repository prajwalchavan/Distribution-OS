import { defineConfig } from 'vitest/config'
import preset from '@dos/config/vitest'

/**
 * The demo-fill specs (`pnpm fill:demo`, its checks, the look-alike tenant builder). A config of its own,
 * run by the `pretest` script, so the legacy importer's `vitest.config.ts` is left as it is.
 *
 * `run.spec.ts` is the whole run against a look-alike tenant: it needs `DATABASE_URL` on a database whose
 * name begins `dos_test_` (or CI), boots the API in this process and closes it again.
 */
export default defineConfig({
  ...preset,
  test: {
    ...preset.test,
    include: ['demo-fill/**/*.{test,spec}.ts', 'testing/**/*.{test,spec}.ts'],
    testTimeout: 30_000,
    hookTimeout: 240_000,
    // The API booted in-process logs every refusal it answers with its stack (a 404 for "not made yet" is
    // how the tool asks); hundreds of them would bury the suite's own output. The spec asserts on answers.
    onConsoleLog: (log) => !log.includes('ORPCError'),
  },
})
