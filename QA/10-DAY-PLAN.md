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

| Day | What runs | Why it earns a day |
|---|---|---|
| 1 | Batch 2 closes; the full 7-app regression starts (browser, both widths) | 153 findings changed the product; nothing is trustworthy until the apps are walked once more together |
| 2 | **Phase 2 — the cross-role end-to-end business flow** | One order carried by real people through every app. The single best answer to "does it work" |
| 3 | **Fable designs the Stage 2 essentials run** (1 of 3 Fable sittings) | The architecture seat decides what "safe" means here, once, instead of per lane |
| 4–5 | Money reconciliation · pricing, schemes & GST · inventory lifecycle · tenant isolation — as PARALLEL lanes, not sequential phases | These are the four where a fault costs rupees, stock, or another distributor's data |
| 6 | Fix what days 4–5 found | Finding is cheap; fixing is the real cost. This day is the honest one |
| 7 | **The business simulation, compressed** — a fortnight of trading driven fast against the real services | Replaces most of phases 9, 13 and 14: real sequences break what unit tests do not |
| 8 | Device validation — Android in full, iOS basics (founder, 2026-09-21) + fixes | The apps are universal; Android is the pilot platform |
| 9 | The security slice that hosting needs (authz, signed file URLs, secrets) + **host it and hand over URLs** | Public URLs change the threat model; this is the part of Phase 16 that cannot wait |
| 10 | **Fable's final audit** (1 of 3 Fable sittings) | "I am satisfied" is the founder's word, and the audit is what earns it |

**Fable's remaining budget is the binding constraint, so it is spent on exactly three things:** the day-3
design, the merge reviews of anything that changes a contract, a permission or the schema, and the day-10
audit. Everything else runs on Opus. No Fable time goes to work an Opus lane can do.

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

**The one risk that could break the ten days:** day 7. A business simulation is the test most likely to
find something structural, because it is the first time the whole product is asked to behave like a
business rather than like a screen. If it finds something deep, the fix is not a day. Every other day here
is predictable; that one is not, and pretending otherwise would be the kind of report this programme has
spent three weeks refusing to write.
