/** @type {import('vitest/config').ViteUserConfig} */
export default {
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    passWithNoTests: true,
    // These are integration tests against a real Postgres, run many files at a time. Vitest's 5s
    // default is a stopwatch on a transaction that legitimately waits on a numbering row lock.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/index.ts'],
    },
  },
}
