/**
 * THE SHOP CODE (founder, 2026-09-29, docs/22 §8 "The shopkeeper is independent"): what a shopkeeper who signed up
 * alone types to ask to be joined to a distributor's shop. It is printed on the distributor's bill beside the shop's
 * name as "Shop code", and read out over the phone, so it is eight characters from an alphabet without the ones a
 * person mixes up (0/O, 1/I/L), written `XXXX-XXXX`. The DATABASE makes it (`dos_new_shop_code()`, migration 0085),
 * unique across the platform, so the code alone finds the distributor as well as the shop. Nothing here makes one:
 * this file only says what one looks like and reads what a person typed.
 */

/** The characters a shop code is made of, in the order `dos_new_shop_code()` draws them. */
export const SHOP_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

const SHAPE = /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/

/** True for a code in its written form, `K7MQ-4P2X`. */
export function isShopCode(value: string): boolean {
  return SHAPE.test(value)
}

/**
 * What a person typed, as the written code, or null when it cannot be one. Case, spaces, dots and dashes are
 * forgiven (`k7mq 4p2x`, `K7MQ4P2X`, `k7mq-4p2x`); a character outside the alphabet is not guessed at — a zero is
 * not read as an O, because neither is in a code, and a guess would send the request to somebody else's shop.
 */
export function normalizeShopCode(typed: string): string | null {
  const bare = typed.toUpperCase().replace(/[\s.\-_]/g, '')
  if (bare.length !== 8) return null
  const written = `${bare.slice(0, 4)}-${bare.slice(4)}`
  return isShopCode(written) ? written : null
}
