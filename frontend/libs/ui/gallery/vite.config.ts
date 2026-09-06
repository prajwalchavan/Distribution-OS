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
  /**
   * `../assets`, so `/fonts/IBMPlexSans-*.woff2` — the paths `FONT_CSS` emits — resolve to the
   * binaries in `assets/fonts`. Without it a dev server answers an unknown path with `index.html`,
   * the browser downloads HTML, tries to parse it as a font and logs `OTS parsing error: invalid
   * sfntVersion` four times per load — and the kit's own style guide, the page a component is
   * reviewed on, renders in the platform UI face instead of the typeface it documents.
   */
  publicDir: fileURLToPath(new URL('../assets', import.meta.url)),
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5199 },
})
