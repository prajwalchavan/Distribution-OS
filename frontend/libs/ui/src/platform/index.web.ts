/**
 * `@dos/ui/platform` on the web target. Metro resolves this through the `browser` export condition;
 * Vitest and the gallery reach it as the `default`.
 *
 * The names below are the same seven `index.native.ts` exports, against the same interfaces in
 * `types.ts` — `parity.test.ts` fails the build if a capability grows on one side only.
 */
export { camera } from './camera.web.js'
export { installCrypto } from './crypto.web.js'
export { documents } from './documents.web.js'
export { files } from './files.web.js'
export { haptics } from './haptics.web.js'
export { links } from './links.web.js'
export { location } from './location.web.js'
export { share } from './share.web.js'
export { storage } from './storage.web.js'

import { camera } from './camera.web.js'
import { installCrypto } from './crypto.web.js'
import { documents } from './documents.web.js'
import { files } from './files.web.js'
import { haptics } from './haptics.web.js'
import { links } from './links.web.js'
import { location } from './location.web.js'
import { share } from './share.web.js'
import { storage } from './storage.web.js'
import type { Platform, PlatformOs } from './types.js'

/**
 * Side effect, on purpose and exactly once: importing `@dos/ui/platform` is what makes
 * `crypto.getRandomValues` — and therefore every client-generated UUIDv7 — work on a phone.
 */
installCrypto()

/** Which of the three targets this bundle is running on — what `auth.login` records as the device. */
export const os: PlatformOs = 'web'

/** The whole set, for code that wants to pass one object around. */
export const platform: Platform = {
  os,
  kind: 'web',
  storage,
  documents,
  camera,
  location,
  files,
  haptics,
  share,
  links,
}

export type * from './types.js'
