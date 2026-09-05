import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, RouterProvider, useRouter } from './lib/router.js'
import { SessionProvider, useSession } from './lib/session.js'
import { hydrateSession, signOut, switchTenant } from './lib/api.js'
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

/** Owner console: dashboard, catalog and costs today; retailers, pricing, orders, billing desk, delivery map, imports follow module by module. */
export default function App() {
  // Once, on mount: if a refresh token survived a reload, exchange it for a fresh access token
  // before the shell decides whether to show the dashboard or the sign-in screen.
  useEffect(() => {
    void hydrateSession()
  }, [])
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <RouterProvider>
          <Shell />
        </RouterProvider>
      </SessionProvider>
    </QueryClientProvider>
  )
}

const NAV: { to: string; label: string; section?: string; ready: boolean }[] = [
  { to: '/', label: 'Dashboard', ready: true },
  { to: '/catalog', label: 'Catalog', section: 'Masters', ready: true },
  { to: '/costs', label: 'Purchase costs', ready: true },
  { to: '/retailers', label: 'Retailers', ready: true },
  { to: '/pricing', label: 'Price lists & schemes', ready: true },
  { to: '/orders', label: 'Orders & approvals', section: 'Operations', ready: true },
  { to: '/inbound', label: 'Inbound invoices / GRN', ready: false },
  { to: '/billing', label: 'Billing desk', ready: false },
  { to: '/receivables', label: 'Outstanding & receipts', ready: false },
  { to: '/delivery', label: 'Trips & live map', ready: false },
  { to: '/imports', label: 'Imports & Tally', section: 'Setup', ready: false },
]

function Shell() {
  const { session, hydrating } = useSession()
  const { path } = useRouter()
  if (hydrating) {
    return (
      <div className="card signin">
        <p className="muted">Loading…</p>
      </div>
    )
  }
  if (!session) return <SignIn />
  if (session.user.mustChangePassword) return <ChangePassword />
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">Distribution OS</div>
        {NAV.map((n) => (
          <div key={n.to}>
            {n.section && <div className="section">{n.section}</div>}
            {n.ready ? (
              <Link to={n.to}>{n.label}</Link>
            ) : (
              <span style={{ display: 'block', padding: '8px 10px', color: '#475569' }}>
                {n.label}
              </span>
            )}
          </div>
        ))}
        <AccountFoot />
      </nav>
      <main className="content">
        <Page path={path} />
      </main>
    </div>
  )
}

/** User + tenant identity, a switcher when the user belongs to more than one distributor, sign out. */
function AccountFoot() {
  const { session } = useSession()
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!session) return null

  async function onSwitch(tenantId: string): Promise<void> {
    if (tenantId === session?.tenant.id) return
    setSwitching(true)
    setError(null)
    try {
      await switchTenant(tenantId)
    } catch {
      setError('Could not switch tenant.')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="foot">
      <div>
        {session.user.name} · {session.role}
      </div>
      <div className="muted">{session.tenant.legalName}</div>
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
