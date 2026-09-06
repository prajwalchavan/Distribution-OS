# `@dos/offline`

Our own delta sync client (founder, 2026-09-05: **no PowerSync**; docs/22 §8, docs/26 §6). The binding
design is **`docs/27-offline-sync-client.md`**; the server side is `docs/07` §0 and
`backend/libs/core/src/modules/sync/**`. Nothing here re-declares a wire shape: every one comes from
`@dos/contracts` through `src/wire.ts`, type-only, so no Zod and no oRPC reach a field phone's bundle.

```
import { openStore, transportFromApi, connectionStateFrom } from '@dos/offline'
import { OfflineProvider, useTable, useOutbox, useSyncStatus } from '@dos/offline/react'
```

## What it does

| Piece            | File                        | Rule it keeps                                                                                                                                                                                                                 |
| ---------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage adapters | `store/`                    | `expo-sqlite` on a phone, its OPFS web build in a cross-origin-isolated page, an in-memory SQL store otherwise — which reports `persistent: false` so `<ConnectionStrip>` can say "Offline data is not saved on this browser" |
| Local schema     | `schema.ts`                 | One table per **manifest** entry, columns exactly as the server published them. A column a pull spec strips for the role is absent here too: the device has nowhere to put a cost                                             |
| Pull             | `engine.ts`                 | Manifest handshake → snapshot or delta; **tombstones before rows**, upsert by the manifest primary key, cursor saved only after the transaction commits, loop while `hasMore` echoing the LAST cursor                         |
| Outbox           | `engine.ts`                 | The row and the local change in one transaction; FIFO by `seq`; ≤ 50 ops per batch; `opId === idempotencyKey`, reused on every retry; survives a restart                                                                      |
| Conflicts        | `engine.ts`                 | LWW with the server's veto. A `stale` rejection re-pulls the row and the tray offers both versions; the client never resolves a conflict by itself                                                                            |
| Status           | `types.ts`, `connection.ts` | The exact object of docs/27 §10, and the one line that turns it into `<ConnectionStrip>`'s `ConnectionState`                                                                                                                  |
| GPS              | `engine.ts`                 | `_gps_buffer` → `delivery.gps.points`, outside the queue (ADR 0012), pruned locally after 7 days                                                                                                                              |
| React            | `react.tsx`                 | `<OfflineProvider>`, `useSyncStatus`, `useTable`, `useRow`, `useOutbox`, `useNeedsAttention`. Screens never write SQL and never call `sync.pull` or `sync.upload`                                                             |

## Wiring it into an app

```tsx
<OfflineProvider api={client.api} deviceId={deviceId} storeFactory={openStore}>
  …
</OfflineProvider>
```

`storeFactory` is `openStore` from this package: the bundler picks `index.native.ts` on Android and iOS
and `index.web.ts` in a browser. `deviceId` is the id the app already keeps for `auth_sessions`
(`src/api.ts` in the app template) — one per install, kept across a sign-out.

## The tests

`pnpm --filter @dos/offline test` — the eleven of docs/27 §13 in that order, plus the two the build of it
made necessary (a rejected op is resendable with the same `opId`; an `upgradeRequired` answer keeps the
queue instead of burning it), plus the memory engine's own SQL suite. Every one is deterministic: a
scripted transport, an in-memory store, an injected clock, no network and no timer it does not own.

## The harness

`pnpm --filter @dos/offline harness` → <http://localhost:5198>, with auth-service :3000 and sales-service
:3003 running. Sign in as `rahul.deshmukh` / `Dos@1234`, watch the manifest and the snapshot land, pull
the switch on the network, queue an order in the dead spot, put the signal back and watch the queue drain
exactly once. It is to the sync client what `libs/ui/gallery` is to the design system, and it is not
shipped in any app.

Vite cannot compile `expo-sqlite` (it reaches React Native, whose sources are Flow, and only Metro strips
Flow), so the harness aliases it away and runs on the **memory** adapter — which the page says out loud.
The two SQLite adapters are reached through Metro, in the apps.
