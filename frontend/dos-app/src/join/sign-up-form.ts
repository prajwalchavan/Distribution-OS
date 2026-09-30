/**
 * THE SIGN-UP FORM'S OWN CHECKS (blind check of the shopkeeper's sign-up, M1) — the pure half of `app/sign-up.tsx`.
 *
 * Every rule the server holds is checked here first and answered on the field, in words a shopkeeper can act on: the
 * form used to check only a username's LENGTH, so "ravi kumar" or "ravi-kumar" went to the server and came back as
 * "Input validation failed". The username rule is the one every login shares (`UsernameSchema`): 3–32 characters,
 * lowercase letters, digits, dots and underscores, starting with a letter or a digit; capitals and spaces around it are
 * forgiven the way sign-in forgives them (the server lowers and trims too). The password rule is `PasswordSchema`'s.
 *
 * Returns string KEYS, not words: the screen looks each one up (`src/strings.ts`, `su.*` and `app.*`).
 */
import { toMobile } from '../shops/sign-in-forms'

export interface SignUpFields {
  phone: string
  name: string
  shopName: string
  username: string
  password: string
  again: string
}

export type SignUpProblems = Partial<Record<keyof SignUpFields, string>>

/** The username as it is sent: trimmed and lowered, as the server stores and compares it. */
export function normalUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

/** `UsernameSchema`'s rule, value for value (libs/contracts/src/common.ts). */
const USERNAME_SHAPE = /^[a-z0-9][a-z0-9._]*$/

/** The string key of what is wrong with a username, or null when the server will take it. */
export function usernameProblem(raw: string): string | null {
  const username = normalUsername(raw)
  if (username.length < 3) return 'su.usernameNeeded'
  if (username.length > 32) return 'su.usernameLong'
  if (/\s/.test(username)) return 'su.usernameSpace'
  if (!USERNAME_SHAPE.test(username)) return 'su.usernameChars'
  return null
}

/** `PasswordSchema`'s rule: 8–72 characters, a letter and a digit. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8 || password.length > 72) return 'app.passwordRule'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'app.passwordRule'
  return null
}

/** Everything wrong with the form, field by field; empty when it may be sent. */
export function signUpProblems(fields: SignUpFields): SignUpProblems {
  const found: SignUpProblems = {}
  if (toMobile(fields.phone) === null) found.phone = 'su.mobileBad'
  if (fields.name.trim().length < 2) found.name = 'su.nameNeeded'
  if (fields.shopName.trim().length < 2) found.shopName = 'su.shopNeeded'
  const username = usernameProblem(fields.username)
  if (username !== null) found.username = username
  const password = passwordProblem(fields.password)
  if (password !== null) found.password = password
  if (fields.again !== fields.password) found.again = 'app.passwordMismatch'
  return found
}
