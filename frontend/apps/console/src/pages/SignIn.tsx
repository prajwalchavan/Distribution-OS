import { useState } from 'react'
import { useSession, type Role } from '../lib/session.js'

const ROLES: Role[] = ['owner', 'manager', 'accountant', 'salesperson', 'delivery', 'retailer']

/** Dev sign-in: paste the ids from `pnpm db:seed` output (or Drizzle Studio). Replaced by phone OTP with the identity module. */
export function SignIn() {
  const { signIn } = useSession()
  const [tenantId, setTenantId] = useState('')
  const [actorId, setActorId] = useState('')
  const [role, setRole] = useState<Role>('owner')
  return (
    <div className="card signin">
      <h1>Distribution OS · Console</h1>
      <p className="muted">
        Developer sign-in (placeholder until phone OTP). Enter the tenant and user ids from the
        seed.
      </p>
      <div className="stack">
        <label className="field">
          Tenant id
          <input
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value.trim())}
            placeholder="019…"
          />
        </label>
        <label className="field">
          User id
          <input
            type="text"
            value={actorId}
            onChange={(e) => setActorId(e.target.value.trim())}
            placeholder="019…"
          />
        </label>
        <label className="field">
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={!tenantId || !actorId}
          onClick={() => signIn({ tenantId, actorId, role })}
        >
          Enter console
        </button>
      </div>
    </div>
  )
}
