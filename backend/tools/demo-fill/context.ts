import { authContract, contract } from '@dos/contracts'
import {
  Api,
  ApiRefusal,
  type InputOf,
  type OutputOf,
  type ProcLike,
  type Session,
} from './client.js'
import { REFERENCE_TAKEN } from './helpers.js'
import { demoId, demoKey, stopIdOf, tripIdOf, tripParts } from './ids.js'
import {
  DEMO_PASSWORD,
  SHOP_USERNAMES,
  TESTER_KEYS,
  newPassword,
  readLogins,
  testerOf,
  writeLogins,
  type FormerTester,
  type LoginLine,
  type ShopKey,
  type StaffMemberLike,
  type TesterKey,
} from './people.js'
import type { Section, Summary } from './summary.js'

/** Van 1 is driver1's, van 2 driver2's. */
export type VanKey = 'driver1' | 'driver2'

/**
 * One run's shared state: the API, who is signed in, the date whose work is being made, dry run or commit,
 * and the summary every step writes into. Sessions are opened LAZILY — a person signs in only when they
 * have something to do — so a second run of the same date, which has nothing to do, signs in the owner
 * alone (and, at the end, each tester once, to prove the logins file).
 */
export interface RunOptions {
  api: string
  tenant: string
  ownerUsername: string
  ownerPassword: string
  loginsFile: string
  date: string
  commit: boolean
  /** `manager.<suffix>` instead of `manager` (a second distributor on one database). */
  loginSuffix?: string | undefined
  log: (line: string) => void
}

export class Ctx {
  readonly api: Api
  owner!: Session
  private readonly sessions = new Map<TesterKey, Session>()
  /** This run's crew: tester → user id, filled by `ensurePeople` from the staff list (found by the mark). */
  readonly userIds = new Map<TesterKey, string>()
  /** This run's crew: tester → username (its plain one, or the next free plain one when that is taken, D5). */
  readonly usernames = new Map<TesterKey, string>()
  /** Logins the tool made for a tester and uses no more (D6), switched off at the end of the run. */
  former: FormerTester<StaffMemberLike>[] = []
  /** The two vans' vehicle ids (`ensureVans`): van 1 is driver1's, van 2 driver2's. */
  readonly vanIds = new Map<VanKey, string>()
  /**
   * The shopkeepers `shop1…3` (`shopkeepers.ts`): each one's own account, signed up by itself and joined to its
   * stand-in shop by the tool's manager, signed in with the demo password.
   */
  readonly shopSessions = new Map<ShopKey, Session>()

  constructor(
    readonly opts: RunOptions,
    readonly summary: Summary,
  ) {
    this.api = new Api(opts.api)
  }

  get suffix(): string | undefined {
    return this.opts.loginSuffix
  }

  /** The crew's driver of a trip (van key), or null when its driver is not one of this run's (a former tester). */
  crewDriverOf(userId: string | null): VanKey | null {
    if (!userId) return null
    if (this.userIds.get('driver1') === userId) return 'driver1'
    if (this.userIds.get('driver2') === userId) return 'driver2'
    return null
  }

  /** Which of the tool's vans a vehicle is. */
  vanOfVehicle(vehicleId: string): VanKey | null {
    if (this.vanIds.get('driver1') === vehicleId) return 'driver1'
    if (this.vanIds.get('driver2') === vehicleId) return 'driver2'
    return null
  }

  /** The id of van `van`'s trip of `date` with this run's driver (null while the crew has no such driver). */
  tripId(date: string, van: VanKey): string | null {
    const driver = this.userIds.get(van)
    return driver ? tripIdOf(this.tenantId, date, van, driver) : null
  }
  /** Its idempotency key (the id is derived from it). */
  tripKey(date: string, van: VanKey): string | null {
    const driver = this.userIds.get(van)
    return driver ? demoKey(date, ...tripParts(van, driver)) : null
  }
  /** A door of a trip of `date`. */
  stopId(date: string, tripId: string, sequence: number): string {
    return stopIdOf(this.tenantId, date, tripId, sequence)
  }

