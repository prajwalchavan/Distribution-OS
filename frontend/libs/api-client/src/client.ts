/**
 * The typed client every Distribution OS app uses.
 *
 * Two oRPC clients over one session: `auth` talks to auth-service, `api` talks to this app's own
 * service (owner :3001, manager :3002, ...). Both attach the in-memory access token, share ONE
 * single-flight refresh, retry a 401 exactly once, and convert everything they can throw into an
 * `ApiError` before it reaches a screen.
 *
 * Base URLs: one per app, from `VITE_API_URL` / `EXPO_PUBLIC_API_URL`. The optional `prefix` is what
 * makes the same build work against the all-in-one process (docs/26 section 7), where every service is
 * mounted behind a path: `apiUrl` `https://api.example.in` + `prefix` `/owner`.
 */
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { uuidv7 } from '@dos/domain'
import {
  authContract,
  contract,
  type AuthMe,
  type AuthPlatform,
  type MembershipRole,
  type TokenPair,
} from '@dos/contracts'

import { ApiError, ORPCError, toApiError } from './errors.js'
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchWithDeadline, join } from './link.js'
import { SessionStore, type Session, type SessionState } from './session.js'
import { memoryTokenStorage, webTokenStorage, type TokenStorage } from './storage.js'

export type ApiRouter = ContractRouterClient<typeof contract>
export type AuthRouter = ContractRouterClient<typeof authContract>

/**
 * The auth procedures that authenticate through the BODY, or not at all. They are the only ones never
 * refreshed before the call and never replayed after a 401: `refresh` retried on its own 401 would
 * loop, and refreshing before `login`, `logout` or `switchTenant` would rotate the very token they are
 * about to send. Everything else auth-service serves, it serves under a Bearer token, and those are
 * healed exactly like a call to this app's own service.
 *
 * A DENY-LIST, READ OFF THE WHOLE PATH. It was an allow-list of four names read off `path[0]`, and
 * `auth.memberships.summary` is nested — its `path[0]` is 'memberships' — so it fell outside and became
 * the one authenticated read in the product that neither refreshed a dying token nor healed a 401. The
 * shop's home screen turned the throw into "You owe Rs 0.00 across 3 distributors" (DOS-102
 * verification). Inverted, a procedure added to the auth contract tomorrow is healed the day it lands,
 * and only a body-authenticated one has to be remembered here.
 */
const BODY_AUTHENTICATED_AUTH_PATHS: ReadonlySet<string> = new Set([
  'login',
  'refresh',
  'logout',
  'switchTenant',
  'forgotPassword',
  'resetPassword',
  'platformLogin',
  'platformRefresh',
  'jwks',
])

/** True when this auth path carries a Bearer token, and so is worth a refresh and one replay. */
export function isBearerAuthPath(path: readonly string[]): boolean {
  return !BODY_AUTHENTICATED_AUTH_PATHS.has(path.join('.'))
}

/** How long a sign-in waits for the device's last leaving before it goes on (DOS-167 addendum (z2)). */
const LEAVING_WAIT_MS = 25_000

/**
 * How close to the end of an access token's life a call refreshes BEFORE it goes out (DOS-089).
 *
 * The token lives 15 minutes and nothing watched the clock, so the first call after it expired was always a 401
 * the interceptor then healed — 31 of them on `/sync/manifest` in one sales afternoon, one per navigation, each a
 * wasted round trip on a phone's data and a line in every service log. A minute is long enough to cover the
 * request's own flight and a device clock a little out of step, and short enough that a normal session refreshes
 * once per token rather than on a timer nobody can see.
 */
const REFRESH_BEFORE_EXPIRY_MS = 60_000

