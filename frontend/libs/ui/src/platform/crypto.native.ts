/**
 * Hermes has no `crypto.getRandomValues`, and `@dos/domain`'s `uuidv7()` needs a CSPRNG: every row
 * this product creates carries a client-generated UUIDv7 primary key, so on a phone the FIRST id the
 * app asks for would throw. `expo-crypto` has the platform's own generator; this puts it where the
 * pure-TypeScript domain package expects to find it.
 *
 * It runs as a side effect of importing `@dos/ui/platform`, before any screen can ask for an id.
 * `@dos/domain` stays dependency-free (it must: it bundles into Expo unchanged), and nothing in the
 * kit or the apps has to remember a polyfill import at the top of a file.
 */
import * as Crypto from 'expo-crypto'

import type { CryptoInstall } from './types.js'

export const installCrypto: CryptoInstall = () => {
  const scope = globalThis as {
    crypto?: { getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T }
  }
  if (typeof scope.crypto?.getRandomValues === 'function') return true
  const generator = <T extends ArrayBufferView | null>(array: T): T =>
    array === null
      ? array
      : (Crypto.getRandomValues(array as unknown as Uint8Array) as unknown as T)
  if (scope.crypto) {
    scope.crypto.getRandomValues = generator
  } else {
    scope.crypto = { getRandomValues: generator }
  }
  return true
}
