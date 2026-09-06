import { useSyncExternalStore } from 'react'
import type { Session, SessionState } from '@dos/api-client'

import { client } from './api.js'

/**
 * Session state for the console. The store itself lives in `@dos/api-client` (the access token in
 * memory for the life of the tab, the refresh token in storage, both shared with every other app),
 * so this file is only the React binding.
 */
export type { Session, SessionState }

/** One UUIDv7 per browser install, stable across sign-outs; also the offline queue's device id. */
export const deviceId: string = client.session.deviceId

export function useSession(): SessionState {
  return useSyncExternalStore(
    client.session.subscribe,
    client.session.getSnapshot,
    client.session.getSnapshot,
  )
}
