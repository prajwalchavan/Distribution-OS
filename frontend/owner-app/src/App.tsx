import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiProvider, useQuery } from '@dos/api-client/react'
import { ConnectionStrip, ThemeProvider, TenantLogo } from '@dos/ui/web'

import { Link, RouterProvider, useRouter } from './lib/router.js'
import { useSession } from './lib/session.js'
import { api, client, signOut, switchTenant } from './lib/api.js'
import { Dashboard } from './pages/Dashboard.js'
import { Catalog } from './pages/Catalog.js'
import { Costs } from './pages/Costs.js'
import { Retailers } from './pages/Retailers.js'
import { Pricing } from './pages/Pricing.js'
import { Orders } from './pages/Orders.js'
import { SignIn } from './pages/SignIn.js'
import { ChangePassword } from './pages/ChangePassword.js'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
})

/**
 * Owner console (layout A Ledger). `<ApiProvider>` owns the session — it exchanges a surviving
 * refresh token for a live access token on mount — and `<ThemeProvider>` puts the design tokens and
 * the distributor's own name on every screen. The pages still read through TanStack Query; the owner
 * slice moves them onto the kit's own `useQuery` screen by screen.
 */
export default function App() {
  return (
    <ApiProvider client={client}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider>
          <Shell />
        </RouterProvider>
      </QueryClientProvider>
    </ApiProvider>
  )
}

const NAV: { to: string; label: string; section?: string; ready: boolean }[] = [
  { to: '/', label: 'Today', ready: true },
  { to: '/catalog', label: 'Catalog', section: 'Masters', ready: true },
  { to: '/costs', label: 'Purchase costs', ready: true },
  { to: '/retailers', label: 'Shops', ready: true },
  { to: '/pricing', label: 'Prices & schemes', ready: true },
  { to: '/orders', label: 'Orders', section: 'Operations', ready: true },
  { to: '/inbound', label: 'Inbound & GRN', ready: false },
  { to: '/billing', label: 'Billing', ready: false },
  { to: '/receivables', label: 'Money', ready: false },
  { to: '/delivery', label: 'Trips & live map', ready: false },
  { to: '/imports', label: 'Imports & Tally', section: 'Setup', ready: false },
]

function Shell() {
  const { session, hydrating } = useSession()
  const { path } = useRouter()
  // The distributor's own name and mark, on every screen (UX-00 section 11). Distribution OS's own
  // brand appears on the sign-in screen and nowhere else.
  const tenant = session
    ? { name: session.tenant.displayName, logoUrl: session.tenant.logoUrl }
    : null

  return (
    <ThemeProvider touch="desk" density="desk" tenant={tenant}>
      {hydrating ? (
        <div className="card signin">
          <p className="muted">Loading…</p>
        </div>
      ) : !session ? (
        <SignIn />
      ) : session.user.mustChangePassword ? (
        <ChangePassword />
      ) : (
        <div className="shell">
          <nav className="sidebar">
            <div className="brand">
              <TenantLogo size="rail" withName subtitle={session.tenant.slug} />
            </div>
            {NAV.map((n) => (
              <div key={n.to}>
                {n.section && <div className="section">{n.section}</div>}
                {n.ready ? (
                  <Link to={n.to}>{n.label}</Link>
                ) : (
                  <span className="nav-pending">{n.label}</span>
                )}
              </div>
            ))}
            <AccountFoot />
          </nav>
          <main className="content">
            <Page path={path} />
          </main>
        </div>
      )}
    </ThemeProvider>
  )
}

/** User + tenant identity, a switcher for a user with several distributors, the connection strip. */
function AccountFoot() {
  const { session } = useSession()
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The kit's own read hook, through <ApiProvider>: it is what the strip reports on.
  const health = useQuery(['health', 'ping'], () => api.health.ping(), { staleTime: 15_000 })
  if (!session) return null

  async function onSwitch(tenantId: string): Promise<void> {
    if (tenantId === session?.tenant.id) return
    setSwitching(true)
    setError(null)
    try {
      await switchTenant(tenantId)
    } catch {
      setError('Could not switch distributor.')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="foot">
      <div>
        {session.user.name} · {session.role}
      </div>
      {session.memberships.length > 1 && (
        <select
          value={session.tenant.id}
          disabled={switching}
          onChange={(e) => void onSwitch(e.target.value)}
          style={{ width: '100%', margin: '6px 0' }}
        >
          {session.memberships.map((m) => (
            <option key={m.tenantId} value={m.tenantId}>
              {m.tenantName}
            </option>
          ))}
        </select>
      )}
      {error && <div className="error">{error}</div>}
      <ConnectionStrip
        state={{
          online: health.error?.kind !== 'network',
          lastSyncedAt: health.updatedAt === 0 ? null : health.updatedAt,
        }}
      />
      <a
        href="#/"
        onClick={(e) => {
          e.preventDefault()
          void signOut()
        }}
      >
        sign out
      </a>
    </div>
  )
}

function Page({ path }: { path: string }) {
  switch (path) {
    case '/':
      return <Dashboard />
    case '/catalog':
      return <Catalog />
    case '/costs':
      return <Costs />
    case '/retailers':
      return <Retailers />
    case '/pricing':
      return <Pricing />
    case '/orders':
      return <Orders />
    default:
      return (
        <div>
          <h1>Not yet</h1>
          <p className="muted">This screen arrives with its backend module.</p>
        </div>
      )
  }
}
