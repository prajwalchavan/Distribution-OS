import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, RouterProvider, useRouter } from './lib/router.js'
import { SessionProvider, useSession } from './lib/session.js'
import { Dashboard } from './pages/Dashboard.js'
import { Catalog } from './pages/Catalog.js'
import { Costs } from './pages/Costs.js'
import { Retailers } from './pages/Retailers.js'
import { Pricing } from './pages/Pricing.js'
import { Orders } from './pages/Orders.js'
import { SignIn } from './pages/SignIn.js'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
})

/** Owner console: dashboard, catalog and costs today; retailers, pricing, orders, billing desk, delivery map, imports follow module by module. */
export default function App() {
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
  const { session, signOut } = useSession()
  const { path } = useRouter()
  if (!session) return <SignIn />
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
        <div className="foot">
          {session.role} · {session.tenantId.slice(0, 8)}…{' '}
          <a href="#/" onClick={signOut}>
            sign out
          </a>
        </div>
      </nav>
      <main className="content">
        <Page path={path} />
      </main>
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
