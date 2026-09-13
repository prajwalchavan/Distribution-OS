/**
 * O24 Settings › Support access (DOS-108), as pure rules of one grant and the clock.
 *
 * STUB (DOS-108, red first): these bodies encode the screen as it stands — Approve and Revoke only, a
 * fixed four-hour approval counted from the moment the owner presses, no lapsed ask — so the specs fail
 * on their assertions rather than on a missing module. The real bodies replace them in the fix.
 */
import type { SupportGrant } from '@dos/contracts'

/** The four views of owner Settings. */
export type SettingsView = 'business' | 'numbering' | 'flags' | 'support'

export const SETTINGS_VIEWS: readonly { id: SettingsView; labelKey: string }[] = [
  { id: 'business', labelKey: 'o24.business' },
  { id: 'numbering', labelKey: 'o24.numbering' },
  { id: 'flags', labelKey: 'o24.flags' },
  { id: 'support', labelKey: 'o24.support' },
]

/** The fields of a grant these rules read. */
export type SupportGrantClock = Pick<
  SupportGrant,
  'status' | 'active' | 'requestedAt' | 'requestedHours' | 'expiresAt'
>

export type SupportAction = 'approve' | 'refuse' | 'revoke'

/** A request the owner has not answered yet, and can still open. */
export interface WaitingDecision {
  kind: 'waiting'
  actions: readonly SupportAction[]
  hours: readonly number[]
  initialHours: number
}

/** A window open right now. */
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

/** Today's screen: the window counted from the moment the owner presses. */
export function windowClosesAt(_requestedAt: string, hours: number): string {
  return new Date(Date.now() + hours * HOUR_MS).toISOString()
}

/** Today's screen: Approve on any request, Revoke on any active grant, no lapsed check. */
export function supportDecision(grant: SupportGrantClock, _now: number): SupportDecision {
  if (grant.status === 'requested')
    return { kind: 'waiting', actions: ['approve'], hours: [4], initialHours: 4 }
  if (grant.active) return { kind: 'open', actions: ['revoke'], closesAt: grant.expiresAt ?? '' }
  return { kind: 'closed', actions: [] }
}

/** Today's screen: always four hours. */
export function chosenHours(_decision: WaitingDecision, _picked: number | undefined): number {
  return 4
}
