/**
 * The signed-in session: who is acting, inside which distributorship, with which memberships they
 * could switch to. The ACCESS token lives here in memory only — never in storage, never on disk.
 *
 * TWO KINDS OF SESSION, ONE SET OF PLUMBING. Six of the seven apps sign a MEMBER of one distributor
 * in (`Session`: a user, a tenant, a membership role and every membership they could switch to). The
 * platform console signs in Distribution OS's OWN staff (`PlatformSession`: a user and
 * `platform_admin`, and no tenant at all — `auth.platformLogin` in the contract explains why that is
 * a separate procedure rather than a nullable `tenant`). Rather than make `tenant` nullable in the
 * six apps that can never see it null, the two share `BaseSessionStore` — the listener set, the
 * snapshot in storage, the hydration flag — and differ only in what one session IS.
 */
import type {
  AuthTenant,
  AuthUser,
  MembershipRole,
  MembershipSummary,
  PlatformRole,
  PlatformTokenPair,
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

/** Distribution OS's own staff: a role, a user, and deliberately nothing tenant-shaped. */
export interface PlatformSession {
  readonly user: AuthUser
  readonly role: PlatformRole
}

export interface SessionState {
  readonly session: Session | null
  /** True while the boot-time refresh is in flight; only ever true when a session was persisted. */
  readonly hydrating: boolean
}

export interface PlatformSessionState {
  readonly session: PlatformSession | null
  readonly hydrating: boolean
}

/**
 * What the React layer needs of EITHER store: something to subscribe to, and a snapshot carrying the
 * signed-in user. `useQuery` reads no more than this, which is what lets one `<ApiProvider>` and one
 * query cache serve both kinds of client.
 */
export interface SessionSnapshotLike {
  readonly session: { readonly user: AuthUser } | null
  readonly hydrating: boolean
}

export interface SessionStoreLike {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => SessionSnapshotLike
  readonly accessToken: string | null
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

function isPlatformSession(value: unknown): value is PlatformSession {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<PlatformSession>
  return v.user !== undefined && v.role === 'platform_admin' && !('tenant' in v)
}

/**
 * A tiny external store: `subscribe` + `getSnapshot` are exactly what React's `useSyncExternalStore`
 * wants, so the React layer needs no state library.
 */
abstract class BaseSessionStore<S extends { readonly user: AuthUser }> {
  #state: { readonly session: S | null; readonly hydrating: boolean }
  #accessToken: string | null = null
  readonly #listeners = new Set<() => void>()
  protected readonly storage: TokenStorage

  constructor(storage: TokenStorage, parse: (value: unknown) => S | null) {
    this.storage = storage
    const restored = this.#readSnapshot(parse)
    // A snapshot without a refresh token is worthless: it can never be turned into a live session.
    const usable = restored !== null && storage.getRefreshToken() !== null
    this.#state = { session: usable ? restored : null, hydrating: usable }
    if (!usable && restored !== null) storage.setItem(SNAPSHOT_KEY, null)
  }

  #readSnapshot(parse: (value: unknown) => S | null): S | null {
    const raw = this.storage.getItem(SNAPSHOT_KEY)
    if (raw === null) return null
    try {
      return parse(JSON.parse(raw))
    } catch {
      return null
    }
  }

  protected emit(next: { readonly session: S | null; readonly hydrating: boolean }): void {
    this.#state = next
    for (const listener of this.#listeners) listener()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getSnapshot = (): { readonly session: S | null; readonly hydrating: boolean } => this.#state

  protected get state(): { readonly session: S | null; readonly hydrating: boolean } {
    return this.#state
  }

  get deviceId(): string {
    return this.storage.getDeviceId()
  }

  get accessToken(): string | null {
    return this.#accessToken
  }

  get refreshToken(): string | null {
    return this.storage.getRefreshToken()
  }

  /** True when a reload left a refresh token behind, so the boot-time refresh is worth attempting. */
  get hasPersistedSession(): boolean {
    return this.storage.getRefreshToken() !== null
  }

  protected settle(session: S, accessToken: string, refreshToken: string): void {
    this.#accessToken = accessToken
    this.storage.setRefreshToken(refreshToken)
    this.storage.setItem(SNAPSHOT_KEY, JSON.stringify(session))
    this.emit({ session, hydrating: false })
  }

  clear(): void {
    this.#accessToken = null
    this.storage.setRefreshToken(null)
    this.storage.setItem(SNAPSHOT_KEY, null)
    this.emit({ session: null, hydrating: false })
  }

  /** The boot-time refresh finished (or was never worth attempting). */
  settleHydration(): void {
    if (this.#state.hydrating) this.emit({ ...this.#state, hydrating: false })
  }
}

export class SessionStore extends BaseSessionStore<Session> {
  constructor(storage: TokenStorage) {
    super(storage, (value) => (isSession(value) ? value : null))
  }

  /** login, refresh and switch-tenant all resolve a fresh pair; they all land here. */
  applyTokens(pair: TokenPair): void {
    this.settle(toSession(pair), pair.accessToken, pair.refreshToken)
  }

  /** After changePassword: the same session, with `mustChangePassword` cleared. */
  updateUser(user: AuthUser): void {
    const current = this.state.session
    if (!current) return
    const session: Session = { ...current, user }
    this.storage.setItem(SNAPSHOT_KEY, JSON.stringify(session))
    this.emit({ session, hydrating: false })
  }
}

/** The console's store. Same plumbing, and a session that has no distributor by construction. */
export class PlatformSessionStore extends BaseSessionStore<PlatformSession> {
  constructor(storage: TokenStorage) {
    super(storage, (value) => (isPlatformSession(value) ? value : null))
  }

  applyTokens(pair: PlatformTokenPair): void {
    this.settle({ user: pair.user, role: pair.role }, pair.accessToken, pair.refreshToken)
  }

  updateUser(user: AuthUser): void {
    const current = this.state.session
    if (!current) return
    const session: PlatformSession = { ...current, user }
    this.storage.setItem(SNAPSHOT_KEY, JSON.stringify(session))
    this.emit({ session, hydrating: false })
  }
}