export interface CreateApiClientOptions {
  /** Base URL of this app's own service. Same-origin `/api` behind a dev proxy is fine. */
  apiUrl: string
  /** Base URL of auth-service. Its contract routes already start with `/auth`, so this is the origin. */
  authUrl: string
  /** All-in-one mode: the path this app's service is mounted behind, e.g. `/owner`. */
  prefix?: string
  /**
   * SIX SERVICES, ONE CLIENT (docs/31 §2). The one app has no single service of its own: the ELECTED
   * role in the token decides which one this request belongs to, and this answers with that origin
   * (`serviceFor(role, base)` in `services.ts`). Returning `undefined` falls back to `apiUrl` +
   * `prefix`, which is what a call made with no session gets — a request that is a 401 whichever
   * origin it leaves for.
   *
   * ONE PROVIDER, NOT A REBUILT CLIENT. Rebuilding `createApiClient` when the role changes would drop
   * the in-memory access token and the single-flight refresh with it, so the link's `url` is a
   * function instead: oRPC types it `Value<Promisable<string | URL>, [options, path, input]>` and
   * evaluates it per request.
   *
   * EVALUATED ONCE PER REQUEST, AND PINNED FOR THAT REQUEST'S REPLAY (architect's ruling): the
   * interceptor reads it before the first attempt and hands the answer down, so the 401 replay goes
   * back to the service the call set off for and never to whichever one the app has since elected.
   */
  apiUrlFor?: () => string | undefined
  /** All-in-one mode: normally `/auth` is part of the route, so this stays empty. */
  authPrefix?: string
  /** Defaults to `webTokenStorage()` in a browser and to memory anywhere else. */
  storage?: TokenStorage
  /** Which app this is; sent on login so `auth_sessions` can name the device. */
  platform?: AuthPlatform
  /**
   * ROLE ELECTION (docs/29 §2, founder 2026-09-21): the role this app asks to act as when the CALLER
   * names none. The six per-role apps declare it here — a van phone must hold a delivery token and
   * never an owner token, whoever is driving today.
   *
   * IN THE ONE APP NOTHING IS DECLARED HERE (docs/31 ruling B3): with `APP.role` gone there is no app
   * to ask on the person's behalf, so the PERSON elects at the Continue-as chooser and the choice
   * arrives as `SignInOptions.actAs` — and afterwards as `electRole`, which mints a new token. A
   * per-call `actAs` always wins over this; this is only the default for a caller that passes none.
   *
   * The server grants it only downward from that membership (`ROLE_ELECTION` in `@dos/domain`) and
   * refuses anything else with a sentence the person can act on. Asking is all the device does: it is
   * never the thing that decides.
   */
  actAs?: MembershipRole
  /** Device name for the sessions list. Defaults to the browser's user agent, trimmed. */
  deviceName?: string
  /** Called whenever the session ends, including when a refresh is rejected. */
  onSignOut?: (reason: ApiError | null) => void
  /**
   * How long one request may go unanswered before it becomes "No connection", in ms. Default 20 s;
   * 0 disables it. A dead spot on an Indian highway does not REFUSE the connection — it accepts it
   * and never answers, and `fetch` has no timeout of its own, so without this every screen sits on a
   * skeleton for the OS TCP timeout (minutes) while the strip says the data is fresh. Measured on
   * the owner app against a suspended owner-service: skeletons and "Updated just now" for 40 s.
   */
  requestTimeoutMs?: number
}

export interface SignInOptions {
  username: string
  password: string
  /** Only for a user who belongs to more than one distributor. Omit otherwise (docs/22 section 7). */
  tenantId?: string
  /** "Remember this device": keeps the session across a browser restart. Default true. */
  remember?: boolean
  /**
   * THE CHOOSER'S CHOICE (docs/31 ruling B3). The role this PERSON elected at "Continue as …", sent
   * on this login and remembered for the distributor switches that follow it. Omit it to fall back to
   * `CreateApiClientOptions.actAs` — the constant the six per-role apps declare — and, with neither,
   * to sign in as the membership's own role.
   */
  actAs?: MembershipRole
}

