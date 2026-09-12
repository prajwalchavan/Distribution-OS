/**
 * `@dos/api-client` — the typed client for the Distribution OS contract.
 *
 * Types come from `@dos/contracts` (the backend's own package, linked, never copied): a wire shape is
 * never re-declared here. What this package adds is everything a screen should not have to think
 * about — where the tokens live, refreshing them, retrying once, one idempotency key per intent, and
 * turning any failure into a typed `ApiError` with a sentence a distributor can act on.
 *
 *   import { createApiClient } from '@dos/api-client'
 *   import { ApiProvider, useApi, useQuery, useSession } from '@dos/api-client/react'
 */
export {
  createApiClient,
  newId,
  newMutation,
  type ApiClient,
  type ApiRouter,
  type AuthRouter,
  type CreateApiClientOptions,
  type MutationMeta,
  type SignInOptions,
} from './client.js'

export {
  createPlatformClient,
  type CreatePlatformClientOptions,
  type PlatformApiClient,
  type PlatformSignInOptions,
} from './platform-client.js'

export {
  ApiError,
  ORPCError,
  defaultMessageFor,
  toApiError,
  type ApiErrorKind,
  type ApiErrorOptions,
} from './errors.js'

export {
  QueryCache,
  serialiseKey,
  type FetchOptions,
  type QueryEntry,
  type QueryKey,
  type QueryStatus,
} from './cache.js'

export { readEveryPage, type CursorPage, type EveryPage } from './pages.js'

export {
  PlatformSessionStore,
  SessionStore,
  type PlatformSession,
  type PlatformSessionState,
  type Session,
  type SessionSnapshotLike,
  type SessionState,
  type SessionStoreLike,
} from './session.js'

export {
  memoryTokenStorage,
  secureStoreTokenStorage,
  webTokenStorage,
  type SecureStoreLike,
  type TokenStorage,
  type WebStorageLike,
  type WebTokenStorageOptions,
} from './storage.js'

// The contract itself, so a screen can name a procedure's input or output type without a second import.
export type { contract } from '@dos/contracts'
