/**
 * DOS-167 — the words of the sheet a godown hand sees when signing out, or switching distributor, while
 * this phone still holds picks or counts the office has not got.
 *
 * The rule is the founder's (2026-09-13, answer A): they stay on this phone for that person only and go
 * the next time that person signs in here; nobody else can see them. So the sheet names the count and the
 * person — or, for a switch, the distributor they wait for — and never offers to throw anything away
 * (that stays in the Needs-attention tray). When the sheet is shown at all is `leaveDecision` in
 * `@dos/offline/react`; this is only what it says, and every word of it is in `src/strings.ts`.
 *
 * And the ORDER of leaving (`tapLeave`, `sendNowThenLeave`, `leaveNow`), which `Chrome` in
 * `app/_layout.tsx` runs with the device and the session handed in as `LeaveSteps`.
 *
 * No hooks, no kit, no device of its own — which is what lets `leave.test.ts` run all of it in Node.
 */
import { leaveDecision } from '@dos/offline/react'

import { strings } from '../strings'

export type LeaveMode = 'signOut' | 'switch'

export interface LeaveSentenceInput {
  mode: LeaveMode
  /** Queued and sending, as the strip counts them. */
  pending: number
  /** Refused by the office and waiting in the tray. */
  rejected: number
  /** The person signing out, as the session names them. */
  name: string
  /** The distributor these changes belong to: the one being left. */
  tenantName: string
  /**
   * False when the device store is in memory (DOS-167 ruling 2 (t)): nothing waiting survives leaving, so the body
   * never says it stays. Absent means a store that keeps.
   */
  persistent?: boolean
}

export interface LeaveSentence {
  title: string
  /** The refused count, under a title that already names the queued one; null otherwise. */
  attention: string | null
  body: string
}

type LeaveKey = Extract<keyof typeof strings, `leave.${string}`>

/** `{n}`, `{name}`: filled the way the kit's translator fills a placeholder, unknown ones left visible. */
function say(key: LeaveKey, params: Readonly<Record<string, string | number>>): string {
  return strings[key].replace(/\{(\w+)\}/g, (whole, param: string) => {
    const value = params[param]
    return value === undefined ? whole : String(value)
  })
}

/** A count of exactly 1 takes its `.one` sentence: "1 change has", never "1 changes have". */
function counted(n: number, many: LeaveKey, one: LeaveKey): string {
  return n === 1 ? say(one, {}) : say(many, { n })
}

/**
 * Which body, by what waits: queued changes go the next time; refused ones wait in Needs attention and never
 * go by themselves, so a sheet holding refusals never promises that they will.
 */
function bodyKey(mode: LeaveMode, queued: boolean, refused: boolean): LeaveKey {
  if (mode === 'signOut') {
    if (!refused) return 'leave.bodySignOut'
    return queued ? 'leave.bodySignOutBoth' : 'leave.bodySignOutRefused'
  }
  if (!refused) return 'leave.bodySwitch'
  return queued ? 'leave.bodySwitchBoth' : 'leave.bodySwitchRefused'
}

export function leaveSentence(input: LeaveSentenceInput): LeaveSentence {
  const queued = input.pending > 0
  const refused = input.rejected > 0
  const attention = counted(input.rejected, 'leave.attention', 'leave.attention.one')
  return {
    title: queued ? counted(input.pending, 'leave.title', 'leave.title.one') : attention,
    attention: queued && refused ? attention : null,
    body:
      input.persistent === false
        ? say('leave.bodyMemory', {})
        : say(bodyKey(input.mode, queued, refused), {
            name: input.name,
            tenantName: input.tenantName,
          }),
  }
}

/** A button the leave sheet may offer. */
export type LeaveButton = 'sendNow' | 'keep' | 'cancel'

/**
 * What the sheet offers, in order (DOS-167; ruling 2 (t)). "Send now" only with a signal. "Sign out, keep here" — or
 * "Switch anyway" — only on a store that keeps: a store in memory goes with the tab, so a keep there would be a
 * promise nothing keeps, and the leaving WAITS — sent now, or the person stays signed in until there is a signal;
 * refused ones are fixed or discarded in Needs attention. Throwing a change away is never offered here.
 */
export function leaveButtons(input: {
  mode: LeaveMode
  online: boolean
  persistent: boolean
}): LeaveButton[] {
  const buttons: LeaveButton[] = []
  if (input.online) buttons.push('sendNow')
  if (input.persistent) buttons.push('keep')
  buttons.push('cancel')
  return buttons
}

/** How the person asked to leave: signing out, or switching to another distributor. */
export type Leaving =
  { readonly mode: 'signOut' } | { readonly mode: 'switch'; readonly tenantId: string }

