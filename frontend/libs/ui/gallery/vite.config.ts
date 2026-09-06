import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The kit's own gallery: every UX-00 section 6 component, in every state the contract names, on one
 * page. It is how a component is reviewed against the design system before a screen uses it, and how
 * the design review of UX-00 section 16 is walked. Not shipped in any app.
 *
 *   pnpm --filter @dos/ui gallery   ->  http://localhost:5199
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5199 },
})
