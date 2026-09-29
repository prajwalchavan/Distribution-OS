import { authContract, type MembershipRole } from '@dos/contracts'
import { stableUuid } from './ids.js'

/**
 * A CLIENT OF THE RUNNING API, nothing more. Every call is an HTTP request to the all-in-one process, at
 * the prefix of the service the signed-in role belongs to, with the contract's own route and shape. The
 * tool never opens a database connection to write and never calls a service in-process.
 *
 * Typed from the contract itself: `InputOf<typeof contract.orders.create>` is exactly the Zod input the
 * server parses, so a wrong field is a compile error here, not a 400 at run time.
 */

interface RouteMeta {
  method?: string
  path?: string
}
export interface ProcLike {
  '~orpc': { route: RouteMeta }
}
type SchemaOf<P, K extends 'inputSchema' | 'outputSchema'> = P extends { '~orpc': infer D }
  ? K extends keyof D
    ? NonNullable<D[K]>
    : never
  : never
/** The input a procedure's Zod schema accepts (defaults applied by the server, so optional here). */
export type InputOf<P> =
  SchemaOf<P, 'inputSchema'> extends { _zod: { input: infer I } } ? I : Record<string, never>
/** What the procedure answers. */
export type OutputOf<P> =
  SchemaOf<P, 'outputSchema'> extends { _zod: { output: infer O } } ? O : unknown

/** Which all-in-one prefix serves which role (the service a real app of that role talks to). */
export const SERVICE_OF: Record<MembershipRole, string> = {
  owner: 'owner',
  manager: 'manager',
  accountant: 'manager',
  salesperson: 'sales',
  warehouse: 'warehouse',
  delivery: 'delivery',
  retailer: 'retailer',
}

/** A refusal from the API: an answer, not a crash. The run counts it and goes on. */
export class ApiRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly data: unknown,
  ) {
    super(message)
  }
  /** What a summary line shows: the status and the API's own code, never the message (it may name a shop). */
  get label(): string {
    const inner = (this.data as { code?: unknown } | null)?.code
    return `${String(this.status)} ${typeof inner === 'string' ? inner : this.code}`
  }
}

export interface Session {
  username: string
  role: MembershipRole
  userId: string
  tenantId: string
  accessToken: string
  refreshToken: string
  deviceId: string
  mustChangePassword: boolean
}

export interface CallStats {
  reads: number
  writes: number
  /** A read answered 404: the thing is not there yet (every "is it made?" look-up starts with one). */
  notFound: number
  refusals: number
  signIns: number
}

const REQUEST_TIMEOUT_MS = 30_000