export interface WaitingCounts {
  pending: number
  rejected: number
}

/** What leaving needs of the device and the session (`useLeaveSession`, `useSession`), handed in. */
export interface LeaveSteps {
  /**
   * What waits in this hand's file, counted once the engine has opened it — never the status snapshot,
   * which reads 0 until the open has counted the outbox.
   */
  waiting: () => Promise<WaitingCounts>
  /** Upload what is queued; what still waits afterwards. */
  sendNow: () => Promise<WaitingCounts>
  /**
   * What it kept (`EndResult`): the file survives when asked to, and also when the engine's own count found something
   * waiting once the last write had landed (ruling 2 (u)). The order of leaving is the same either way.
   */
  end: (options: {
    keepQueue: boolean
    /** The session's removal from the platform store: the engine touches the file only once it has landed. */
    after?: Promise<unknown>
  }) => Promise<{ kept: boolean } | void>
  /** This hand's files at their other distributors: deleted where nothing waits in them. */
  sweep: () => Promise<unknown>
  /**
   * Sign out on this phone, then leave it (addendum (y); `useSession().signOutOnDevice`): the stored session is cleared
   * at once and `leave` runs in the same turn, handed `stored`, the session's removal from the platform store. The
   * server's revoke follows `leave`, and a sign-in on this phone waits for it.
   */
  signOutOnDevice: (leave: (stored: Promise<void>) => Promise<void>) => Promise<void>
  switchDistributor: (tenantId: string) => Promise<unknown>
}

/**
 * The tap on "Sign out", or on another distributor (DOS-167; founder, 2026-09-13). 'ask' opens the sheet;
 * 'left' means the leaving is done.
 *
 * Decided on `waiting()`, which waits for the engine to open the file. A sign-out tapped on a cold start,
 * before the open had counted the outbox, used to read 0 from the snapshot, take the one-tap path and
 * delete a pick this hand had kept on the phone — with no sheet. A file that cannot be counted at all is
 * never deleted: the hand is signed out keeping whatever it holds.
 */
export async function tapLeave(to: Leaving, steps: LeaveSteps): Promise<'ask' | 'left'> {
  let counts: WaitingCounts
  try {
    counts = await steps.waiting()
  } catch {
    await leaveNow(to, true, steps)
    return 'left'
  }
  if (leaveDecision(counts) === 'ask') return 'ask'
  await leaveNow(to, false, steps)
  return 'left'
}

/** The sheet's "Send now": when nothing waits any more the leaving carries on by itself; else the sheet stays. */
export async function sendNowThenLeave(to: Leaving, steps: LeaveSteps): Promise<'ask' | 'left'> {
  let after: WaitingCounts
  try {
    after = await steps.sendNow()
  } catch {
    return 'ask'
  }
  if (leaveDecision(after) === 'ask') return 'ask'
  await leaveNow(to, false, steps)
  return 'left'
}

/**
 * The leaving itself, once there is nothing left to ask. A switch wipes nothing: the provider stops the
 * engine on this distributor's file, queue kept, and starts it on the other one. A sign-out clears the
 * session on this phone FIRST and only then ends the engine (addendum (y)): a crash inside `end()` relaunches
 * to the sign-in form, and "Send now" has already sent with the live session before this runs. `keepQueue: false`
 * deletes this hand's file unless the engine's own count found something waiting, which keeps it. Then their other
 * files are swept, on EVERY sign-out — the sweep deletes only files with nothing unsent (ruling 2 (u)). All of it runs
 * inside `signOutOnDevice`: a sign-in on this phone waits until it is over, and the server's revoke follows it, in the
 * background.
 */
export async function leaveNow(to: Leaving, keepQueue: boolean, steps: LeaveSteps): Promise<void> {
  if (to.mode === 'switch') {
    await steps.switchDistributor(to.tenantId)
    return
  }
  /*
   * SIGNED OUT ON THIS PHONE FIRST (addendum (y)). On iOS the app died inside `end()` and came back signed in as the
   * person who had chosen to sign out. The stored session goes now, and `end` is called in the same turn — nothing is
   * awaited between them — so the engine refuses reads and writes before the cleared session re-renders the app; it
   * touches the file only once the session is out of the platform store (`stored`, a Keychain delete on a phone).
   */
  await steps.signOutOnDevice(async (stored) => {
    try {
      await steps.end({ keepQueue, after: stored })
    } catch {
      // Signed out regardless: the next person opens a different file whatever happened to this one.
    }
    try {
      await steps.sweep()
    } catch {
      // Best effort, file by file: a file left behind is still under this hand's own name.
    }
  })
}
