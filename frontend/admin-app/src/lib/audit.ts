/**
 * DOS-109 — one platform audit row, read by a person: who acted, why, and what changed.
 *
 * `admin.audit.list` answers the row as the writer recorded it, plus two names the service resolves:
 * the staff member (`actorName`; the console cannot read a colleague's login itself) and the
 * distributorship (`tenantName`). These are the pure rules that turn that row into what the Audit trail
 * prints under "Who", "Why" and "Change".
 *
 * The payload belongs to the writer, so it is read defensively. A line needs EVERY field it prints,
 * present with the right type, or it is no line at all (`null`, which a register cell draws as the em
 * dash). A writer that renames a key turns its rows' line into "—": it can never throw, never print
 * "undefined", and the raw payload stays one tap away under "Everything recorded".
 *
 * Only stored words are translated (`word`), money is formatted by the caller (`money`), and nothing here
 * does arithmetic. No React and no kit, so the vitest spec beside this file runs it as it is.
 */
import type { PlatformAuditEntry } from '@dos/contracts'

export type Word = (value: string | null | undefined) => string
export type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string

export interface AuditFormat {
  readonly t: Translate
  readonly word: Word
  /** Integer paise in, the reader's rupees out: `formatMoney` from `@dos/ui` on the screen. */
  readonly money: (paise: number) => string
}

type Payload = Readonly<Record<string, unknown>>

/** Who acted: the name the service resolved, and the role word only when it sent none. */
export function auditWho(
  entry: Pick<PlatformAuditEntry, 'actorName' | 'actorRole'>,
  word: Word,
): string {
  return entry.actorName ?? word(entry.actorRole)
}

/** The reason typed into the dialog, when one was typed. */
export function auditReason(entry: Pick<PlatformAuditEntry, 'after'>): string | null {
  const reason = entry.after?.reason
  return typeof reason === 'string' && reason.trim() !== '' ? reason : null
}

/** One line saying what changed, or null when the row does not carry every field that line needs. */
export function auditChange(
  entry: Pick<PlatformAuditEntry, 'action' | 'after'>,
  fmt: AuditFormat,
): string | null {
  const after = entry.after
  if (after === null) return null
  const { t, word } = fmt
  switch (entry.action) {
    case 'tenant.suspended':
    case 'tenant.reactivated': {
      const from = text(after.from)
      const to = text(after.to)
      return from === null || to === null ? null : `${word(from)} → ${word(to)}`
    }
    case 'subscription.updated': {
      const earlier = record(after.from)
      const was = earlier === null ? null : planSide(earlier, fmt)
      const now = planSide(after, fmt)
      return was === null || now === null ? null : `${was} → ${now}`
    }
    case 'subscription.created':
      return planSide(after, fmt)
    case 'support.requested': {
      const scope = text(after.scope)
      const hours = whole(after.hours)
      return scope === null || hours === null
        ? null
        : `${word(scope)} · ${t('p8.hours', { hours })}`
    }
    case 'support.withdrawn': {
      // Every one of these rows is the console handing a window back. `now: 'rejected'` only means the
      // owner had not answered yet, so the right-hand side is always "Handed back" and never reads as if
      // the owner refused; `now` stays visible in "Everything recorded".
      const was = text(after.was)
      return was === null ? null : `${word(was)} → ${word('revoked')}`
    }
    case 'support.read': {
      const route = text(after.route)
      const outcome = text(after.outcome)
      return route === null || outcome === null ? null : `${route} · ${word(outcome)}`
    }
    case 'user.disabled':
      return text(after.username)
    case 'tenant.onboarded': {
      const plan = text(after.plan)
      const days = whole(after.trialDays)
      return plan === null || days === null
        ? null
        : `${word(plan)} · ${t('p8.trialDays', { days })}`
    }
    default:
      return null
  }
}

/** `Standard · On trial · ₹1,999.00`: one side of a plan change, or null when a field is missing. */
function planSide(side: Payload, fmt: AuditFormat): string | null {
  const plan = text(side.plan)
  const status = text(side.status)
  const paise = whole(side.amountPaise)
  return plan === null || status === null || paise === null
    ? null
    : `${fmt.word(plan)} · ${fmt.word(status)} · ${fmt.money(paise)}`
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function record(value: unknown): Payload | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Payload)
    : null
}
