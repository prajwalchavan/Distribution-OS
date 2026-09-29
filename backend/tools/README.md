# backend/tools

Scripts that run against the workspace, not part of any service. All are plain `tsx` entry points
(no decorators), started from `backend/` through the scripts in `package.json`. `tsconfig.json` here
exists only so they typecheck and lint — nothing in it is built or shipped. The folder is the
`@dos/tools` workspace package (`pnpm --filter @dos/tools test | lint | typecheck`), which holds the
legacy importer's parsers and their specs (`legacy/`); `smoke-endpoints.mts` is left out of its
typecheck: it has two type errors on the `platform_admin` role that predate the package.

| Script                       | Command                        | What it does                                                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generate-readmes.mts`       | `pnpm docs:readme` / `--check` | Rewrites every service and app README from the shared contract. CI runs `--check`.                                                                                                                                                                                    |
| `smoke-endpoints.mts`        | `pnpm smoke`                   | Calls every operation of every running service and reports what works.                                                                                                                                                                                                |
| `auth-keygen.mts`            | `pnpm auth:keygen`             | Generates the EdDSA signing key pair for auth-service.                                                                                                                                                                                                                |
| `import-legacy-extracts.mts` | `pnpm import:legacy --help`    | Loads a distributor's old-software extracts (TradeEzee sheets, PDF, SQL Server backup); see `docs/32-legacy-import.md`.                                                                                                                                               |
| `check-stock-cancels.mts`    | `pnpm check:stock-cancels`     | Release check (QA DOS-257): lists every cancelled bill whose stock rows do not net to zero (`--write-off` reruns migration 0072's write-off first); exits 1 while one is open.                                                                                        |
| `check-stock-negative.mts`   | `pnpm check:stock-negative`    | Release check (QA DOS-350): names each balance below zero (item, batch, place); warns on receipts merged across expiries (DOS-356) and on switched-off places holding pieces; `--clear-flags` reruns 0075's flag fix first; exits 1 while a balance stays below zero. |

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

## `pnpm check:stranded` — documents the fixed product can no longer produce

`check-stranded.mts`, a release check (QA phases 10 + 9, the stock-states lane). It names every order, bill,
trip and pick left in a state the fixed product can no longer reach — dispatched with no bill or with no trip,
dispatched off its own trip's load, a loaded trip cancelled, a pick edited after its pack, a bill of an expired
batch — and every godown batch held beyond what stands there, one line each, and exits 1 while any is left.
Read-only; `--tenant <slug>` looks at one distributor, `--json` prints the rows. Nothing moves them on by itself:
each needs a person (a check-in, a credit note, a count or a cancel).

## `pnpm fill:demo` — dummy activity on top of the real master data

Decision docs/22 §8 (2026-09-28), brief `docs/plans/demo-activity-fill.md`. One site, one database: the
distributor's real shops, items, prices, stock and opening dues stay, and this tool adds a working day on top
so that every role opens on work. It is a CLIENT of the running API — it signs in as the people who would do
each step and calls the procedures the apps call — and never opens a database connection to write.

| Command                                                                                             | What it does                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm fill:demo --api <url> --tenant <slug> --owner-password-file <f> --logins-file <f> [--commit]` | Finishes what the tool left open on earlier days, then makes `--date` (default today, IST). Dry run without `--commit`. `--report <json>` writes its counts.                                                          |
| `pnpm check:demo-coverage` (same arguments)                                                         | Signs in as every tester login and reads what each role's screens read; exits 1 with the gap list when a role has no work.                                                                                            |
| `pnpm check:demo-rows --tenant <slug> [--expect <run.json> …] [--baseline <before.json>]`           | Reads the database (`DATABASE_URL`) read-only: the tool's rows by kind, its money only on its own bills and no real money on them, stock ledger = balances, journals balance, dues = bills − receipts − credit notes. |
| `pnpm --filter @dos/tools build:lookalike --owner-password-file <f>`                                | TEST ONLY (refuses any database not named `dos_test_…`): a distributor built the way the real one was — `bootstrapTenant` + the legacy importer's writer — from an invented plan of the real one's shape.             |
| `bash backend/infra/oracle-vm/fill-demo.sh`                                                         | The founder's one command: rehearsal on a restored copy, the real run, the tool's two checks and the four release checks on each, the 06:00 IST cron line.                                                            |

