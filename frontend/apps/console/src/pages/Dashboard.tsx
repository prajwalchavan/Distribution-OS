import { useQuery } from '@tanstack/react-query'
import { api, qk } from '../lib/api.js'

export function Dashboard() {
  const health = useQuery({
    queryKey: qk.health(),
    queryFn: () => api.health.ping(),
    refetchInterval: 30_000,
  })
  const me = useQuery({ queryKey: qk.me(), queryFn: () => api.tenancy.me() })
  return (
    <div>
      <h1>Dashboard</h1>
      <div className="card">
        <div className="row">
          <span className={`badge ${health.data?.db === 'up' ? 'ok' : 'bad'}`}>
            {health.isLoading
              ? 'checking…'
              : health.data
                ? `API ${health.data.version} · DB ${health.data.db}`
                : 'API unreachable'}
          </span>
        </div>
      </div>
      {me.isError && (
        <p className="error">
          Session rejected by the API: check tenant / user ids and that the user is a member.
        </p>
      )}
      {me.data && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{me.data.tenant.legalName}</h2>
          <p className="muted">
            {me.data.user.name} · {me.data.membership.role} · plan {me.data.tenant.plan} · state{' '}
            {me.data.tenant.stateCode}
            {me.data.tenant.gstin ? ` · GSTIN ${me.data.tenant.gstin}` : ' · no GSTIN'}
          </p>
          <p className="muted">
            Live sales, outstanding, approvals and the delivery map appear here as those modules
            land (docs/13-roadmap-solo-dev.md).
          </p>
        </div>
      )}
    </div>
  )
}
