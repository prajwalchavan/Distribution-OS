import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The console talks to the API on the same origin under /api (no CORS): Vite proxies it in dev, the load
 * balancer / reverse proxy does in production. Set VITE_API_URL to call an API elsewhere.
 */
export default defineConfig({
  plugins: [react()],
  // Hoisted node_modules hold Expo's React too; force one copy for the console and every library it uses.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
