/**
 * DOS-400 — the pure half of a shop's app sign-in: the mobile number a desk types, the first password
 * the desk's own device makes, and the three payloads, each the shape the contract accepts.
 *
 * WHERE THE FIRST PASSWORD COMES FROM. This device makes it (`firstPassword`), sends it once in the
 * request, and shows it once on the screen that made it. The server keeps only its hash and never
 * answers with a password, so nothing can read it back later: not a replay, not a reload, not the
 * desk's other device. Lose the screen before copying it and the desk gives a new first password.
 */
import type { GiveShopSignInIn, ShopSignInPasswordIn, ShopSignInStopIn } from '@dos/contracts'
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
