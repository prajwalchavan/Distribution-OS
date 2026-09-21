/**
 * O24 Settings › Support access (DOS-108), as pure rules of one grant and the clock.
 *
 * Owner-service is the guarantee (`backend/libs/core/src/modules/tenancy/support.service.ts`): an
 * approval may only SHORTEN what was asked (400 `window_too_long`), the window is counted from the
 * REQUEST and not from the approval, an approval whose window has already closed is refused (409
 * `request_expired`), and a refusal is `revoke` on a request never approved. These rules keep the owner
 * app from OFFERING a press the service can only refuse.
 *
 * Nothing here renders — no React, no `@dos/ui` — so the specs run in Node against a fixed `now`; the
 * screen reads `Date.now()` once per render and passes it in.
 */
import type { SupportGrant } from '@dos/contracts'

/** The four views of owner Settings. Four, so a chip row: `<Segments>` draws two or three. */
export type SettingsView = 'business' | 'numbering' | 'flags' | 'support'

export const SETTINGS_VIEWS: readonly { id: SettingsView; labelKey: string }[] = [
  { id: 'business', labelKey: 'o24.business' },
  { id: 'numbering', labelKey: 'o24.numbering' },
  { id: 'flags', labelKey: 'o24.flags' },
  { id: 'support', labelKey: 'o24.support' },
]

/**
 * The hours an owner may approve for, each capped at the hours asked. The contract allows 1–72; the
 * console asks from 1, 2, 4, 8, 24 and 72 (`frontend/admin-app/src/lib/support.tsx`).
 */
export const APPROVAL_HOURS = [1, 2, 4, 8, 24, 48, 72] as const

/** The fields of a grant these rules read. */
export type SupportGrantClock = Pick<
  SupportGrant,
  'status' | 'active' | 'requestedAt' | 'requestedHours' | 'expiresAt'
>

export type SupportAction = 'approve' | 'refuse' | 'revoke'

/** A request the owner has not answered, and can still open. */
export interface WaitingDecision {
  kind: 'waiting'
  actions: readonly SupportAction[]
  /** Ascending: every choice at or under the hours asked whose window still closes after `now`. */
  hours: readonly number[]
  /** The hours asked: what an Approve sends when nothing still offered was picked. */
  initialHours: number
}

/** A window open right now, and when it closes. */
export interface OpenDecision {
  kind: 'open'
  actions: readonly SupportAction[]
  closesAt: string
}

/** Nothing left for the owner to decide. */
export interface ClosedDecision {
  kind: 'closed'
  actions: readonly SupportAction[]
}

export type SupportDecision = WaitingDecision | OpenDecision | ClosedDecision

const HOUR_MS = 3_600_000

/** When a window approved for `hours` closes: counted from the ASK, exactly as owner-service counts it. */
export function windowClosesAt(requestedAt: string, hours: number): string {
  return new Date(Date.parse(requestedAt) + hours * HOUR_MS).toISOString()
}

/**
 * What the owner may do with one grant at `now`.
 *
 * - `open`: an approved window whose end is still ahead. `active` alone is not enough: a page left open
 *   past `expiresAt` still holds `active: true` from its last read, and there is nothing left to revoke.
 * - `waiting`: a request the server still calls `requested` AND which has at least one hour the owner
 *   could still approve it for.
 * - `closed`, by DEFAULT: refused, revoked, expired, `lapsed`, and any status this build does not know
 *   yet.
 *
 * NO LAPSE CLOCK OF ITS OWN (DOS-110). This file used to carry `askLapsed()` — a copy of the console's
 * copy of a rule owner-service already enforced — because an ask whose hours had run out still read
 * `requested` on the wire. The server derives `lapsed` itself now, once, for both services. The
 * stale-page case that clock also covered (a page left open until the ask's own hours pass) needs no
 * second rule: every offerable hour is measured from the ask, so such a request has none left to offer,
 * and a request with nothing to offer is closed.
 */
export function supportDecision(grant: SupportGrantClock, now: number): SupportDecision {
  if (grant.active && grant.expiresAt !== null && Date.parse(grant.expiresAt) > now)
    return { kind: 'open', actions: ['revoke'], closesAt: grant.expiresAt }
  if (grant.status === 'requested') {
    const asked = Date.parse(grant.requestedAt)
    const hours = [...new Set<number>([...APPROVAL_HOURS, grant.requestedHours])]
      .filter((choice) => choice <= grant.requestedHours && asked + choice * HOUR_MS > now)
      .sort((a, b) => a - b)
    if (hours.length > 0) {
      return {
        kind: 'waiting',
        actions: ['approve', 'refuse'],
        hours,
        initialHours: grant.requestedHours,
      }
    }
  }
  return { kind: 'closed', actions: [] }
}

/**
 * The hours an Approve on this request sends: the owner's pick while it is still offered, otherwise the
 * hours asked. A pick whose window closed while the page stayed open is never sent.
 */
export function chosenHours(decision: WaitingDecision, picked: number | undefined): number {
  return picked !== undefined && decision.hours.includes(picked) ? picked : decision.initialHours
}
