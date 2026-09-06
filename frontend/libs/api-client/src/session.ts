/**
 * The signed-in session: who is acting, inside which distributorship, with which memberships they
 * could switch to. The ACCESS token lives here in memory only — never in storage, never on disk.
 */
import type {
  AuthTenant,
  AuthUser,
  MembershipRole,
  MembershipSummary,
  TokenPair,
} from '@dos/contracts'

import type { TokenStorage } from './storage.js'

const SNAPSHOT_KEY = 'dos.auth.session'

export interface Session {
  readonly user: AuthUser
  readonly tenant: AuthTenant
  readonly role: MembershipRole
  readonly memberships: readonly MembershipSummary[]
}

export interface SessionState {
  readonly session: Session | null
  /** True while the boot-time refresh is in flight; only ever true when a session was persisted. */
  readonly hydrating: boolean
}

function toSession(pair: TokenPair | Session): Session {
  return {
    user: pair.user,
    tenant: pair.tenant,
    role: pair.role,
    memberships: pair.memberships,
  }
}

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<Session>
  return (
    v.user !== undefined &&
    v.tenant !== undefined &&
    v.role !== undefined &&
    Array.isArray(v.memberships)
  )
}

/**
 * A tiny external store: `subscribe` + `getSnapshot` are exactly what React's `useSyncExternalStore`
 * wants, so the React layer needs no state library.
 */
export class SessionStore {
  #state: SessionState
  #accessToken: string | null = null
  readonly #listeners = new Set<() => void>()
  readonly #storage: TokenStorage

  constructor(storage: TokenStorage) {
    this.#storage = storage
    const restored = this.#readSnapshot()
    // A snapshot without a refresh token is worthless: it can never be turned into a live session.
    const usable = restored !== null && storage.getRefreshToken() !== null
    this.#state = { session: usable ? restored : null, hydrating: usable }
    if (!usable && restored !== null) storage.setItem(SNAPSHOT_KEY, null)
  }

  #readSnapshot(): Session | null {
    const raw = this.#storage.getItem(SNAPSHOT_KEY)
    if (raw === null) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      return isSession(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  #emit(next: SessionState): void {
    this.#state = next
    for (const listener of this.#listeners) listener()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getSnapshot = (): SessionState => this.#state

  get deviceId(): string {
    return this.#storage.getDeviceId()
  }

  get accessToken(): string | null {
    return this.#accessToken
  }

  get refreshToken(): string | null {
    return this.#storage.getRefreshToken()
  }

  /** True when a reload left a refresh token behind, so the boot-time refresh is worth attempting. */
  get hasPersistedSession(): boolean {
    return this.#storage.getRefreshToken() !== null
  }

  /** login, refresh and switch-tenant all resolve a fresh pair; they all land here. */
  applyTokens(pair: TokenPair): void {
    this.#accessToken = pair.accessToken
    this.#storage.setRefreshToken(pair.refreshToken)
    const session = toSession(pair)
    this.#storage.setItem(SNAPSHOT_KEY, JSON.stringify(session))
    this.#emit({ session, hydrating: false })
  }

  /** After changePassword: the same session, with `mustChangePassword` cleared. */
  updateUser(user: AuthUser): void {
    const current = this.#state.session
    if (!current) return
    const session: Session = { ...current, user }
    this.#storage.setItem(SNAPSHOT_KEY, JSON.stringify(session))
    this.#emit({ session, hydrating: false })
  }

  clear(): void {
    this.#accessToken = null
    this.#storage.setRefreshToken(null)
    this.#storage.setItem(SNAPSHOT_KEY, null)
    this.#emit({ session: null, hydrating: false })
  }

  /** The boot-time refresh finished (or was never worth attempting). */
  settleHydration(): void {
    if (this.#state.hydrating) this.#emit({ ...this.#state, hydrating: false })
  }
}