function queryString(input: Record<string, unknown>, skip: ReadonlySet<string>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(input)) {
    if (skip.has(k) || v === undefined || v === null) continue
    if (Array.isArray(v)) v.forEach((x, i) => q.append(`${k}[${String(i)}]`, String(x)))
    else if (typeof v === 'object') continue
    else q.append(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export class Api {
  readonly stats: CallStats = { reads: 0, writes: 0, notFound: 0, refusals: 0, signIns: 0 }

  constructor(
    readonly base: string,
    /** The client name the auth service records for every sign-in the tool makes. */
    private readonly deviceName = 'Office tablet',
  ) {}

  private async http(
    url: string,
    init: RequestInit,
  ): Promise<{ status: number; body: unknown; ok: boolean }> {
    let res: Response
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    } catch (err) {
      throw new ApiRefusal(0, 'NO_RESPONSE', err instanceof Error ? err.message : String(err), null)
    }
    const text = await res.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    return { status: res.status, body, ok: res.ok }
  }

  private refusal(status: number, body: unknown): ApiRefusal {
    const b = (body ?? {}) as { code?: unknown; message?: unknown; data?: unknown }
    return new ApiRefusal(
      status,
      typeof b.code === 'string' ? b.code : `HTTP_${String(status)}`,
      typeof b.message === 'string' ? b.message : '',
      b.data ?? null,
    )
  }

  /** Is the API up? `/health` answers 200 when the process and its database are. */
  async health(): Promise<boolean> {
    try {
      const r = await this.http(`${this.base}/health`, { method: 'GET' })
      return r.status === 200
    } catch {
      return false
    }
  }

  /** `POST /auth/auth/login` with a device id that is stable per tenant and person. */
  async signIn(username: string, password: string, tenantKey: string): Promise<Session> {
    const deviceId = stableUuid(`demo-fill:device:${tenantKey}:${username}`)
    const route = authContract.login['~orpc'].route
    const r = await this.http(`${this.base}/auth${route.path ?? '/auth/login'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        deviceId,
        deviceName: this.deviceName,
        platform: 'web',
      }),
    })
    this.stats.signIns++
    if (!r.ok) throw this.refusal(r.status, r.body)
    const b = r.body as {
      accessToken: string
      refreshToken: string
      role: MembershipRole
      user: { id: string; mustChangePassword: boolean }
      tenant: { id: string }
    }
    return {
      username,
      role: b.role,
      userId: b.user.id,
      tenantId: b.tenant.id,
      accessToken: b.accessToken,
      refreshToken: b.refreshToken,
      deviceId,
      mustChangePassword: b.user.mustChangePassword,
    }
  }

  private async refresh(s: Session): Promise<boolean> {
    const route = authContract.refresh['~orpc'].route
    const r = await this.http(`${this.base}/auth${route.path ?? '/auth/refresh'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: s.refreshToken, deviceId: s.deviceId }),
    })
    if (!r.ok) return false
    const b = r.body as { accessToken: string; refreshToken: string }
    s.accessToken = b.accessToken
    s.refreshToken = b.refreshToken
    return true
  }

  /** Revoke the session this run opened (one UPDATE; the row stays, as every sign-out's does). */
  async signOut(s: Session): Promise<void> {
    const route = authContract.logout['~orpc'].route
    await this.http(`${this.base}/auth${route.path ?? '/auth/logout'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: s.refreshToken }),
    }).catch(() => undefined)
  }

  /** An auth-service procedure that needs the bearer (`changePassword`). */
  async authCall<P extends ProcLike>(s: Session, proc: P, input: InputOf<P>): Promise<OutputOf<P>> {
    return this.send(s, `${this.base}/auth`, proc, input as Record<string, unknown>)
  }

  /** A procedure of the service the session's role belongs to. */
  async call<P extends ProcLike>(s: Session, proc: P, input: InputOf<P>): Promise<OutputOf<P>> {
    return this.send(
      s,
      `${this.base}/${SERVICE_OF[s.role]}`,
      proc,
      input as Record<string, unknown>,
    )
  }

  private async send<O>(
    s: Session,
    prefix: string,
    proc: ProcLike,
    input: Record<string, unknown>,
  ): Promise<O> {
    const route = proc['~orpc'].route
    const method = (route.method ?? 'POST').toUpperCase()
    const pathParams = new Set<string>()
    const path = (route.path ?? '').replace(/\{(\w+)\}/g, (_m, name: string) => {
      pathParams.add(name)
      return encodeURIComponent(String(input[name]))
    })
    const url =
      method === 'GET' ? `${prefix}${path}${queryString(input, pathParams)}` : `${prefix}${path}`
    const init = (): RequestInit => ({
      method,
      headers: {
        authorization: `Bearer ${s.accessToken}`,
        ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(input) }),
    })
    // `pricing.quote` is a POST that writes nothing: counted as the read it is.
    const isRead = method === 'GET' || route.path === '/pricing/quote'
    if (isRead) this.stats.reads++
    else this.stats.writes++
    let r = await this.http(url, init())
    if (r.status === 401 && (await this.refresh(s))) r = await this.http(url, init())
    if (!r.ok) {
      if (isRead && r.status === 404) this.stats.notFound++
      else this.stats.refusals++
      throw this.refusal(r.status, r.body)
    }
    return r.body as O
  }
}
