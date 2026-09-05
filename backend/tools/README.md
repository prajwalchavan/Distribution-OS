# backend/tools

Scripts that run against the workspace, not part of any service. All are plain `tsx` entry points
(no decorators), started from `backend/` through the scripts in `package.json`. `tsconfig.json` here
exists only so they typecheck and lint — nothing in it is built or shipped.

| Script                 | Command                        | What it does                                                                       |
| ---------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| `generate-readmes.mts` | `pnpm docs:readme` / `--check` | Rewrites every service and app README from the shared contract. CI runs `--check`. |
| `smoke-endpoints.mts`  | `pnpm smoke`                   | Calls every operation of every running service and reports what works.             |
| `auth-keygen.mts`      | `pnpm auth:keygen`             | Generates the EdDSA signing key pair for auth-service.                             |

## `pnpm smoke` — the endpoint harness

Answers one question: **if you open a service's `/swagger`, press Try it out and Execute, does it
work?** For each of the seven services it signs in against auth-service (`:3000`) as that service's
primary demo role, reads _that service's own_ `/docs/openapi.json`, and calls every operation it
finds.

```bash
pnpm smoke                      # all seven services, mutations included
pnpm smoke --service owner      # one service
pnpm smoke --only GET           # reads only — writes nothing to the database
pnpm smoke --destructive        # also run cancel / delete / revoke / setPassword / …
pnpm smoke --verbose            # print the request body of every call
pnpm smoke --run-tag fresh-1    # write a fresh set of rows instead of today's
```

The seven services must already be running (`:3000`–`:3006`) and `DATABASE_URL` must point at the
seeded demo database — it is read through `@dos/db`'s `loadDotenv()`, same as every other script.

### Where request bodies come from

1. The operation's OpenAPI `example`, when the contract carries one. This is the point of the tool:
   it presses exactly what the docs offer.
2. Otherwise a local generator walks the JSON Schema and fills it from the seeded demo data, reading
   real ids straight out of Postgres with `pg` (retailer, variant, location, supplier, price list,
   scheme, beat, lot, order in a given state, GRN, supplier invoice line, …). Only _required_
   properties are generated — a minimal body is the one most likely to be accepted, and an optional
   field the harness invents is an invitation to a false alarm.
3. A short overrides table handles the few the walker cannot know: the auth chain (login → refresh →
   switch-tenant → logout uses a throwaway session, never the token the run is using), the order
   lifecycle, `scope: { all: true }` on a scheme, and which demo row each `{id}` should point at.

### How results are classified

| Class      | Meaning                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OK`       | 2xx.                                                                                                                                                                                                                                        |
| `EXPECTED` | A documented business refusal: 403 where `PERMISSIONS` says this role may not call the procedure, or a 400/409/422 with a clear message on a row that legitimately does not qualify.                                                        |
| `BROKEN`   | 5xx, a validation error caused by the body we sent, a 404 on an id read from the database, a 401 with a valid token, a 403 the permission table allows, a published example whose hard-coded id already exists here, or no response at all. |
| `SKIPPED`  | Destructive without `--destructive`, or no demo row qualifies. Every skip is listed with its reason — nothing is skipped silently.                                                                                                          |

Roles come from `@dos/contracts`' `PERMISSIONS` table, so a 403 is judged against the same table the
guard uses rather than a hand-kept list.

A table is printed per service, the full detail (request body, response sample, timing) is written
to `backend/.smoke/<service>.json` (git-ignored via `.smoke/` in the **repo-root** `.gitignore`), and
the process exits non-zero if anything is `BROKEN` — so this can become a CI gate once the failures
are cleared.

### It writes to the demo database, on purpose

Mutations are pressed for real. That is the only way to know they work, and it is expected.

- A body that came from a contract example is sent **verbatim, published idempotency key included** —
  that key is exactly what makes a second Execute in Swagger replay rather than write again, so the
  harness has to press it to find out whether it does.
- A body the harness generated carries an idempotency key that is a digest of the request it
  actually sends, seeded by `--run-tag` (default: today's business date). **Re-running on the same
  day replays the stored result instead of writing again**, so the demo data does not grow when you
  run it twice. Client-generated ids are seeded the same way — and by the request path, so two
  orders never share a line id.
- The one exception is the order lifecycle, which is once-through by nature: a submitted draft
  cannot be re-submitted. When the harness generates the body, `orders.create` / `orders.repeatLast`
  therefore use a per-run id, so each run makes one throwaway order per service and walks it
  draft → submitted → confirmed instead of reporting a permanent conflict. Once the contract carries
  an example for those procedures the example wins, and the chain is only as re-runnable as the
  example's own id is.
- Procedures matching `/cancel|delete|revoke|writeOff|disable/`, plus `auth.changePassword`,
  `tenancy.staff.setPassword`, `tenancy.staff.setStatus` and `retailers.linkIdentity`, are skipped
  unless `--destructive` is passed — they would change the credentials or the shop links every other
  tool and demo script depends on. They are listed in the output, never dropped quietly.
- `--only GET` writes nothing at all. Use it when another agent is working in the same database.

### Reading a failure

The BROKEN list says where the body came from:

```
owner/orders.setLines   500 server error 500 [body: the contract example]
     Internal server error
```

`[body: the contract example]` means the payload the docs pre-fill is the one that failed — fix the
example (or the handler). `[body: generated from demo data]` means the harness built it from real
ids, so the fault is more likely in the handler. The service's own log has the underlying Postgres
error.
