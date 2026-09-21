# The ten-day plan (founder, 2026-09-21)

The founder asked for 30 days to become 10: "Remove everything possibly that is unnecessary and keep only
required things. As I have only one week of fable max subscription left I want to wrap it up this month
and my subscription lasts only 2-3 days per week."

This file is the cut. It is not a claim that the remaining work got faster — it is a list of what is no
longer being done, and why each one is safe to drop **for a single-distributor pilot**. Anything cut here
is cut for the pilot, not for ever; the row that names it says when it comes back.

## What decides the cut

Two questions, asked of every phase:
1. **Can a fault here lose the distributor money, stock, or another tenant's data?** If yes it stays.
2. **Is it already proven by something we run?** The backend carries 646 module specs, `rls.test.ts` (the
   database guarantees as executable tests), `describePermissionMatrix` in all seven services (every
   endpoint × every role), and a smoke run of 1 618 calls that now ends 0 BROKEN on a fresh seed. A phase
   whose content is "check the thing those already check" is re-verification, not verification.

## The ten days

**Revised 2026-09-21 on the founder's word: "Business simulation is imp."** It was on day 7 with three days
behind it. It is now on days 4-5 with FIVE days behind it, because it is both the most valuable test in the
programme and the one most likely to find something structural — and a structural fault found on day 7
cannot be fixed by day 10. The riskiest test goes early, where there is room to answer what it finds.

| Day | What runs | Why it earns a day |
|---|---|---|
| 1 | Batch 2 closes; the full 7-app regression starts (browser, both widths) | 153 findings changed the product; nothing is trustworthy until the apps are walked once more together |
| 2 | **Phase 2 — the cross-role end-to-end business flow** | One order carried by real people through every app. The simulation cannot start until this holds |
| 3 | **Fable designs the simulation AND the Stage 2 essentials in one sitting** (1 of 3 Fable sittings) | One architect design covering both, because Fable days are the scarce resource |
| 4–5 | **THE BUSINESS SIMULATION — all seven trading days, run properly** | See below. This is the centre of the plan, not a checkbox at the end |
| 6 | Fix what the simulation found | This is where the P0s land, if there are any. The day exists because the simulation is expected to find things |
| 7–8 | Money reconciliation · pricing, schemes & GST · inventory lifecycle · tenant isolation — PARALLEL lanes, aimed at what the simulation exposed | Running these AFTER the simulation means they hunt where the evidence points, instead of guessing |
| 9 | Android in full, iOS basics · the security slice hosting needs · **host it and hand over URLs** | |
| 10 | **Fable's final audit** (1 of 3 Fable sittings) | "I am satisfied" is the founder's word, and the audit is what earns it |

### The simulation, in full (QA/PHASES.md Phase 21)

Seven simulated trading days driven against the running services, with real people doing real jobs in
seven apps — not a script calling endpoints:

1. Onboard retailers, add inventory, configure products, prices and schemes, create employees
2. Reps create orders · the manager approves · the warehouse processes
3. Deliveries, payments, outstanding updated
4. New stock received, a price change, a scheme introduced
5. Returns, damaged goods, a failed delivery, a partial payment
6. High-volume orders, concurrent operations, network failures
7. Reconciliation, reports, outstanding, inventory, revenue, operational review

**It ends in arithmetic, and the arithmetic is the verdict:**
- **opening stock + receipts − sales − damage − returns = closing stock**, per SKU per batch
- **revenue = payments + outstanding**

Any drift is a P0. Not a discussion, not a rounding note — a P0. That is what makes this the one test worth
protecting, and why day 6 exists behind it.

Its day 6 also absorbs most of what phase 13 would have done (concurrency, idempotency, network failure)
and its day 7 most of phase 7's reconciliation — which is why those cuts below are honest rather than
convenient.

## What is cut, and what it costs

| Phase | Cut | Why it is safe for THIS pilot | When it comes back |
|---|---|---|---|
| 5 — Realistic test data | Folded into day 7 | The seed is now proven by 1 618 smoke calls ending 0 BROKEN | It is done |
| 6 — Automated test suite | Cut | 646 module specs, 7 permission matrices and the RLS guarantee tests already exist. Writing more tests is not what is missing | Before customer #2 |
| 9 — Order state machine | Folded into day 7 | The machines are code (`machine.next()`), unit-tested; the simulation exercises every transition for real | — |
| 11 — Account & authentication | Folded into day 4–5 isolation lane | Auth specs plus the permission matrix cover it; only lockout and refresh-reuse are added to that lane | — |
| 13 — Concurrency & resilience | Mostly cut | Every mutation is idempotent with a database unique constraint, and the two-desk race is already walked (DOS-168). One concurrency attack rides with the money lane | Before real load |
| 14 — Offline & cross-platform sync | Mostly cut | DOS-167 closed on measured evidence across Android, iOS and web. The rest rides with day 8 | — |
| 16 — Security & file security | Reduced to day 9 | A pilot on one host for one customer is a different threat model from a public product — but URLs change that, so the authz / file-URL / secrets slice stays | Before any public signup |
| 17 — Performance, DB, search | **Cut** | One distributor, ~36 shops, 1 430 packs. Performance is not the risk at this size; the architecture was built for scale (docs/20) and nothing here proves or disproves that | Before ~10 paying tenants (docs/26 stage 2) |
| 18 — Notifications, audit, observability, DevOps | Cut to what hosting needs | Nothing here loses money in a pilot | At go-live |
| 19 — Dates, localization, migration, import/export | **Cut** | English-only pilot (founder, 2026-09-05); IST lives in the domain layer and is tested. The TradeEzee import is a CUT-OVER task, not a QA phase — it happens when the founder moves his real book | At cut-over |
| 20 — Web, responsive, accessibility | Cut to the day-1 regression | Every app gate already walked desk and phone widths. Accessibility is real work and not a pilot blocker | Before a public product |
| 15 — Mobile platform testing | Reduced to day 8 | The founder's own decision of 2026-09-21: complete validation at the end, basics until then | Day 8 is that end |

## What this trades away, said plainly

Ten days buys the things that can lose money, stock or data, and the proof that the product works end to
end for real people. It does not buy: performance under load, accessibility, observability, a second
language, or a hardened public surface. For a pilot with one distributor the founder knows personally,
that is the right trade. For the second paying customer it is not, and the rows above say what returns.

**The one risk that could break the ten days:** days 4-5. A business simulation is the test most likely to
find something structural, because it is the first time the whole product is asked to behave like a
business rather than like a screen. If it finds something deep, the fix is not a day. It now runs early, so
there are five days behind it instead of three — that is the whole reason it moved. Every other day here is
predictable; that one is not, and pretending otherwise would be the kind of report this programme has spent
three weeks refusing to write.

**The simulation runs on the DEMO data** — three distributors, staff under each, shops linked to more than
one — because that is what exists today and it is domain-true. If the founder's real extract arrives before
day 4 and turns out to be a Distribution OS book, a second pass on a COPY of it is worth a day and would be
the strongest evidence this programme could produce. That is his call, not a default.