  /**
   * The SHIFT of a date (D6): empty when the date's work is this crew's alone (every date the tool makes with one
   * crew: its ids are the ones it always had), `s2`, `s3`… when a crew the tool no longer uses already made that
   * date and this crew takes its own shift of it (`day.ts dayShift`). Set by `makeDay`.
   */
  readonly shifts = new Map<string, string>()
  private shiftParts(date: string): string[] {
    const s = this.shifts.get(date)
    return s ? [s] : []
  }
  /** The id of a row of the day's own work of `date` (its shift's, when it has one). */
  dayId(date: string, ...parts: string[]): string {
    return demoId(this.tenantId, date, ...this.shiftParts(date), ...parts)
  }
  /** Its idempotency key. */
  dayKey(date: string, ...parts: string[]): string {
    return demoKey(date, ...this.shiftParts(date), ...parts)
  }
  /** The seed of the day's choices (which shops, which items): the date, and its shift when it has one. */
  daySeed(date: string): string {
    return [date, ...this.shiftParts(date)].join(':')
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

  /**
   * A write on AUTH-SERVICE with the session's own token (a shopkeeper's request to be joined to a shop): counted
   * like `write`, a refusal answered as null.
   */
  async writeAuth<P extends ProcLike>(
    section: Section,
    what: string,
    session: Session,
    proc: P,
    input: InputOf<P>,
  ): Promise<OutputOf<P> | null> {
    if (!this.commit) {
      this.summary.wouldOne(section, what)
      return null
    }
    try {
      const out = await this.api.authCall(session, proc, input)
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

  /**
   * A write of a receipt, whose payment reference must be the tool's own (DOS-310). `input(attempt)` builds the
   * request with the reference of that try (`paymentReference`). The product refuses a reference that is taken —
   * a UPI or transfer reference already on a live receipt of the distributor, a cheque number already on one of
   * the same shop — and asks before it takes a cheque number another shop's receipt carries; the tool never
   * confirms that question and never repeats a reference: it asks again with its next one, up to five tries. The
   * refused try wrote nothing (its transaction, idempotency key included, rolled back). Any other refusal is
   * counted as `write` counts it.
   */
  async writeReceipt<P extends ProcLike>(
    section: Section,
    what: string,
    session: Session | (() => Promise<Session | null>),
    proc: P,
    input: (attempt: number) => NoInfer<InputOf<P>>,
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
    const tries = 5
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        const out = await this.api.call(s, proc, input(attempt))
        this.summary.madeOne(section, what)
        return out
      } catch (e) {
        if (!(e instanceof ApiRefusal)) throw e
        if (REFERENCE_TAKEN.has(e.reason) && attempt < tries - 1) {
          this.referencesTaken++
          this.log(`  ${section}/${what}: reference taken (${e.reason}), the next one is asked`)
          continue
        }
        this.summary.refusedOne(section, what, e.label)
        this.log(`  refused: ${section}/${what} ${e.label}`)
        return null
      }
    }
    return null
  }

  /** How many of this run's payment references the product named as taken (each answered with the next one). */
  referencesTaken = 0

  key(date: string, ...parts: string[]): string {
    return demoKey(date, ...parts)
  }
  /** The id of a row of this distributor (see `demoIdFromKey`). */
  id(date: string, ...parts: string[]): string {
    return demoId(this.tenantId, date, ...parts)
  }

  /**
   * The session of a tester, signed in on first use with the DEMO password. When that no longer works (someone
   * changed the password, or it was reset and not changed yet) the owner sets a temporary one and the tester
   * changes it back to the demo password — the run heals the login instead of failing on it, and no tester is left
   * with a forced change of password.
   */
  async as(key: TesterKey): Promise<Session | null> {
    const have = this.sessions.get(key)
    if (have) return have
    if (!this.commit) return null
    const username = this.usernames.get(key)
    if (!username) return null
    try {
      const s = await this.api.signIn(username, DEMO_PASSWORD, this.opts.tenant)
      if (!s.mustChangePassword) {
        this.sessions.set(key, s)
        return s
      }
      await this.api.signOut(s)
    } catch (e) {
      if (!(e instanceof ApiRefusal) || e.status !== 401) {
        this.summary.refusedOne(
          'people',
          `sign-in ${username}`,
          e instanceof ApiRefusal ? e.label : 'error',
        )
        return null
      }
    }
    return this.resetPassword(key)
  }

  /** The owner sets a temporary password; the tester signs in with it and changes it to the demo password. */
  async resetPassword(key: TesterKey): Promise<Session | null> {
    const userId = this.userIds.get(key)
    const username = this.usernames.get(key)
    if (!userId || !username) return null
    const temporary = newPassword()
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
          username,
          'reset',
          this.id(date, 'reset', temporary),
        ),
        userId,
        temporaryPassword: temporary,
      },
    )
    if (!reset) return null
    return this.finishPassword(key, temporary)
  }

  /**
   * Sign in with the temporary password and change it to the demo password, the way the person would at first
   * sign-in: the login then signs in with the demo password and is not asked to change it.
   */
  async finishPassword(key: TesterKey, temporary: string): Promise<Session | null> {
    const username = this.usernames.get(key)
    if (!username) return null
    try {
      const s = await this.api.signIn(username, temporary, this.opts.tenant)
      await this.api.authCall(s, authContract.changePassword, {
        currentPassword: temporary,
        newPassword: DEMO_PASSWORD,
      })
      await this.api.signOut(s)
      const again = await this.api.signIn(username, DEMO_PASSWORD, this.opts.tenant)
      this.sessions.set(key, again)
      this.summary.madeOne('people', 'password set')
      return again
    } catch (e) {
      this.summary.refusedOne(
        'people',
        `password ${username}`,
        e instanceof ApiRefusal ? e.label : 'error',
      )
      return null
    }
  }

  /**
   * The logins file (D4): one line per tester of the crew — username, the demo password, role — mode 600, so a
   * person opens it to see who exists. A tester is listed when it signed in with the demo password in this run, or
   * the file already listed it with the demo password; nobody else is (the former testers, the owner, the
   * distributor's own staff). The file is written only on a run that commits, and only when its text changes.
   */
  saveLogins(): void {
    if (!this.commit || this.usernames.size === 0) return
    const before = readLogins(this.opts.loginsFile)
    const lines: LoginLine[] = []
    for (const key of TESTER_KEYS) {
      const username = this.usernames.get(key)
      if (!username) continue
      if (!this.sessions.has(key) && before.get(username)?.password !== DEMO_PASSWORD) continue
      lines.push({ username, password: DEMO_PASSWORD, role: testerOf(key).role })
    }
    // The shopkeepers that signed in with the demo password in this run (their own accounts, joined to the shops).
    for (const key of SHOP_USERNAMES) {
      const s = this.shopSessions.get(key)
      if (s && s.account !== true)
        lines.push({ username: s.username, password: DEMO_PASSWORD, role: 'retailer' })
    }
    writeLogins(this.opts.loginsFile, this.opts.tenant, lines)
  }

  /** Sessions of former tester logins (D6), by user id: null when that person could not be signed in. */
  private readonly formerSessions = new Map<string, Session | null>()

  /**
   * The session of a FORMER tester login (D6), to finish work the product cannot hand to another person (a trip's
   * driver is fixed when it is planned) as that person, before the login is switched off. Tried in turn: the
   * password the logins file of the tool before 2026-09-29 holds for it (read, never printed, never written again),
   * the demo password, and last the product's own door — the owner sets a temporary password and the person changes
   * it to a fresh one the tool keeps in memory for this run only (the login is switched off at the end of it).
   * Null when none works: the step is then done by the desk and the report says so.
   */
  async asFormer(userId: string): Promise<Session | null> {
    if (this.formerSessions.has(userId)) return this.formerSessions.get(userId) ?? null
    if (!this.commit) return null
    const member = this.former.find((f) => f.member.userId === userId)?.member
    const username = member?.username
    let s: Session | null = null
    if (username && member.status !== 'disabled') {
      const file = readLogins(this.opts.loginsFile).get(username)?.password
      for (const password of [file, DEMO_PASSWORD]) {
        if (!password || s) continue
        try {
          const got = await this.api.signIn(username, password, this.opts.tenant)
          if (got.mustChangePassword) await this.api.signOut(got)
          else s = got
        } catch (e) {
          if (!(e instanceof ApiRefusal) || e.status !== 401) break
        }
      }
      if (!s) s = await this.resetFormer(userId, username)
    }
    this.formerSessions.set(userId, s)
    return s
  }

  private async resetFormer(userId: string, username: string): Promise<Session | null> {
    const temporary = newPassword()
    const date = this.opts.date
    const reset = await this.write(
      'people',
      'former login password reset',
      this.owner,
      contract.tenancy.staff.setPassword,
      {
        idempotencyKey: demoKey(date, 'person', userId, 'reset', this.id(date, 'reset', temporary)),
        userId,
        temporaryPassword: temporary,
      },
    )
    if (!reset) return null
    try {
      const first = await this.api.signIn(username, temporary, this.opts.tenant)
      const fresh = newPassword()
      await this.api.authCall(first, authContract.changePassword, {
        currentPassword: temporary,
        newPassword: fresh,
      })
      await this.api.signOut(first)
      return await this.api.signIn(username, fresh, this.opts.tenant)
    } catch (e) {
      this.summary.refusedOne(
        'people',
        `sign-in ${username}`,
        e instanceof ApiRefusal ? e.label : 'error',
      )
      return null
    }
  }

  /** Sign every session this run opened out again. */
  async signOutAll(): Promise<void> {
    for (const s of this.sessions.values()) await this.api.signOut(s)
    for (const s of this.shopSessions.values()) await this.api.signOut(s)
    for (const s of this.formerSessions.values()) if (s) await this.api.signOut(s)
    if (this.owner) await this.api.signOut(this.owner)
  }
}