/** The id and the idempotency key one user intent carries — the SAME pair on every retry. */
export interface MutationMeta {
  /** Client-generated UUIDv7 primary key for the row being created. */
  readonly id: string
  /** `UNIQUE(tenant_id, idempotency_key)`: a replay returns the stored result, never a second row. */
  readonly idempotencyKey: string
}

/** One per user intent (a tap). Regenerate for a NEW intent, never for a retry of the same one. */
export function newMutation(): MutationMeta {
  return { id: uuidv7(), idempotencyKey: uuidv7() }
}

export function newId(): string {
  return uuidv7()
}

export interface ApiClient {
  /** Tenant-scoped procedures: catalog, orders, pricing, receivables, ... */
  readonly api: ApiRouter
  /** auth-service procedures. */
  readonly auth: AuthRouter
  readonly session: SessionStore
  /** Sign in with username + password. Resolves once the session is live. */
  signIn: (options: SignInOptions) => Promise<Session>
  /** Revokes this device's session server-side (best effort), then always clears locally. */
  signOut: () => Promise<void>
  /**
   * Sign out on THIS device first, then leave it (DOS-167 addendum (y)). In the same turn: the access token in memory
   * and the refresh token and snapshot in storage are cleared, before any network call — a crash from here on
   * relaunches to the sign-in form — and `leave(stored)` is called, `stored` settling once the platform store has let
   * go of the session too (on a phone that delete is asynchronous). Only once `leave` has settled does the client ask
   * the server to revoke, with the refresh token it kept in memory: best effort, in the background, never signing
   * anyone back in. Resolves when `leave` has, never waiting for the revoke. Until then a `signIn` on this client
   * waits: nobody signs in on a phone that is still leaving — for at most 25 s, then it goes on (addendum (z2)).
   */
  signOutOnDevice: (leave: (stored: Promise<void>) => Promise<void>) => Promise<void>
  /** Who am I, in this distributorship. Refreshes the local session snapshot. */
  me: () => Promise<AuthMe>
  /**
   * Open a session on another membership of the same user.
   *
   * `actAs` carries the election across (docs/29 §2): the other distributor elects against ITS
   * membership, so the same person asking for `delivery` there is granted it there or refused there.
   * Omitted, it repeats whatever this session last elected — a driver who switches distributor stays
   * a driver rather than quietly becoming an owner at the next one.
   */
  switchDistributor: (tenantId: string, actAs?: MembershipRole) => Promise<Session>
  /**
   * A FRESH ELECTION on this distributor (docs/31 ruling B3): a new token, minted with `role`.
   *
   * Changing role is never a client-side group change under the same token — that token would still
   * reach the old role's service for the life of its refresh. It is `switchTenant` against the tenant
   * already signed into, carrying `actAs`, which re-validates the election against the membership and
   * its `extra_roles` as they are NOW and refuses with a sentence the person can act on.
   */
  electRole: (role: MembershipRole) => Promise<Session>
  /** Change the password; the server revokes every OTHER session, this device stays signed in. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  /** Boot: exchange a surviving refresh token for a live access token. A no-op when there is none. */
  hydrate: () => Promise<void>
  /** One id + one idempotency key per user intent. */
  newMutation: () => MutationMeta
}

function defaultStorage(): TokenStorage {
  return typeof window === 'undefined' ? memoryTokenStorage() : webTokenStorage()
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof ORPCError && err.status === 401
}

/**
 * Where the api link reads the base this request was PINNED to (docs/31 §2, architect's ruling).
 *
 * oRPC threads one options object from the interceptor to the codec (`intercept(interceptors,
 * {...options, path, input}, ({path, input, ...rest}) => codec.encode(path, input, rest))`), so the
 * interceptor computes `apiUrlFor()` once, hands it down on that object, and the link's `url`
 * function reads it back. The REPLAY after a 401 therefore leaves for the same service the first
 * attempt did; it is not re-asked, which is the whole point of pinning it.
 *
 * A string key rather than a symbol: the object is spread twice on the way through, and a spread
 * copies string keys and symbols alike, but the name is what shows up honestly in a debugger.
 */
