import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The app talks to two services on the same origin (no CORS): /api -> owner-service (:3001) and
 * /auth -> auth-service (:3000). Vite proxies both in dev, the load balancer / reverse proxy does in
 * production. Set VITE_API_URL / VITE_AUTH_URL to call services elsewhere.
 *
 * /api strips its prefix because owner-service's own contract routes (`/tenancy/me`, ...) don't carry
 * one. /auth does NOT strip: auth-service's contract routes already start with `/auth`
 * (`/auth/login`, `/auth/me`, ...), so the client's baseUrl is the bare origin and the full
 * `/auth/...` path is forwarded through as-is.
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
      '/auth': {
        target: process.env.AUTH_URL ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})