How rows are marked: every idempotency key starts `demo-fill:<business date>:`, and every id the tool names
is derived from that key and the distributor — a UUIDv7 whose time falls inside the business date and which
carries the tag `…-7d3f-bd3f-de30…` (`demo-fill/ids.ts`). Rows the API makes from them (a bill at pack, a
credit note at a door) are found through the tool's row they hang off. The same date run twice writes
nothing; a run that died midway is healed by the next. Output is counts and ids only.

**The tester logins** (founder, 2026-09-29; brief rule 4) are plain — `manager`, `accounts`, `sales1`, `sales2`,
`godown`, `driver1`, `driver2` (`--login-suffix x` makes them `manager.x` …, for a second distributor on one
database) — and every one signs in with the demo password the demo seed gives every demo user (`DEMO_PASSWORD` in
`libs/database/src/seed-demo/`, imported from there, never written into the tool). It is set through the product's
own doors: the owner makes the login with a temporary password and the tool, signed in as the person, changes it,
so no tester is asked to change it at sign-in; a tester whose password someone changed is set back the same way.
The owner's password is never set, changed or written, and the distributor's own staff are never touched. The
logins file (mode 600) lists `username<TAB>password<TAB>role` so a person sees who exists; nothing else the tool,
its checks or `fill-demo.sh` print or write carries a password. The tool finds its people by the mark it made them
with (their user id derives from its idempotency key), not by the username: a plain username someone else holds —
the distributor's own staff, or a person of another distributor, which the tool asks the product about without
making anything — is left to them, the next free plain name is taken (`godown2`, `sales3`) and the report says so.
A database the tool ran on before that decision (`tester.<role>` logins with generated passwords) is healed in one
run: the old drivers finish their trips on the road themselves (no procedure hands a trip to another driver), the
van load they planned for the next morning is cancelled and its bills ride the new vans, the old reps' beats go to
the new reps, and the old logins are switched off at the end; on a date the old logins already made, the new crew
takes its own shift of it (ids tagged `s2`). A shopkeeper login cannot be made through the API (QA DOS-400): three
shops stand in for `shop1…3`; when one of them is closed, gets a login or becomes a credit shop, the next run
picks another and moves the tool's offer to it.

A dry run writes nothing of the business, but it does sign the owner in and out, and the sign-in service
records that as it records every sign-in: one session, its sign-in and sign-out events and the device. A run
the API stops answering in the middle still prints its summary and writes its `--report` (exit 1 when a whole
row of the brief's table is missing); the next run carries on from what is there.

What the fixed product does by itself, and how the tool keeps to it:

- **Money on account is applied by the product** to a shop's oldest open bills — at a new bill, at a receipt's
  remainder, at a credit note's (QA DOS-312) — and money from a shop with a written-off bill recovers that first
  (DOS-311). So real money never settles a tool bill and the tool's money never reaches a real one (rule 3b): the
  tool never bills a shop holding money on account it did not put there; every receipt it records is explicit, to
  the paisa of its own bills; its one payment left on account ("collections to match") goes only to a shop that owes
  nothing on a real bill and has nothing written off; a return whose remainder could reach a real bill is not
  issued (the manager cancels it). `check:demo-rows` proves both directions and names any tool money on account at
  a shop owing on a real bill. Each run's report says how many shops it leaves out and why ("shops left out: …").
  What the tool cannot stop is money a PERSON records: a real payment taken FIFO (the default) for a shop with an open
  bill of the tool is spent on that bill too (QA DOS-407); the next morning's `check:demo-rows` names it.
- **A payment reference is used once** (DOS-310): the tool's UTRs, cheque numbers and transfer references carry the
  business date and are never repeated; when the product still names one as taken, the next is asked.
- **Credit** (DOS-313/314, DOS-225): no order for a shop whose credit is stopped; the shop held for credit is on a
  strict limit and not pay-on-delivery.
- **UPI is confirmed at Day-end** (DOS-256): each run confirms the earlier days' UPI with the cash and cheques it banks.
- **A bill rides only the trip that carries it** (DOS-354): tomorrow's van load is planned tonight on van 1's trip of
  tomorrow, its sheet waits for the manager (who can sign it off once today's van-1 trip is settled), and the next
  morning's doors join that trip. A shop has one door on a van, with all its bills.
- **After a run the four release checks pass** (`check:stock-negative`, `check:stranded`, `check:stock-cancels`,
  `check:receipt-references`): the work the tool leaves open on purpose is work the product carries on.
