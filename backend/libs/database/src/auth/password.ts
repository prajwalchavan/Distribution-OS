import argon2 from 'argon2'

/**
 * Password hashing and the credential rules, kept in @dos/db so the seed and the auth module use exactly
 * the same code (a seeded password must verify against the same parameters the service uses).
 *
 * argon2id at OWASP's 2024 minimum for interactive logins: 19 MiB, 2 passes, 1 lane (~50 ms on the
 * pilot hardware). The parameters are encoded in the hash string, so raising them later still verifies
 * old hashes; re-hash on the next successful login when that day comes.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS)
}

/** Never throws: a malformed or foreign hash is simply "not this password". */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain)
  } catch {
    return false
  }
}

export const PASSWORD_RULES = {
  /** argon2 hashes the raw bytes; 72 keeps us portable and stops absurd inputs. */
  minLength: 8,
  maxLength: 72,
  description: '8–72 characters with at least one letter and at least one digit',
} as const

/** Returns null when the password is acceptable, otherwise a human-readable reason. */
export function validatePassword(plain: string): string | null {
  if (plain.length < PASSWORD_RULES.minLength) {
    return `Password must be at least ${String(PASSWORD_RULES.minLength)} characters`
  }
  if (plain.length > PASSWORD_RULES.maxLength) {
    return `Password must be at most ${String(PASSWORD_RULES.maxLength)} characters`
  }
  if (!/[A-Za-z]/.test(plain)) return 'Password must contain at least one letter'
  if (!/[0-9]/.test(plain)) return 'Password must contain at least one digit'
  return null
}

/** 3–32 chars, starts with a letter or digit, then letters, digits, dots or underscores. */
export const USERNAME_REGEX = /^[a-z0-9][a-z0-9._]{2,31}$/

export const USERNAME_RULES = {
  minLength: 3,
  maxLength: 32,
  description: '3–32 characters: lowercase letters, digits, dots and underscores',
} as const

/** Usernames are stored and compared lowercase, so normalise on every boundary (sign-in included). */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Returns null when the (already normalised) username is acceptable, otherwise a reason. */
export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw)
  if (username.length < USERNAME_RULES.minLength || username.length > USERNAME_RULES.maxLength) {
    return `Username must be ${String(USERNAME_RULES.minLength)}–${String(USERNAME_RULES.maxLength)} characters`
  }
  if (!USERNAME_REGEX.test(username)) {
    return 'Username may use only lowercase letters, digits, dots and underscores, and must start with a letter or digit'
  }
  return null
}
