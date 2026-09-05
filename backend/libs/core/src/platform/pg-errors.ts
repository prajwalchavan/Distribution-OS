/**
 * Postgres SQLSTATE helpers. Drizzle wraps driver errors, so the code sits on `cause.code` (and on
 * `code` when the driver error surfaces directly). Every module used to carry its own copy of these;
 * they are here so a handler can turn a database refusal into the right HTTP answer in one line.
 */
type PgError = { code?: string; constraint?: string; message?: string; cause?: PgError }

export function pgCode(err: unknown): string | undefined {
  const e = err as PgError | null
  return e?.cause?.code ?? e?.code
}

/** 23505 — a second row under a unique key. */
export function isUniqueViolation(err: unknown): boolean {
  return pgCode(err) === '23505'
}

/** 42501 — a policy or a guard trigger refused the actor (`insufficient_privilege`). */
export function isPrivilegeViolation(err: unknown): boolean {
  return pgCode(err) === '42501'
}

/** 23514 — a check constraint or a guard trigger raised `check_violation`. */
export function isCheckViolation(err: unknown): boolean {
  return pgCode(err) === '23514'
}

/** 23001 — a guard trigger raised `restrict_violation` (an immutable row, a locked series). */
export function isRestrictViolation(err: unknown): boolean {
  return pgCode(err) === '23001'
}

/** The trigger's own sentence, which is usually the best message the caller can get. */
export function pgMessage(err: unknown, fallback = 'the database refused the change'): string {
  const e = err as PgError | null
  return e?.cause?.message ?? e?.message ?? fallback
}
