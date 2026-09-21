# One-app repair — extra-role chooser walk (ruling B5), 2026-09-21

Branch `qa/one-app` after R1 (main merged), R2 (`MembershipSummary.extraRoles` on the wire), R3 (docs/29 §3).
Backend: `backend/all-in-one` (dist) on `ALL_IN_ONE_PORT=3210`, `DATABASE_URL=…/dos_test_one_app` (fresh from
`dos_test_batch2b_template`, migrated + seeded). App: `expo export --platform web` of `frontend/dos-app`
(entry 3 357 576 bytes, 1 294 modules; `EXPO_PUBLIC_API_URL=http://127.0.0.1:3210`,
`EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3210/auth`), served static with SPA fallback on 127.0.0.1:5191.
Walk of record: the Claude desktop Browser pane (fresh storage before each person). The PNGs in this folder
were taken by a headless Playwright Chromium against the same servers, same steps, because the pane cannot
write a file.

## dinesh.patil — warehouse membership, `extra_roles = {delivery}` (seed-demo `extraRolesFor`)

| step | 1280x800 | 390x844 |
| --- | --- | --- |
| sign-in → chooser | `Continue as` lists **Godown** (own, preselected) and **Delivery** (the extra role) | same two rows |
| choose Delivery → Continue | `POST /auth/auth/switch-tenant → 200`; lands `/delivery`; rail shows `delivery`, "Today's trip" | lands `/delivery`, phone chrome, "Today's trip" |
| that group's service | `GET /delivery/delivery/consents → 200`, `GET /delivery/sync/manifest → 200`, `GET /delivery/sync/pull… → 200`, `GET /delivery/sync/errors… → 200`; no call to any other group's prefix | same reads, all 200 |
| sign out (Me → Sign out) | back on `/sign-in`; `localStorage['dos.lastRole'] === 'delivery'` | same |
| sign in again | chooser opens with **Delivery — "Last time on this device"** preselected (highlighted row) | same, `one-app-extra-role-390.png` shows the two rows |

Before R2 (verifier §5.1) this person's chooser never opened: the wire carried no `extraRoles`, so
`permittedRoles()` was `['warehouse']` alone.

## rahul.deshmukh — salesperson, no extra role

1280x800, fresh storage: sign-in lands straight on `/sales` ("Today's beat", Station Road), `dos.lastRole ===
'salesperson'`, the body never contains "Continue as"; `GET /sales/sync/pull… → 200`, `GET /sales/sync/errors… → 200`.

## Files

- `one-app-extra-role-1280.png` — the chooser at 1280x800 (Godown + Delivery)
- `one-app-extra-role-1280-landed.png` — `/delivery` as the elected group, desk rail
- `one-app-extra-role-390.png` — the chooser at 390x844
- `one-app-extra-role-390-landed.png` — `/delivery` at phone width
