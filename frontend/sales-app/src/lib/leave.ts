/**
 * DOS-167 — the words of the sheet a rep sees when signing out, or switching distributor, while this
 * phone still holds changes the office has not got.
 *
 * The rule is the founder's (2026-09-13, answer A): they stay on this phone for that person only and go
 * the next time that person signs in here; nobody else can see them. So the sheet names the count and the
 * person — or, for a switch, the distributor they wait for — and never offers to throw anything away
 * (that stays in the Needs-attention tray). When the sheet is shown at all is `leaveDecision` in
 * `@dos/offline/react`; this is only what it says, and every word of it is in `src/strings.ts`.
 *
 * Pure: no React, no kit, no device — which is what lets `leave.test.ts` run it in Node.
 */
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

export function leaveSentence(input: LeaveSentenceInput): LeaveSentence {
  const refused = input.rejected > 0 ? say('leave.attention', { n: input.rejected }) : null
  const queued = input.pending > 0 ? say('leave.title', { n: input.pending }) : null
  return {
    title: queued ?? refused ?? say('leave.title', { n: 0 }),
    attention: queued === null ? null : refused,
    body:
      input.mode === 'signOut'
        ? say('leave.bodySignOut', { name: input.name })
        : say('leave.bodySwitch', { tenantName: input.tenantName }),
  }
}
