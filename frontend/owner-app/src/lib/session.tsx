import { uuidv7 } from '@dos/domain'
import type {
  AuthTenant,
  AuthUser,
  MembershipRole,
  MembershipSummary,
  TokenPair,
} from '@dos/contracts'
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'

const DEVICE_KEY = 'dos.device'
const SESSION_KEY = 'dos.owner.session'

/** The signed-in user, the membership they are acting as, and every membership they could switch to. */
export interface Session {
  user: AuthUser
  tenant: AuthTenant
  role: MembershipRole
  memberships: MembershipSummary[]
}

/** What survives a reload: the refresh token plus enough of the last token pair to render immediately
 * while `hydrateSession()` (src/lib/api.ts) exchanges it for a fresh access token. Never the access
 * token itself — that lives only in the module-level variable below, for the life of the tab. */
interface PersistedSession {
  refreshToken: string
  refreshExpiresAt: string
  user: AuthUser
  tenant: AuthTenant
  role: MembershipRole
  memberships: MembershipSummary[]
}

function isPersistedSession(v: Partial<PersistedSession>): v is PersistedSession {
  return (
    typeof v.refreshToken === 'string' &&
    typeof v.refreshExpiresAt === 'string' &&
    v.user != null &&
    v.tenant != null &&
    v.role != null &&
    Array.isArray(v.memberships)
  )
}

function readDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing) return existing
    const id = uuidv7()
    localStorage.setItem(DEVICE_KEY, id)
    return id
  } catch {
    // Storage unavailable (private mode etc): still usable for this tab's lifetime.
    return uuidv7()
  }
}

/** One UUIDv7 per browser install, stable across sign-outs. The same id is sent as `deviceId` on
 * login/refresh/logout and is meant to double as the offline sync queue's device id later. */
export const deviceId: string = readDeviceId()

/**
 * "Remember this device" (SignIn.tsx) decides WHERE the refresh token lives: `localStorage` survives a
 * browser restart, `sessionStorage` is cleared when the tab closes. Whichever one currently holds a
 * session is authoritative; a fresh login re-decides it via `setRememberDevice`.
 */
let rememberDevice = true

function storageFor(remember: boolean): Storage {
  return remember ? localStorage : sessionStorage
}

export function setRememberDevice(remember: boolean): void {
  rememberDevice = remember
}

function readPersisted(): PersistedSession | null {
  for (const remember of [true, false]) {
    try {
      const raw = storageFor(remember).getItem(SESSION_KEY)
      if (!raw) continue
      const parsed = JSON.parse(raw) as Partial<PersistedSession>
      if (isPersistedSession(parsed)) {
        rememberDevice = remember
        return parsed
      }
    } catch {
      /* malformed or blocked storage: keep looking / fall through to signed-out */
    }
  }
  return null
}

function writePersisted(value: PersistedSession | null): void {
  try {
    localStorage.removeItem(SESSION_KEY)
    sessionStorage.removeItem(SESSION_KEY)
    if (value) storageFor(rememberDevice).setItem(SESSION_KEY, JSON.stringify(value))
  } catch {
    /* private browsing / storage disabled: the session just won't survive a reload */
  }
}

function toSession(p: PersistedSession | TokenPair): Session {
  return { user: p.user, tenant: p.tenant, role: p.role, memberships: p.memberships }
}

/** In memory only for the life of this tab; never persisted, never read outside this module. */
let accessTokenValue: string | null = null

interface StoreState {
  session: Session | null
  /** True from module load until the boot-time refresh (src/lib/api.ts hydrateSession) resolves;
   * only ever true when a session was actually persisted, so a first-ever visit skips it. */
  hydrating: boolean
}

const initialPersisted = readPersisted()
let storeState: StoreState = {
  session: initialPersisted ? toSession(initialPersisted) : null,
  hydrating: initialPersisted !== null,
}

const listeners = new Set<() => void>()
function notify(): void {
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function getSnapshot(): StoreState {
  return storeState
}

/** Read fresh, synchronously, before every request the api-client makes (see createAuthedClient). */
export function getTokens(): {
  accessToken: string | null
  refreshToken: string | null
  deviceId: string
} {
  return {
    accessToken: accessTokenValue,
    refreshToken: readPersisted()?.refreshToken ?? null,
    deviceId,
  }
}

/** Whether a refresh token survived a reload — decides if the boot-time refresh is worth attempting. */
export function hasPersistedSession(): boolean {
  return readPersisted() !== null
}

/** login / refresh / switchTenant all resolve a fresh pair; apply it the same way regardless of which. */
export function applyTokens(pair: TokenPair): void {
  accessTokenValue = pair.accessToken
  writePersisted({
    refreshToken: pair.refreshToken,
    refreshExpiresAt: pair.refreshExpiresAt,
    user: pair.user,
    tenant: pair.tenant,
    role: pair.role,
    memberships: pair.memberships,
  })
  storeState = { session: toSession(pair), hydrating: false }
  notify()
}

/** After changePassword succeeds: same session, only the mustChangePassword flag moves. */
export function updateUser(user: AuthUser): void {
  if (!storeState.session) return
  const persisted = readPersisted()
  if (persisted) writePersisted({ ...persisted, user })
  storeState = { ...storeState, session: { ...storeState.session, user } }
  notify()
}

export function clearSession(): void {
  accessTokenValue = null
  writePersisted(null)
  storeState = { session: null, hydrating: false }
  notify()
}

function useStore(): StoreState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

interface SessionApi {
  session: Session | null
  /** True while the boot-time refresh (src/lib/api.ts hydrateSession) is still in flight. */
  hydrating: boolean
}

const SessionContext = createContext<SessionApi | null>(null)

/**
 * Session state only — signing in, out, changing password and switching tenants are network calls
 * that live in src/lib/api.ts (which owns the oRPC clients) and update this store through
 * `applyTokens`/`clearSession`/`updateUser`, so this module never imports the api client.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { session, hydrating } = useStore()
  return (
    <SessionContext.Provider value={{ session, hydrating }}>{children}</SessionContext.Provider>
  )
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession outside SessionProvider')
  return ctx
}
