import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The offline harness: `@dos/offline` driven by hand against the REAL sales-service, in a browser.
 *
 * It is to the sync client what `libs/ui/gallery` is to the design system — the page the thing is
 * reviewed on before a screen depends on it. Sign in as a rep, watch the manifest and the snapshot
 * land, pull the switch on the network, queue an order in the dead spot, put the signal back and
 * watch the queue drain exactly once. Not shipped in any app.
 *
 *   pnpm --filter @dos/offline harness   ->  http://localhost:5198
 *
 * Needs auth-service :3000 and sales-service :3003 running (`pnpm --filter @dos/<name> dev` in
 * `backend/`). The store here is the MEMORY adapter and the page says so — see
 * `expo-sqlite-stub.ts`; the OPFS and native SQLite adapters are reached through Metro, in the apps.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  /* `/fonts/IBMPlexSans-*.woff2` — the paths the kit's own `FONT_CSS` emits (UX-00 §4.1). */
  publicDir: fileURLToPath(new URL('../../ui/assets', import.meta.url)),
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    /* See the file itself: Metro strips React Native's Flow, Vite does not. */
    alias: { 'expo-sqlite': fileURLToPath(new URL('./expo-sqlite-stub.ts', import.meta.url)) },
  },
  server: { port: 5198 },
})
