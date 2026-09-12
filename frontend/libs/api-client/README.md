# @dos/api-client — the typed client every app uses

Wire types come from `@dos/contracts` (the backend's own package, linked from `backend/libs/contracts`,
never copied). This package adds the things a screen should not have to think about: where the tokens live,
refreshing them, retrying once, one idempotency key per intent, and turning any failure into a typed error
with a sentence a distributor can act on.

```ts
import { createApiClient } from '@dos/api-client'
import { ApiProvider, useApi, useQuery, useMutation, useSession } from '@dos/api-client/react'

export const client = createApiClient({
  apiUrl: import.meta.env.VITE_API_URL, // this app's own service (owner :3001, sales :3003, …)
  authUrl: import.meta.env.VITE_AUTH_URL, // auth-service; its routes already start with /auth
  platform: 'web', // 'android' | 'ios' on the Expo apps
})
```

## Base URLs, and the all-in-one process

One base URL per app. Against the split deployment `apiUrl` is that service's origin; against the all-in-one
process (`docs/26` §7) the same build points at one origin and names its prefix:

```ts
createApiClient({
  apiUrl: 'https://api.example.in',
  prefix: '/owner',
  authUrl: 'https://api.example.in',
})
```

No route changes: the paths under a prefix are the paths the service serves on its own port.

## Session

`signIn({username, password, remember, tenantId?})` · `signOut()` · `me()` · `switchDistributor(tenantId)` ·
`changePassword(current, next)` · `hydrate()`.

`tenantId` is sent **only** when the caller supplies one: omitting it signs the user into their own
distributor, and sending a tenant they are not a member of is a 403 (`docs/22` §7).

- The **access token** lives in memory for the life of the process. It is never written to storage.
- The **refresh token** goes to `TokenStorage`.
- A 401 on any token-bearing call triggers **one** shared refresh (single-flight across both clients) and
  replays the call once. A second 401, or a refused refresh, clears the session and calls `onSignOut`.
- `hydrate()` on boot exchanges a surviving refresh token for a live access token; the persisted session
  snapshot lets the shell paint immediately while it runs.

## Token storage, and the web risk note

`webTokenStorage({remember})` (default in a browser) · `secureStoreTokenStorage(SecureStore)` (native) ·
`memoryTokenStorage()` (tests, SSR, a browser that blocks storage).

**The web risk, deliberately taken and written down.** A page cannot read an httpOnly cookie, and this client
talks to auth-service directly rather than through a same-origin session endpoint, so the refresh token sits
in `localStorage` (or `sessionStorage` when "Remember this device" is off). Any script running on the app's
origin could read it. What limits the damage: refresh tokens rotate on every use and a **reused** token
revokes the whole session server-side (`auth_sessions`, `docs/22` §7); the token is bound to one `deviceId`;
the app ships no third-party script and renders no user-supplied HTML; and the access token — the one that
actually opens the API — is never stored at all. Moving to an httpOnly cookie needs a same-origin auth
endpoint on the reverse proxy; that is an open point, not a defect in this file.

On native the same interface is served by `expo-secure-store` (Keychain / EncryptedSharedPreferences). The
module is **injected** rather than imported, so this package carries no Expo dependency:

```ts
import * as SecureStore from 'expo-secure-store'
createApiClient({ …, storage: secureStoreTokenStorage(SecureStore) })
```

## Errors

Every call rejects with an `ApiError`, never a raw `fetch` failure or an `ORPCError`:

| `kind`                                              | when                                                  |
| --------------------------------------------------- | ----------------------------------------------------- |
| `network`                                           | the request never reached a service (`retryable`)     |
| `auth`                                              | the session is gone — sign in again                   |
| `permission`                                        | the permission matrix said no; retrying will not help |
| `suspended`                                         | 423: the distributorship is suspended                 |
| `business` · `validation` · `conflict` · `notFound` | the service refused, with its own sentence            |
| `server`                                            | the service failed (`retryable`)                      |

`message` is the service's own wording where it sent one. When it sent none — `ORPCError` fills a missing
message with the machine CODE — the client substitutes a business sentence, because "FORBIDDEN" on screen is
exactly what UX-00 §12 forbids.

## Mutations

```ts
const place = useMutation(
  (input: Draft, meta) =>
    api.orders.submit({ ...input, id: meta.id, idempotencyKey: meta.idempotencyKey }),
  { invalidates: [['orders'], ['receivables']] },
)
```

One user intent = one `MutationMeta` (a client UUIDv7 `id` and an `idempotencyKey`). A **retry of the same
intent reuses both**, so a double tap or a lost reply can never write a second row
(`UNIQUE(tenant_id, idempotency_key)`). `reset()` is what starts a new intent.

## The React layer

`<ApiProvider client>` (hydrates on mount) · `useApi()` · `useSession()` · `useQuery(key, run, {staleTime,
enabled})` · `useMutation(run, {invalidates, onSuccess, onError})` · `useRefusal(writes, scope?)` ·
`useQueryCache()`.

`useRefusal(writes, scope?)` decides which refused write a dialog or panel shows: the LATEST refusal among the
writes it serves, hidden the moment any of them is pressed again or the surface moves to another row (`scope`),
and never one that was already there when the surface opened. The rule is the pure pair `refusalStart` /
`nextRefusal`, specified in `src/react/refusal.test.ts` (DOS-029). It never calls `reset()`, so a retry keeps
its idempotency key.

`QueryCache` de-duplicates concurrent reads of one key into a single request, serves a fresh value without a
round trip, keeps the last good value on screen when a revalidation fails (with its age, so the strip can say
how old it is), invalidates by key **prefix**, and clears on sign-out so the next user never sees the last
one's rows. It is written here rather than pulled from a data library so the seven apps share exactly one
cache and one retry rule.

`readEveryPage(fetchPage, { maxPages })` follows `nextCursor` inside a window the server already bounds, reports
`complete`, and rejects if any page fails.

## Tests

```bash
pnpm --filter @dos/api-client test
```

42 of them, including the whole refresh cycle driven against a stubbed `fetch`: the Bearer header, one
refresh and one replay on a 401, a single shared refresh across a burst of 401s, sign-out when the refresh
itself is refused, no retry on a 403, the all-in-one prefix, boot-time hydration, and the storage rules.
