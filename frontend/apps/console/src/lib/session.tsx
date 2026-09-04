import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type Role = 'owner' | 'manager' | 'salesperson' | 'delivery' | 'accountant' | 'retailer'
export interface Session {
  tenantId: string
  actorId: string
  role: Role
}

const KEY = 'dos.console.session'

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Session>
    if (s.tenantId && s.actorId && s.role)
      return { tenantId: s.tenantId, actorId: s.actorId, role: s.role }
  } catch {
    /* ignore */
  }
  return null
}

interface SessionApi {
  session: Session | null
  signIn: (s: Session) => void
  signOut: () => void
}

const SessionContext = createContext<SessionApi | null>(null)

/**
 * Placeholder session until Better Auth (identity module) lands: the console stores the tenant/actor/role
 * it sends as headers. The API's TenantGuard trusts them today and will verify a bearer token tomorrow.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => load())
  const signIn = useCallback((s: Session) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      /* ignore */
    }
    setSession(s)
  }, [])
  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
    setSession(null)
  }, [])
  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession outside SessionProvider')
  return ctx
}

/** Module-level accessor for the api client's header callback (outside React). */
export function currentSession(): Session | null {
  return load()
}
