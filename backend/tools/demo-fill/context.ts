import { authContract, contract } from '@dos/contracts'
import {
  Api,
  ApiRefusal,
  type InputOf,
  type OutputOf,
  type ProcLike,
  type Session,
} from './client.js'
import { demoId, demoKey } from './ids.js'
import {
  newPassword,
  readLogins,
  testersFor,
  writeLogins,
  type LoginLine,
  type Tester,
  type TesterKey,
} from './people.js'
import type { Section, Summary } from './summary.js'

/**
 * One run's shared state: the API, who is signed in, the date whose work is being made, dry run or commit,
 * and the summary every step writes into. Sessions are opened LAZILY — a person signs in only when they
 * have something to do — so a second run of the same date, which has nothing to do, signs in the owner
 * alone.
 */
export interface RunOptions {
  api: string
  tenant: string
  ownerUsername: string
  ownerPassword: string
  loginsFile: string
  date: string
  commit: boolean
  /** `tester.manager.<suffix>` instead of `tester.manager` (a second distributor on one database). */
  loginSuffix?: string | undefined
  log: (line: string) => void
}

export class Ctx {
  readonly api: Api
  owner!: Session
  private readonly sessions = new Map<TesterKey, Session>()
  readonly logins: Map<string, LoginLine>
  /** Person → user id, filled from the staff list. */
  readonly userIds = new Map<TesterKey, string>()
  /** This run's tester people (their usernames carry `loginSuffix` when one is given). */
  readonly testers: readonly Tester[]
  private loginsDirty = false

  constructor(
    readonly opts: RunOptions,
    readonly summary: Summary,
  ) {
    this.api = new Api(opts.api)
    this.logins = readLogins(opts.loginsFile)
    this.testers = testersFor(opts.loginSuffix)
  }

  tester(key: TesterKey): Tester {
    const t = this.testers.find((x) => x.key === key)
    if (!t) throw new Error(`no tester ${key}`)
    return t
  }

  get commit(): boolean {
    return this.opts.commit
  }
  get tenantId(): string {
    return this.owner.tenantId
  }
  log(line: string): void {
    this.opts.log(line)
  }

  async signInOwner(): Promise<void> {
    this.owner = await this.api.signIn(
      this.opts.ownerUsername,
      this.opts.ownerPassword,
      this.opts.tenant,
    )
    if (this.owner.role !== 'owner')
      throw new Error(`the owner login signed in as ${this.owner.role}, not owner`)
  }

  /** A read as the owner. Reads are never refused silently: a refusal here throws. */
  read<P extends ProcLike>(proc: P, input: InputOf<P>): Promise<OutputOf<P>> {
    return this.api.call(this.owner, proc, input)
  }
  readAs<P extends ProcLike>(s: Session, proc: P, input: InputOf<P>): Promise<OutputOf<P>> {
    return this.api.call(s, proc, input)
  }

  /**
   * A write, the only door to one. Dry run: counted as "would" and not sent (null). Commit: sent; a refusal is
   * counted with the API's status and code and answered as null, so the step can go on.
   */
  async write<P extends ProcLike>(
    section: Section,
    what: string,
    session: Session | (() => Promise<Session | null>),
    proc: P,
    input: InputOf<P>,
  ): Promise<OutputOf<P> | null> {
    if (!this.commit) {
      this.summary.wouldOne(section, what)
      return null
    }
    const s = typeof session === 'function' ? await session() : session
    if (!s) {
      this.summary.refusedOne(section, what, 'no sign-in')
      return null
    }
    try {
      const out = await this.api.call(s, proc, input)
      this.summary.madeOne(section, what)
      return out
    } catch (e) {
      if (e instanceof ApiRefusal) {
        this.summary.refusedOne(section, what, e.label)
        this.log(`  refused: ${section}/${what} ${e.label}`)
        return null
      }
      throw e
    }
  }

  key(date: string, ...parts: string[]): string {
    return demoKey(date, ...parts)
  }
  /** The id of a row of this distributor (see `demoIdFromKey`). */
  id(date: string, ...parts: string[]): string {
    return demoId(this.tenantId, date, ...parts)
  }

  /**
   * The session of a tester, signed in on first use. When the password in the logins file no longer works
   * (someone changed it, the file was lost) the owner resets it and the tester sets the file's password again
   * — the run heals the login instead of failing on it.
   */
  async as(key: TesterKey): Promise<Session | null> {
    const have = this.sessions.get(key)
    if (have) return have
    if (!this.commit) return null
    const t = this.tester(key)
    const line = this.logins.get(t.username)
    if (line) {
      try {
        const s = await this.api.signIn(t.username, line.password, this.opts.tenant)
        if (!s.mustChangePassword) {
          this.sessions.set(key, s)
          return s
        }
      } catch (e) {
        if (!(e instanceof ApiRefusal) || e.status !== 401) {
          this.summary.refusedOne(
            'people',
            `sign-in ${t.username}`,
            e instanceof ApiRefusal ? e.label : 'error',
          )
          return null
        }
      }
    }
    return this.resetPassword(t)
  }

  /** Owner sets a temporary password; the tester signs in with it and changes it to the file's password. */
  async resetPassword(t: Tester): Promise<Session | null> {
    const userId = this.userIds.get(t.key)
    if (!userId) return null
    const temporary = newPassword()
    const final = this.logins.get(t.username)?.password ?? newPassword()
    const date = this.opts.date
    const reset = await this.write(
      'people',
      'password reset',
      this.owner,
      contract.tenancy.staff.setPassword,
      {
        idempotencyKey: demoKey(
          date,
          'person',
          t.username,
          'reset',
          this.id(date, 'reset', temporary),
        ),
        userId,
        temporaryPassword: temporary,
      },
    )
    if (!reset) return null
    return this.finishPassword(t, temporary, final)
  }

  /** Sign in with the temporary password and set the final one: the login is then the tool's, not temporary. */
  async finishPassword(t: Tester, temporary: string, final: string): Promise<Session | null> {
    try {
      const s = await this.api.signIn(t.username, temporary, this.opts.tenant)
      await this.api.authCall(s, authContract.changePassword, {
        currentPassword: temporary,
        newPassword: final,
      })
      this.logins.set(t.username, { username: t.username, password: final, role: t.role })
      this.loginsDirty = true
      this.saveLogins()
      const again = await this.api.signIn(t.username, final, this.opts.tenant)
      this.sessions.set(t.key, again)
      this.summary.madeOne('people', 'password set')
      return again
    } catch (e) {
      this.summary.refusedOne(
        'people',
        `password ${t.username}`,
        e instanceof ApiRefusal ? e.label : 'error',
      )
      return null
    }
  }

  /** Rewrites the logins file (mode 600) when a password changed, keeping every tester's line. */
  saveLogins(): void {
    if (!this.loginsDirty) return
    const lines = this.testers
      .map((t) => this.logins.get(t.username))
      .filter((l): l is LoginLine => l !== undefined)
    writeLogins(this.opts.loginsFile, this.opts.tenant, lines)
    this.loginsDirty = false
  }

  /** Sign every session this run opened out again. */
  async signOutAll(): Promise<void> {
    for (const s of this.sessions.values()) await this.api.signOut(s)
    if (this.owner) await this.api.signOut(this.owner)
  }
}
