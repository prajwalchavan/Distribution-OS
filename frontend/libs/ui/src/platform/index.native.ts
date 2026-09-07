/**
 * `@dos/ui/platform` on Android and iOS. Metro resolves this through the `react-native` export
 * condition; the web half is `index.web.ts` and exports exactly these names.
 *
 * The names below are the same seven the web half exports, against the same interfaces in
 * `types.ts` — `parity.test.ts` fails the build if a capability grows on one side only.
 */
export { camera } from './camera.native.js'
export { installCrypto } from './crypto.native.js'
export { documents } from './documents.native.js'
export { files } from './files.native.js'
export { haptics } from './haptics.native.js'
export { links } from './links.native.js'
export { location } from './location.native.js'
export { share } from './share.native.js'
export { storage } from './storage.native.js'

import { Platform as RNPlatform } from 'react-native'

import { camera } from './camera.native.js'
import { installCrypto } from './crypto.native.js'
import { documents } from './documents.native.js'
import { files } from './files.native.js'
import { haptics } from './haptics.native.js'
import { links } from './links.native.js'
import { location } from './location.native.js'
import { share } from './share.native.js'
import { storage } from './storage.native.js'
import type { Platform, PlatformOs } from './types.js'

/**
 * Side effect, on purpose and exactly once: importing `@dos/ui/platform` is what makes
 * `crypto.getRandomValues` — and therefore every client-generated UUIDv7 — work on a phone.
 */
installCrypto()

/** Which of the three targets this bundle is running on — what `auth.login` records as the device. */
export const os: PlatformOs = RNPlatform.OS === 'ios' ? 'ios' : 'android'

/** The whole set, for code that wants to pass one object around. */
export const platform: Platform = {
  os,
  kind: 'native',
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
