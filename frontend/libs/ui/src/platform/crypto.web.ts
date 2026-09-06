/**
 * A browser already has `crypto.getRandomValues`, so this half installs nothing. It exists because
 * its native sibling has to, and because the parity rule is what keeps the two honest.
 */
import type { CryptoInstall } from './types.js'

export const installCrypto: CryptoInstall = () =>
  typeof globalThis.crypto?.getRandomValues === 'function'
