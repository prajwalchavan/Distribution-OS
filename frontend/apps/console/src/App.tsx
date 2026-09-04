import { useEffect, useState } from 'react'
import { formatINR } from '@dos/ui'
import { createApiClient } from '@dos/api-client'
import { paise } from '@dos/domain'

const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  getAuth: async () => ({}),
})

/** Owner console shell. Real routes (dashboard, approvals, pricing, billing desk, imports) arrive per docs/13-roadmap-solo-dev.md. */
export default function App() {
  const [health, setHealth] = useState<string>('checking…')
  useEffect(() => {
    api.health
      .ping()
      .then((h) => setHealth(`api ${h.version} · db ${h.db}`))
      .catch(() => setHealth('api unreachable'))
  }, [])
  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 720 }}>
      <h1>Distribution OS · Console</h1>
      <p>{health}</p>
      <p>Money renders from integer paise: {formatINR(paise(3383280))}</p>
    </main>
  )
}