const PINNED_API_BASE = '__dosApiBase'

function pinnedApiBase(callOptions: unknown): string | undefined {
  if (typeof callOptions !== 'object' || callOptions === null) return undefined
  const pinned = (callOptions as Record<string, unknown>)[PINNED_API_BASE]
  return typeof pinned === 'string' ? pinned : undefined
}

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const storage = options.storage ?? defaultStorage()
  const session = new SessionStore(storage)

  /**
   * The election this session is running under, so a distributor switch repeats it (docs/29 §2).
   * It starts as the app's declared constant — the six per-role apps — and the one app's chooser
   * replaces it at every sign-in and every `electRole`.
   */
  let elected: MembershipRole | undefined = options.actAs

  /** This app's own service when nothing elects one: `apiUrl` + `prefix`, as it always was. */
  const fallbackApiUrl = join(options.apiUrl, options.prefix)

  /** The service the CURRENT elected role talks to; the fallback when no role has been elected yet. */
  function currentApiBase(): string {
    return options.apiUrlFor?.() ?? fallbackApiUrl
  }

  async function headers(): Promise<Record<string, string>> {
    const token = session.accessToken
    return token === null ? {} : { authorization: `Bearer ${token}` }
  }

  let refreshInFlight: Promise<void> | null = null

  /**
   * WHICH SESSION AN ANSWER BELONGS TO (DOS-167 addendum (y), merge review of ruling 2, problem 1). Every sign-in,
   * switch and sign-out starts a new one; a token refresh does not. An answer that set off under one and arrives under
   * another writes nothing and replays nothing: a refresh in flight when the person signed out on this phone used to
   * write its rotated pair back — signing in again the rep who had just chosen to leave, or replacing the next
   * person's session with his — and replay the call under it.
   */
  let generation = 0

  /** What a call or a refresh answers once the session it belonged to has ended. */
  function sessionEnded(): ApiError {
    return new ApiError({ kind: 'auth', status: 401, message: 'Signed out.' })
  }

  /**
   * The device's own leaving after `signOutOnDevice` — the engine ended, the person's other files swept, their drafts
   * forgotten — until it has settled (merge review of ruling 2, problem 2). The session is cleared before it begins,
   * so the sign-in form is already on the screen: a sign-in waits for this rather than open the same file, or let a
   * sweep and a forgetting still running reach the person signing in.
   */
  let leaving: Promise<void> = Promise.resolve()

  /**
   * The sign-in's wait for `leaving`, capped (DOS-167 addendum (z2)). A native close that never answered held every
   * sign-in on the phone behind a spinner until the app was killed. Past `LEAVING_WAIT_MS` the sign-in goes on and says
   * so — the engine's file holds still keep one person's file from being opened twice — and a later sign-in does not
   * wait for that same leaving again.
   */
  async function waitForLeaving(): Promise<void> {
    const waited = leaving
    let timer: ReturnType<typeof setTimeout> | undefined
    const capped = new Promise<'capped'>((resolve) => {
      timer = setTimeout(() => {
        resolve('capped')
      }, LEAVING_WAIT_MS)
    })
    const outcome = await Promise.race([waited.then(() => 'left' as const), capped])
    clearTimeout(timer)
    if (outcome === 'left') return
    console.warn('sign-in did not wait for a leaving that took over 25 s')
    if (leaving === waited) leaving = Promise.resolve()
  }

  /**
   * Only the SERVER may end a session.
   *
   * A refresh that comes back 401 (rejected, reused, expired) means the session is really gone and
   * the token is worthless — clear it. A refresh that never reached a service (no signal, the phone
   * in a basement, the godown's dead spot, a 502 at the load balancer) says nothing about the token,
   * and clearing it there would sign a delivery boy out for the rest of his day and demand a password
   * he cannot verify offline. UX-00 section 12: "the session survives a phone call and a day without
   * signal".
   */
  function endsTheSession(err: ApiError): boolean {
    return err.kind === 'auth'
  }

  async function refreshNow(): Promise<void> {
    const refreshToken = session.refreshToken
    if (refreshToken === null) {
      const err = new ApiError({ kind: 'auth', status: 401, message: 'Signed out.' })
      session.clear()
      options.onSignOut?.(err)
      throw err
    }
    const at = generation
    try {
      const pair = await authClient.refresh({ refreshToken, deviceId: session.deviceId })
      if (generation !== at) {
        // The session that asked is gone: the pair is nobody's. Never written; revoked, best effort, in the background.
        void authClient.logout({ refreshToken: pair.refreshToken }).catch(() => undefined)
        throw sessionEnded()
      }
      session.applyTokens(pair)
    } catch (raw) {
      const err = toApiError(raw)
      // A refusal ends only the session that asked, never one begun since.
      if (endsTheSession(err) && generation === at) {
        generation += 1
        session.clear()
        options.onSignOut?.(err)
      }
      throw err
    }
  }

  /** Single-flight: a burst of 401s across both clients shares one refresh, not one each. */
  function ensureFreshAccessToken(): Promise<void> {
    refreshInFlight ??= refreshNow().finally(() => {
      refreshInFlight = null
    })
    return refreshInFlight
  }

  /**
   * BEFORE THE CALL, NOT AFTER THE 401 (DOS-089). A token with less than a minute left is refreshed first, sharing
   * the single flight above, so a burst of screens pays for one refresh and none of them earns a 401.
   *
   * It never turns a failure of its own into the caller's: a refresh that could not reach the office (the dead spot
   * this whole client is built for) leaves the token that is there to be sent, and the 401 path — still exactly
   * where it was — covers a token revoked early or a device clock that disagrees. Called only for the paths that
   * carry a Bearer token: `login`, `refresh` and `logout` authenticate through the body, and refreshing for them
   * would rotate the very token they are about to use.
   */
  async function refreshBeforeExpiry(): Promise<void> {
    const expiresAt = session.accessExpiresAt
    if (session.accessToken === null || expiresAt === null) return
    if (expiresAt - Date.now() > REFRESH_BEFORE_EXPIRY_MS) return
    if (session.refreshToken === null) return
    try {
      await ensureFreshAccessToken()
    } catch {
      // Said above: the call goes out with what this device has.
    }
  }

  /**
   * One interceptor for both links. On a 401 it refreshes ONCE and replays the call; every other
   * failure — and a second 401 — leaves as an `ApiError`, so no screen ever sees a raw fetch error.
   */
  function interceptor(
    retryable: (path: readonly string[]) => boolean,
    /** The api link pins its base for the request; the auth link has one origin and pins nothing. */
    pinBase: boolean,
  ) {
    return async (opts: {
      /*
       * Method syntax, not a property: oRPC declares `next(options?: TOptions)` and TypeScript
       * compares method parameters bivariantly, which is what lets this one name the argument
       * `unknown` and still satisfy `Interceptor<StandardLinkInterceptorOptions<…>>` without
       * importing a type out of the library's internals.
       */
      next(callOptions?: unknown): Promise<unknown>
      path: readonly string[]
    }): Promise<unknown> => {
      const at = generation
      if (retryable(opts.path)) await refreshBeforeExpiry()
      /*
       * ONCE PER REQUEST, HERE — before the first attempt, and the same answer for the replay below.
       * `next` is oRPC's own: called with an options object it hands THAT one down to the codec, and
       * `{ next: _, ...rest }` is exactly the object it would have used, so nothing else is changed.
       */
      let pinned: Record<string, unknown> | undefined
      if (pinBase) {
        // Everything oRPC handed in, minus its own `next` and plus the base this request is pinned
        // to. Copied rather than destructured: pulling a method off an object is how `this` is lost.
        pinned = { ...opts, [PINNED_API_BASE]: currentApiBase() }
        delete pinned['next']
      }
      const send = (): Promise<unknown> => (pinned === undefined ? opts.next() : opts.next(pinned))
      try {
        return await send()
      } catch (err) {
        if (!isUnauthorized(err) || !retryable(opts.path)) throw toApiError(err)
        // A call made under a session that has since ended is never refreshed, nor replayed under another (problem 1).
        if (generation !== at) throw toApiError(err)
        try {
          await ensureFreshAccessToken()
        } catch (refreshErr) {
          // The refresh is what actually failed. If the signal died on the way, the screen must
          // read "No connection", not "Signed out" — the session is still there, unreachable.
          const failure = toApiError(refreshErr)
          throw endsTheSession(failure) ? toApiError(err) : failure
        }
        if (generation !== at) throw toApiError(err)
        try {
          return await send()
        } catch (second) {
          throw toApiError(second)
        }
      }
    }
  }

  /** `link.ts`: the deadline, shared with the platform console's client so the two cannot drift. */
  const deadline = fetchWithDeadline(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)

  const authLink = new OpenAPILink(authContract, {
    url: join(options.authUrl, options.authPrefix),
    headers,
    fetch: deadline,
    interceptors: [interceptor(isBearerAuthPath, false)],
  })
  const authClient: AuthRouter = createORPCClient<AuthRouter>(authLink)

  const apiLink = new OpenAPILink(contract, {
    /*
     * The base the INTERCEPTOR pinned for this request (docs/31 §2). `currentApiBase()` is only the
     * fallback for a call that reached the link without going through it — nothing in this client
     * does, but a link is not a place to assume.
     */
    url: (callOptions) => pinnedApiBase(callOptions) ?? currentApiBase(),
    headers,
    fetch: deadline,
    interceptors: [interceptor(() => true, true)],
  })
  const apiClient: ApiRouter = createORPCClient<ApiRouter>(apiLink)

  /**
   * React Native has a `navigator`, but not a `userAgent` on it — reading `.slice` off `undefined`
   * threw before the first request on a phone (found running the universal template in the iOS
   * simulator, 2026-09-06). The sessions list simply goes unnamed where the platform has no string.
   */
  const userAgent = typeof navigator === 'undefined' ? undefined : navigator.userAgent
  const deviceName =
    options.deviceName ?? (typeof userAgent === 'string' ? userAgent.slice(0, 120) : undefined)

  /**
   * `switchTenant`: the one call that mints a token for an existing session.
   *
   * It serves both `switchDistributor` (another distributor, the same election) and `electRole`
   * (this distributor, a different election) because on the wire they are the same request — and
   * because ruling B3 says a role changes by MINTING A TOKEN, never by the app deciding to render a
   * different group under the token it already holds.
   */
  async function switchTo(tenantId: string, actAs?: MembershipRole): Promise<Session> {
    const refreshToken = session.refreshToken
    if (refreshToken === null) {
      throw new ApiError({ kind: 'auth', status: 401, message: 'Signed out.' })
    }
    // Another session: the old distributor's calls still on their way are never replayed under this one.
    const at = ++generation
    const want = actAs ?? elected
    const pair = await authClient.switchTenant({
      refreshToken,
      deviceId: session.deviceId,
      tenantId,
      // The other distributor elects against ITS membership (docs/29 §2): the same person asks for
      // the same role there, and is refused there if that login is not allowed it.
      ...(want === undefined ? {} : { actAs: want }),
    })
    if (generation !== at) {
      // Signed out while the switch was on its way: nobody's pair, never written.
      void authClient.logout({ refreshToken: pair.refreshToken }).catch(() => undefined)
      throw sessionEnded()
    }
    elected = want
    session.applyTokens(pair)
    const current = session.getSnapshot().session
    if (!current) throw new ApiError({ kind: 'unknown', message: 'Switch did not settle.' })
    return current
  }

  return {
    api: apiClient,
    auth: authClient,
    session,
    newMutation,

    async signIn(input: SignInOptions): Promise<Session> {
      // A new session: anything still on its way for the last one writes nothing (problem 1).
      generation += 1
      // Never on a phone that is still leaving (addendum (y)): the last sign-out finishes on the device first — for at
      // most 25 s (addendum (z2)).
      await waitForLeaving()
      const want = input.actAs ?? options.actAs
      storage.setDurable?.(input.remember !== false)
      const pair: TokenPair = await authClient.login({
        username: input.username,
        password: input.password,
        deviceId: session.deviceId,
        ...(deviceName ? { deviceName } : {}),
        ...(options.platform ? { platform: options.platform } : {}),
        // Sent ONLY for a user with more than one membership: a tenantId they are not a member of is
        // a 403, including the sample value an API console pre-fills (auth contract, LoginInput).
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        /*
         * docs/29 §2: the role being asked for. The CHOOSER's choice first (ruling B3), then the
         * constant a per-role app declares, and nothing at all when neither says anything — which
         * signs the person in as their membership's own role.
         */
        ...(want === undefined ? {} : { actAs: want }),
      })
      // The election this session runs under, so the switches after it repeat this choice.
      elected = want
      session.applyTokens(pair)
      const current = session.getSnapshot().session
      if (!current) throw new ApiError({ kind: 'unknown', message: 'Sign-in did not settle.' })
      return current
    },

    async signOut(): Promise<void> {
      generation += 1
      const refreshToken = session.refreshToken
      if (refreshToken !== null) {
        try {
          await authClient.logout({ refreshToken })
        } catch {
          // Sign out locally even when the network call failed: the token is already unusable here.
        }
      }
      session.clear()
      options.onSignOut?.(null)
    },

    signOutOnDevice(leave: (stored: Promise<void>) => Promise<void>): Promise<void> {
      // Kept in memory only, for the revoke: the one copy that outlives the clear below.
      const refreshToken = session.refreshToken
      // A refresh or a call still on its way for this session writes nothing, and replays nothing (problem 1).
      generation += 1
      const stored = session.clearOnDevice()
      options.onSignOut?.(null)
      // In the same turn as the clear: the leave flow ends the engine before the cleared session re-renders the app.
      let local: Promise<void>
      try {
        local = leave(stored)
      } catch (error) {
        local = Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
      const settled = local.then(
        () => undefined,
        () => undefined,
      )
      const before = leaving
      leaving = settled.then(() => before)
      void settled.then(async () => {
        if (refreshToken === null) return
        try {
          await authClient.logout({ refreshToken })
        } catch {
          // Best effort: the token is already gone from this device; a revoke that never arrived changes nothing here.
        }
      })
      return local
    },

    async me(): Promise<AuthMe> {
      const at = generation
      const answer = await authClient.me()
      if (generation === at) session.updateUser(answer.user)
      return answer
    },

    switchDistributor: switchTo,

    electRole(role: MembershipRole): Promise<Session> {
      const current = session.getSnapshot().session
      if (current === null) {
        return Promise.reject(new ApiError({ kind: 'auth', status: 401, message: 'Signed out.' }))
      }
      // The same distributor, a different role: `switchTenant` is what mints a token, and a fresh
      // token is the ONLY way a role changes (ruling B3).
      return switchTo(current.tenant.id, role)
    },

    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      const at = generation
      await authClient.changePassword({ currentPassword, newPassword })
      const answer = await authClient.me()
      if (generation === at) session.updateUser(answer.user)
    },

    async hydrate(): Promise<void> {
      if (!session.hasPersistedSession) {
        session.settleHydration()
        return
      }
      try {
        await ensureFreshAccessToken()
      } catch {
        // A 401 has already cleared the session and told `onSignOut`. Anything else (no signal, a
        // service that is down) leaves the restored snapshot in place: the app opens on its last
        // known screen and every read says "No connection" until the signal is back.
      } finally {
        session.settleHydration()
      }
    },
  }
}

export type { Session, SessionState }
