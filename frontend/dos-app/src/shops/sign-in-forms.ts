/**
 * DOS-400 — the pure half of a shop's app sign-in: the mobile number a desk types, the first password
 * the desk's own device makes, and the three payloads, each the shape the contract accepts.
 *
 * WHERE THE FIRST PASSWORD COMES FROM. This device makes it (`firstPassword`), sends it once in the
 * request, and shows it once on the screen that made it. The server keeps only its hash and never
 * answers with a password, so nothing can read it back later: not a replay, not a reload, not the
 * desk's other device. Lose the screen before copying it and the desk gives a new first password.
 */
import {
  SHOP_SIGN_IN_CODES,
  type GiveShopSignInIn,
  type GiveShopSignInOutcome,
  type ShopSignIn,
  type ShopSignInPasswordIn,
  type ShopSignInStopIn,
} from '@dos/contracts'
import { uuidv7 } from '@dos/domain'

/** A 10-digit Indian mobile, however it was typed, as the contract's `+91XXXXXXXXXX`; null when it is not one. */
export function toMobile(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '')
  const ten =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits.length === 12 && digits.startsWith('91')
          ? digits.slice(2)
          : null
  return ten !== null && /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null
}

/** Does the shop's number of record serve as its sign-in number? A blank or a landline does not. */
export function hasMobile(phone: string | null | undefined): boolean {
  return typeof phone === 'string' && /^\+91[6-9]\d{9}$/.test(phone.trim())
}

/** Letters a shopkeeper cannot misread for a digit or for each other on a phone screen. */
const LETTERS = 'abcdefghjkmnpqrstuvwxyz'
const DIGITS = '23456789'

/**
 * A first password a shopkeeper can type on a phone keyboard without switching case: five letters
 * and four digits, e.g. `kpmtr4827`, from the platform's secure random source. It satisfies the
 * password rules every login shares (8–72 characters, a letter and a digit).
 */
export function firstPassword(random: (n: number) => Uint8Array = secureRandom): string {
  const bytes = random(9)
  let out = ''
  for (let i = 0; i < 9; i += 1) {
    const byte = bytes[i] ?? 0
    out += i < 5 ? (LETTERS[byte % LETTERS.length] ?? 'a') : (DIGITS[byte % DIGITS.length] ?? '2')
  }
  return out
}

function secureRandom(n: number): Uint8Array {
  const bytes = new Uint8Array(n)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/** One intent to give a sign-in: its ids and its password are made once, so a retry is the same request. */
export interface GiveIntent {
  userId: string
  membershipId: string
  password: string
  /** The mobile the desk typed, when the shop had none. */
  phone: string | null
}

export function newGiveIntent(phone: string | null): GiveIntent {
  return { userId: uuidv7(), membershipId: uuidv7(), password: firstPassword(), phone }
}

export function givePayload(
  shopId: string,
  intent: GiveIntent,
  idempotencyKey: string,
): GiveShopSignInIn {
  return {
    idempotencyKey,
    id: shopId,
    userId: intent.userId,
    membershipId: intent.membershipId,
    firstPassword: intent.password,
    ...(intent.phone === null ? {} : { phone: intent.phone }),
  }
}

export function passwordPayload(
  shopId: string,
  password: string,
  idempotencyKey: string,
): ShopSignInPasswordIn {
  return { idempotencyKey, id: shopId, firstPassword: password }
}

export function stopPayload(shopId: string, idempotencyKey: string): ShopSignInStopIn {
  return { idempotencyKey, id: shopId }
}

/**
 * THE SHOPS REGISTER's "App sign-in" cell (the second check's minor: a phone showed no sign-in state).
 * At desk width it sits under its own head, so the username or "Not yet" is enough. Below it the
 * register is one row per shop with no heads, so the same cell says what it is: "App: ramesh.gupta",
 * "No app sign-in yet". `cards` is true exactly where `<Register>` draws rows instead of a table.
 */
export function appSignInCell(
  t: (key: 'si.rowAs' | 'si.rowNone' | 'si.noneShort', params?: { username: string }) => string,
  signIn: ShopSignIn | null | undefined,
  cards: boolean,
): string {
  const username = signIn?.username ?? null
  if (username === null) return cards ? t('si.rowNone') : t('si.noneShort')
  return cards ? t('si.rowAs', { username }) : username
}

/**
 * The give was refused because the number's sign-in was made at ANOTHER business (architect's ruling
 * of 2026-09-29, docs/22 §8, R1): the service says so in `data.code`, the same for a shopkeeper, a
 * member of staff or a console account elsewhere, and the screen asks for another number.
 */
export function isSharedNumber(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const data = (error as { data?: unknown }).data
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { code?: unknown }).code === SHOP_SIGN_IN_CODES.numberHasSignIn
  )
}

/**
 * The give dialog after the service refused the number because its sign-in was made at ANOTHER business
 * (R1): the mobile field is shown, with what the desk can do — enter another mobile of the shopkeeper,
 * which the give then saves on the shop (QA DOS-428: the desk's shop page has no other place for it).
 * A number the desk typed stays in the field, so it sees what was refused; the shop's own number is
 * named in the sentence (`{phone}`) and the field starts empty.
 */
export function afterSharedNumber(
  typedANumber: boolean,
  typed: string,
): { mobile: string; problem: 'si.sharedTyped' | 'si.shared' } {
  return typedANumber
    ? { mobile: typed, problem: 'si.sharedTyped' }
    : { mobile: '', problem: 'si.shared' }
}

/**
 * What the desk is told when the give made no new login (ruling R4). "The shopkeeper uses their own
 * password" only where it is true: a login of this business whose password the person has chosen.
 */
export type ToldWords = 'si.already' | 'si.existingOwn' | 'si.existingFirst'
export function toldWords(outcome: GiveShopSignInOutcome, passwordChosen: boolean): ToldWords {
  if (outcome === 'already') return 'si.already'
  return passwordChosen ? 'si.existingOwn' : 'si.existingFirst'
}
