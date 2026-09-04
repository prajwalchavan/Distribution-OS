# Adversarial verdicts on the synthesis claims

26 verdicts (workflow wf_bc219f98-f90, 2026-09-04): each of the synthesis key claims was attacked by a facts reviewer (web-checked) and a feasibility reviewer (solo dev, Kalyan reality).

**Refuted: 15 of 26.** Refuted items first.

## REFUTED (confidence high) — An issued GST tax invoice (numbered in its series, printed, possibly e-way-billed) cannot be regenerated with different quantities; delivery shortfalls and returns must be handled by credit notes at the original tax rate

The DESIGN (immutable invoice + credit note; van sales invoiced from the vehicle) is defensible, but the FACTUAL justification is wrong in three places and the "therefore" rests on the wrong statute.

1. "Cannot be regenerated" is false for the majority of Tarsun's outbound invoices. GST law explicitly contemplates cancelling a tax invoice: GSTR-1 Table 13 ("Documents issued") has From/To/Total/Cancelled/Net columns (gst.gov.in tutorial); the GST portal FAQ says invoices in a draft GSTR-1 "can be modified/deleted any number of times till they submit"; Table 9A amends taxable value in a later period; practitioners confirm "if you have cancelled the invoice in the same month, then it will not form part of GSTR-1" provided the number is accounted for in Table 13 (TaxTMI). Marg ERP - whose format invoice F resembles - ships Transactions > Sale > Modify Bill / Delete Bill as first-class functions, i.e. "regenerate the bill when the van returns" is what the trade does today. The truly hard constraints are narrow: (a) an IRN'd e-invoice cannot be amended and can only be cancelled within 24h on the IRP - but e-invoicing is B2B-only above Rs 5 crore turnover and B2C is excluded; Tarsun's retailers (invoices E, F, G) are unregistered, so those supplies are reported only as consolidated Table 7 totals "net of debit notes and credit notes" with no invoice-level reporting at all; (b) an e-way bill cannot be edited and can be cancelled only within 24h if goods were not moved - but Maharash

## REFUTED (confidence high) — Claude Sonnet 5 supports json_schema structured outputs, high-res vision at 2,576 px long edge (~4,784 tokens/page), and requests with more than 20 images drop to a 2,000 px per-image cap; modelled cost ~$0.029 (~Rs 2.4)

Verified against primary sources (WebSearch budget was exhausted, so every check is a direct WebFetch of the cited page plus the bundled claude-api skill docs). The API/pricing half of the claim holds; the benchmark half is misquoted and the cost figure is a floor.

CONFIRMED

1. Structured outputs: platform.claude.com/docs/en/build-with-claude/structured-outputs lists claude-sonnet-5 among supported models; feature is GA (no beta header), parameter is output_config.format with type json_schema; additionalProperties:false required, no pattern/minimum/maximum, grammar compiled on first use and cached 24 h. No documented incompatibility with image inputs or thinking; the thinking docs explicitly point to structured outputs as the JSON path while thinking is on.
2. High-res tier: vision doc table "High-resolution | Claude 4.7 and later models | 2576 px | 4784 tokens", automatic, no opt-in; Anthropic's Sonnet 5 migration notes state Sonnet 5 is in this tier ("2576 pixels on the long edge ... 4784 vs 1568 tokens"). Token formula ceil(w/28)*ceil(h/28).
3. > 20 images: vision doc: if a single API request contains more than 20 image blocks (counting resent earlier-turn images, tool_result images, and on Bedrock/Vertex document blocks too), a stricter per-image dimension limit applies; "resize each image so that neither dimension exceeds 2000 px, or keep the request to 20 or fewer image and document blocks".
4. Pricing: pricing page: Sonnet 5 $2 in / $10 out / $0.20 cache read / $2.50 5

## REFUTED (confidence high) — Claude Sonnet 5 supports json_schema structured outputs, high-res vision at 2,576 px long edge (~4,784 tokens/page), and requests with more than 20 images drop to a 2,000 px per-image cap; modelled cost ~$0.029 (~Rs 2.4)

Verdict: the API facts hold, the numbers and the evidence do not, and the part of the plan that fails at a Kalyan godown is the photo upload, not the model. Partially refuted; keep Sonnet 5 as the prior, fix the claim, and cut the multi-engine scaffolding.

WHAT CHECKS OUT (verified against live Anthropic docs, 2026-09-04):

- output_config.format = json_schema is listed for claude-sonnet-5, claude-opus-5 and claude-haiku-4-5 on the first-party API (structured-outputs page). Constraints R06 sec.8 already respects: additionalProperties:false, no min/max/pattern. Caveat the plan misses: the Bedrock list does NOT include Sonnet 5, so a future ap-south-1 (Mumbai) Bedrock residency path would lose structured outputs; Vertex is the residency path, as SYNTHESIS sec.5.2 already says.
- High-res tier = 2,576 px long edge AND a 4,784 visual-token cap; models 4.7+ incl. Sonnet 5. Verified.
- > 20 image blocks per request: every image must be <= 2,000 px on each side or the request is REJECTED with invalid_request_error (not silently downscaled). Verified. tool_result images and (on Bedrock/Vertex) PDF blocks count too.
- Sonnet 5 pricing $2 in / $10 out per MTok, cache read 10%, batch 50% off. Verified on the models overview page.

WHAT IS WRONG OR MISLEADING IN THE CLAIM:

1. "2,576 px long edge (~4,784 tokens/page)" is the wrong mental model for a page. For any A4/portrait photo the 4,784-token cap binds first: a 12 MP portrait photo lands at 1,659x2,212 px (4,740 tokens), a scanner-crop

## REFUTED (confidence high) — Claude Sonnet 5 supports json_schema structured outputs, high-res vision at 2,576 px long edge (~4,784 tokens/page), and requests with more than 20 images drop to a 2,000 px per-image cap; modelled cost ~$0.029 (~Rs 2.4)

Verdict: the API facts and the final recommendation hold; three factual sub-claims are wrong or unsupported as written, so the sentence cannot stand verbatim.

CONFIRMED (primary Anthropic docs, fetched 2026-09-04):

1. Structured outputs: GA, `output_config.format` = json_schema, `claude-sonnet-5` explicitly listed as supported. Constraints: `additionalProperties:false` required, no minimum/maximum/minLength/maxLength, limited pattern support; grammar compiles on first use and is cached 24h; an injected system prompt adds input tokens.
2. High-res vision: vision docs give the high-resolution tier as "Claude 4.7 and later models: 2576 px long edge, 4784 max visual tokens" with the 28-px patch formula; the Claude cookbook (multimodal-crop-tool) names "high-resolution-tier models (such as `claude-fable-5` and `claude-sonnet-5`) allow 2576 pixels and 4784 visual tokens". Sonnet 5 released 2026-06-30. A 12 MP photo therefore costs 4,784 tokens (token limit, not edge limit, binds).
3. Pricing: Sonnet 5 $2 in / $10 out / $0.20 cache read; the docs state the introductory $2/$10 "is now the standard price" and the planned Sept 1 rise to $3/$15 "will not occur". Cost arithmetic with R06's stated assumptions (4,784 img + 400 uncached text at $2; 2,500 cached at $0.20; 1,800 output at $10) = $0.0289. Verified.
4. > 20 images: the threshold is real (600 images/request; 100 on 200k models; stricter per-image limit above 20 blocks).

WRONG OR UNSUPPORTED:
A. ">20 images drop to a 2,000 px ca

## REFUTED (confidence high) — Google Play requires a Permissions Declaration Form, an in-app prominent-disclosure dialog and a <= 30 s demo video for background location and for the location-typed foreground service; Android 14+ needs foregroundServi

Partially refuted. The paperwork facts about ACCESS_BACKGROUND_LOCATION are accurate, but (a) the sentence conflates two different Play declarations, (b) "explicitly accepted" is an inference, and (c) — the part that matters for a solo founder — the plan's own trip-scoped design does not need ACCESS_BACKGROUND_LOCATION at all, so it is volunteering for the hardest review gate and the worst on-device permission flow for Hindi-speaking delivery staff.

What is correct (verified from Play help 9799150 text in scratchpad/play_bgloc.txt): with ACCESS_BACKGROUND_LOCATION in the manifest at targetSdk >= 29, Play Console requires the Permissions Declaration Form (exactly one feature), a video "30 seconds or shorter" showing the disclosure dialog and the feature, and a prominent in-app disclosure with the "even when the app is closed or not in use" wording. Android 14+ does require foregroundServiceType="location" plus FOREGROUND_SERVICE_LOCATION (Play help 13392821; Android FGS service-types page).

What is inaccurate: (1) The location FGS type has its own, lighter declaration on the App content page: a description, the user impact if the task is deferred/interrupted, a link to a video (no 30 s limit stated), and a preset use case. It does NOT require the Permissions Declaration Form or the prominent-disclosure dialog; those belong to ACCESS_BACKGROUND_LOCATION. (2) "Explicitly accepted": the bg-location page never names driver tracking as approved; it lists "Delivery/service trackin

## REFUTED (confidence high) — Google Play requires a Permissions Declaration Form, an in-app prominent-disclosure dialog and a <= 30 s demo video for background location and for the location-typed foreground service; Android 14+ needs foregroundServi

Verdict: the Android-platform half is correct; the Play-policy half is partly overstated, and the claim has an omission that changes the plan. Detail, checked against the live Google pages on 2026-09-04:

CONFIRMED

1. Android 14+ FGS rules. developer.android.com/develop/background-work/services/fg-service-types: "Beginning with Android 14 (API level 34), you must declare an appropriate service type for each foreground service ... and also request the appropriate foreground service permission for that type." Location type -> FOREGROUND_SERVICE_LOCATION, runtime prerequisite ACCESS_COARSE or ACCESS_FINE_LOCATION granted. expo-location's own library manifest (sdk-57 branch) already declares `LocationTaskService` with `android:foregroundServiceType="location"`, and the config plugin adds FOREGROUND_SERVICE + FOREGROUND_SERVICE_LOCATION when `isAndroidForegroundServiceEnabled` is true.
2. Background-location paperwork. support.google.com/googleplay/android-developer/answer/9799150 lists four required items: Permissions Declaration Form, video demonstration, prominent in-app disclosure ("in a dialog that pops up before the app's location runtime permission", must contain the word "location", template "This app collects location data to enable [feature] ... even when the app is closed or not in use"), and a privacy policy in-app and on the listing. "A developer may only declare one location-based feature."
3. FGS Play declaration. answer/13392821: for apps targeting Android 14+, eac

## REFUTED (confidence high) — Meta WhatsApp Cloud API India utility and authentication templates cost ~Rs 0.115 per delivered message and utility replies inside an open 24-hour customer-service window are free; the BSP claim that in-window messages b

WHAT SURVIVES (verified live today, 2026-09-04, from Meta's own calculator API https://whatsappbusiness.com/wp-json/wab/v1/pricing?market=IN&currency=INR): Utility Rs 0.115 (tiers only above 25M msgs/month), Authentication Rs 0.115 (tiers above 750k), Marketing Rs 0.8631, Service Rs 0. Meta's developer pricing page confirms "you are only charged when a template message is delivered" and, as of today, "Utility template messages sent within an open customer service window are free." Note the scratchpad's own wa_pricing.json is a 400 error, so R07's "fetched from the calculator" figure was not actually on disk until this check; the numbers are nonetheless correct. Also note those rates are ex-tax; an INR-billed Indian WABA will carry 18% GST on Meta's invoice (input-creditable), so the working per-message cost is ~Rs 0.136.

WHAT FAILS: (1) The "free in-window utility" mechanism expires before the product ships. Meta's public developer pages (pricing, updates-to-pricing) still do not list it, so the synthesis's sentence is literally true, but the change is corroborated by Zendesk's partner notice (states Meta announced it 10 Aug 2026), WATI, Chakra, Turbodev, MMDSmart, Zenvia, MyOperator and Indian/Nigerian press: from 1 Oct 2026 free-form service replies AND utility templates inside an open 24-hour window are billed per message at the market's utility rate with no volume tiers; the 72-hour click-to-WhatsApp free entry point stays free; inbound remains free. The plan submits tem

## REFUTED (confidence high) — Meta WhatsApp Cloud API India utility and authentication templates cost ~Rs 0.115 per delivered message and utility replies inside an open 24-hour customer-service window are free; the BSP claim that in-window messages b

Part 1 (Rs 0.115 per delivered utility/authentication message) is SUPPORTED: Meta's INR rate card effective 1 Jul 2026 lists marketing Rs 0.8631, utility Rs 0.1150, authentication Rs 0.1150, authentication-international Rs 2.4971, utility/auth volume tiers from Rs 0.1150 (0-25M utility / 0-750K auth) down to Rs 0.0805; Meta's page says "You are only charged when a template message is delivered"; India is not among the markets Meta lists for 1 Oct 2026 rate changes (Bangladesh, Iraq, Nepal, Sri Lanka, Kazakhstan, Kuwait, Morocco, Oman, Ukraine). Omission: all rates are exclusive of 18% GST on Meta's invoice for INR-billed Indian businesses (India billing localisation launched 1 Jan 2026; WABAs must migrate to INR by 31 Dec 2026).

Part 2/3 are REFUTED. Meta's own developer documentation page "Pricing for non-template messages" (developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages) states verbatim: "Effective October 1, 2026, Meta will charge for service messages" and "Effective October 1, 2026, Meta will charge for utility messages sent in response to users"; "rates for service messages are the same as the rates for utility and authentication messages"; "Meta does not offer volume tiers for service messages"; "Meta will announce and publish the rates that take effect October 1, 2026, by September 1, 2026"; Meta Business Agent (new category) charged from 1 Aug 2026 at $2.00 USD per 1M tokens; "The 72-hour free entry point window is unc

## REFUTED (confidence high) — NestJS 12 was released on 27 Aug 2026 as ESM-native with Standard Schema validation and @nestjs/observe; compatibility of Better Auth, the oRPC Nest adapter, pg-boss 12, Drizzle 0.45 and Sentry on ESM Nest 12 is unverifi

I did not evaluate this on paper; I ran the stack in the repo and against the registry.

WHAT IS TRUE. @nestjs/core 12.0.1 was published 2026-08-27T07:29Z, is "type":"module" with no `require` export condition (ESM-only), and @nestjs/common 12 ships StandardSchemaValidationPipe and StandardSchemaSerializerInterceptor. @nestjs/observe 0.1.8 exists, published the same day. The dates and features in the claim are correct.

WHAT IS FALSE: "unverified" and "gates". Four of the five named integrations are already verified in this repo today (2026-09-04) and the fifth is verified in the form that matters:

1. oRPC Nest adapter: @orpc/nest 1.15.0 peers on `@nestjs/core >=11`; `pnpm --filter @dos/api typecheck/test/build` all pass; the vitest suite boots a real Nest 12 + Fastify 5 + ORPCModule app in-process and serves the contract route; the built ESM `dist/main.js` boots and answers GET /health and GET /health/ping with 200. One real quirk: `@orpc/nest` sends the Fastify reply itself, so every `@Implement` method needs the repo's `@OwnsReply()` (= `@Res()`) marker or Fastify logs FST_ERR_REP_ALREADY_SENT. That is a Fastify-adapter issue, not a Nest 12 issue, and it is already solved in `backend/apps/api/src/platform/orpc.ts`.
2. pg-boss 12.30.0: ESM, zero Nest coupling (lives in the worker); `@dos/worker` typechecks and builds. "pg-boss on ESM Nest 12" is a category error, it never touches Nest.
3. Drizzle 0.45.2: dual ESM/CJS, zero Nest coupling; `@dos/db` builds and the api imports

## REFUTED (confidence high) — NestJS 12 was released on 27 Aug 2026 as ESM-native with Standard Schema validation and @nestjs/observe; compatibility of Better Auth, the oRPC Nest adapter, pg-boss 12, Drizzle 0.45 and Sentry on ESM Nest 12 is unverifi

The first half is accurate; the second half ("unverified", "gates the decision") is wrong as of 2026-09-04, and the plan's description of @nestjs/observe is wrong.

FACTS CONFIRMED. The GitHub release nestjs/nest v12.0.0 is dated 27 Aug (12:23); Trilon's announcement went out 28 Aug 2026. Release notes: "All core Nest packages now ship as ESM" (CJS apps keep working via require(esm)); route decorators accept a Standard Schema `schema` option (Zod/Valibot/ArkType) plus StandardSchemaSerializerInterceptor; new @nestjs/observe SDK; Node >= 20.19 / 22.12 required. Locally, node_modules/@nestjs/core 12.0.1 has "type": "module".

"UNVERIFIED" IS REFUTED FOR 3 OF 5. The repo already pins Nest 12.0.1, @orpc/nest 1.15.0, drizzle-orm 0.45.2 and pg-boss 12.30.0 (pnpm-workspace.yaml catalog). I ran it today: `@dos/api` typechecks; its vitest spec (backend/apps/api/src/modules/health/health.spec.ts) boots Nest 12 ESM + FastifyAdapter + ORPCModule.forRoot and serves the oRPC contract route /health/ping (2/2 pass); a live boot with `node --import @swc-node/register/esm-register src/main.ts` initialised ORPCModule, DbModule (Drizzle) and served both /health and /health/ping with HTTP 200; `@dos/worker` (imports PgBoss from pg-boss) typechecks. pg-boss and Drizzle are themselves ESM packages with no Nest peer dependency, so "on ESM Nest 12" is not a real compatibility axis for them. The repo's own docs/adr/0011-nestjs-12-with-11-fallback.md already records "The skeleton already runs Nest 12 +

## REFUTED (confidence high) — Postgres LISTEN/NOTIFY fan-out and the PowerSync logical-replication slot both require direct (non-pooled) connections, so RDS Proxy in transaction mode would be bypassed by them anyway; transaction-local set_config(...,

The decision D11 (no RDS Proxy at pilot; direct connections for the notifier and the replication slot) survives, but two of the four factual legs of the stated rationale are wrong and a third is understated, and the SYNTHESIS §11 hedge "adopt transaction-mode pooling only above ~3 API tasks, after verifying it does not pin connections on set_config(..., true)" is already answered by AWS's own documentation: it pins.

1. set_config(..., true) is NOT RDS-Proxy-safe (the load-bearing error). AWS's pinning page lists, for PostgreSQL: "Using SET commands" and "Setting a parameter, or resetting a parameter to its default. Specifically, using SET and set_config commands"; it states "for PostgreSQL setting a variable leads to session pinning"; the SET LOCAL exemption ("RDS Proxy does not pin connections when you use SET LOCAL") appears only under the MySQL/MariaDB section; and the RDS Proxy limitations page says "RDS Proxy doesn't support session pinning filters for PostgreSQL". Once pinned, "each later transaction uses the same underlying database connection until the session ends". So with ADR 0002's TxManager (set_config at the start of every transaction) every API connection would pin on its first request and RDS Proxy degrades to a 1:1 pass-through with zero multiplexing benefit at ANY task count. Prisma's AWS caveats page documents the same effect for prepared statements ("no benefit in using it for connection pooling"). The correct statement is: transaction-local set_config is

## REFUTED (confidence high) — PowerSync Cloud pricing: Free tier caps at 50 peak clients and 2 GB/month synced; Pro is $49/month for 1,000 clients then $30 per 1,000 additional peak clients. This is why the plan keeps retailers OFF PowerSync (online-

Split verdict. The price numbers are CONFIRMED verbatim on the live pricing page (fetched 2026-09-04): Free = "Up to 50 peak concurrent clients", "Up to 2 GB data synced / month", 500 MB hosted, 2 instances; Pro = "From $49/month", "1,000 peak concurrent clients included. Then $30 per 1,000", 30 GB synced then $1/GB, 2 instances then $25/instance; Team from $599. The inference built on those numbers ("this is why retailers are off PowerSync" and "~$250 not ~$450+") is REFUTED on three points.

1. Wrong metric. Billing is on PEAK CONCURRENT clients, not enrolled clients/devices. PowerSync's billing FAQ: "A concurrent client is an active SDK sync connection to the PowerSync Service" ... "not necessarily your total number of users or app installations" ... "peak concurrent clients, which is the highest number of simultaneously connected clients during the billing cycle." PowerSync's own pricing example assumes "Daily Active Users (DAUs) are 10% of total app installations" and "Peak concurrent clients are 10% of DAUs", i.e. peak concurrent = 1% of installs. SYNTHESIS.md (line 46, D2 line 599) treats Tarsun's ~150 retailers as 150 clients ("break Free during the pilot") and 100 tenants as "~15,000 clients" (implied +$450). Under PowerSync's definition, 15,000 enrolled retailers who open the app a few times a week would peak at roughly 150 concurrent (PowerSync's ratio) to maybe 1,500 (10x pessimistic); the client overage would be $0 to $60/month in whole 1,000-blocks (the pricing

## REFUTED (confidence high) — PowerSync Cloud pricing: Free tier caps at 50 peak clients and 2 GB/month synced; Pro is $49/month for 1,000 clients then $30 per 1,000 additional peak clients. This is why the plan keeps retailers OFF PowerSync (online-

THE FOUR DOLLAR FIGURES ARE CORRECT (verified live on https://www.powersync.com/pricing on 2026-09-04): Free = 50 peak concurrent clients + 2 GB synced/mo; Pro from $49 with 1,000 peak clients then $30/1,000. What is refuted is the causal half of the claim ("this is why") and the ~$450+ counterfactual, because the plan applies the wrong billing metric.

1. WRONG METRIC. PowerSync bills PEAK CONCURRENT clients, defined verbatim as "1 user device running an app using PowerSync = 1 concurrent client while that user is online". SYNTHESIS.md line 46 and decision D2 (line 599) count installed base instead: "Tarsun's ~150 retailers alone break Free", "100 tenants would be ~15,000 clients". A kirana owner opens an ordering surface for a few minutes every 2-3 orders (CONTEXT: retailers pay every 2-3 orders, order via WhatsApp deep link). Realistic peak concurrency for retailer installs is 3-10%. 150 retailers = 5-15 concurrent, plus ~10 staff devices = ~25, comfortably inside Free's 50. 15,000 retailers at 100 tenants = ~450-1,500 concurrent, plus ~800-1,200 staff = ~1,300-2,700 peak: Pro $49 + $30-60. The "$450+" figure is 15,000 installs priced as 15,000 simultaneous clients ($49 + 14 x $30 = $469). Realistic with-retailers PowerSync line at 100 tenants is ~$300-350 including extra synced/hosted GB; the honest delta versus staff-only is ~$50-100/month, not $200+. A decision resting on that delta is resting on nothing.

2. THE ~$250 STAFF-ONLY LINE IS SAFE BUT ITS RATIONALE IS ALSO I

## REFUTED (confidence high) — TallyPrime imports via XML file (masters + vouchers) or HTTP POST to port 9000 only while Tally is open with the company loaded; a stable <GUID> per voucher prevents double-posting; a voucher that is a paisa out of balan

Four of the five sub-claims are supported by Tally's own documentation; the idempotency sub-claim is wrong as stated, and it is the one that carries the reliability guarantee, so the bundled claim is refuted/weakened.

SUPPORTED. (1) Transport: Tally's prerequisites page says "TallyPrime must be running on a specific port (for example: 9000)" and "At least one company must be loaded in Tally"; the XML-integration page says "Enable the HTTP Server. The default port is 9000" and "External applications can post XML to this endpoint: http://<Tally-IP>:9000"; file import is Alt+O (Import) > Masters/Transactions, and Tally recommends masters first. (2) Balance: the official Import FAQ states "Voucher totals do not match: This error appears when the total of Debit and Credit amount is not equal in a voucher. Ensure that the total of the Debit and Credit amount is equal." The errored voucher is counted under ERRORS in IMPORTRESULT / logged in tally.imp and not created; no tolerance exists, and Tally's interactive auto-round-off does not run on XML import, so an explicit Round Off ledger line is the right design. One vendor blog (TrulyInvoice) claims an unbalanced voucher is "imported but marked out-of-balance"; that contradicts Tally's docs and the Appycodes source, so I discount it. (3) Free goods: official help confirms F11 "Use separate Actual and Billed Quantity columns in invoices" — "The total amount calculated is based on the billed quantity" while stock moves on actual quanti

## REFUTED (confidence medium) — TallyPrime imports via XML file (masters + vouchers) or HTTP POST to port 9000 only while Tally is open with the company loaded; a stable <GUID> per voucher prevents double-posting; a voucher that is a paisa out of balan

Verdict: the feature is feasible for one developer (it is a small, well-trodden export; ~1.5 weeks inside the weeks 13-15 slice, and the data it needs already exists in /Users/prajwalchavan/Desktop/Distribution OS/backend/db/src/schema/billing.ts: round_off_paise, free_qty_pcs, batch_no, lot_id, source, external_invoice_no). But the claim as a recipe is refuted on its one load-bearing safety point and misleading on two others; built literally it would double-post the CA's books on a re-import or be rejected by the CA for modelling stock he does not keep.

Sub-claim by sub-claim:

1. Transport (file import via Gateway of Tally > Import, or HTTP POST to the port set in Advanced Configuration, default 9000, answering only while TallyPrime is open with the company loaded): CORRECT, and XML is the lowest common denominator (works on Tally.ERP 9 and every TallyPrime release; Excel import needs Prime 4.0+, JSON 7.0+). The file path is the right pilot choice.
2. "A stable <GUID> prevents double-posting": NOT SUPPORTED as stated. Tally's own Import FAQ documents an import-time option "Overwrite voucher when a voucher with same GUID exists: Yes/No" — i.e. dedupe is conditional on a prompt the CA answers at import, and the documented context is Tally-generated GUIDs. Integration vendors who do this for a living (eCom2Tally/Excel2Tally, Shweta Softwares) state "Voucher number is the only check point for Tally when importing from XML" and recommend a voucher type with Manual numbering + "P

## Holds (confidence high) — An issued GST tax invoice (numbered in its series, printed, possibly e-way-billed) cannot be regenerated with different quantities; delivery shortfalls and returns must be handled by credit notes at the original tax rate

VERDICT: the design (D15) stands and is the cheaper path for one developer, but the legal premise is overstated for the pilot and the plan is missing five pieces without which it breaks at Tarsun.

1. Legal premise is overstated for Tarsun's actual bills. Tarsun's retailers are unregistered (invoices E, F in CONTEXT), so retailer invoices carry no IRN (e-invoicing is B2B-only and only above 5 crore AATO) and sit far below the 1 lakh intra-Maharashtra e-way threshold (R09 line 128). No external registry locks the document. GSTR-1 reports B2C-small supplies only as net values per rate plus a document count with a cancelled count (Table 13); Rule 46(b) only requires a consecutive number unique per FY, in one or multiple series. Cancelling a numbered invoice within the tax period is legal and routine, and Marg/Tally/Busy users edit bills daily. The hard immutability the claim leans on exists only once an IRN is registered (24-hour cancel window, number never reusable, R05 line 107) or after GSTR-1 is filed. The conclusion still holds for better reasons: ADR 0004 already makes invoices immutable for the money ledger, the Tally export needs one stable GUID per voucher (R02 line 238), and the Too Yumm brand DMS already forces exactly this behaviour on Tarsun (invoice E: SO number to IN number, returns as credit notes). Reword the rationale from "GST forbids it" to "the ledger, the CA and the brand DMS all need it, and it becomes mandatory the day IRNs apply".

2. Solo-dev feasibilit

## Holds (confidence high) — Claude Sonnet 5 supports json_schema structured outputs, high-res vision at 2,576 px long edge (~4,784 tokens/page), and requests with more than 20 images drop to a 2,000 px per-image cap; modelled cost ~$0.029 (~Rs 2.4)

API facts verified against live Anthropic docs on 2026-09-04: structured outputs (output_config.format json_schema) are GA on claude-sonnet-5 with the constraints R06 lists; the high-resolution tier ("Claude 4.7 and later") is 2,576 px long edge / 4,784 visual tokens with cost = ceil(w/28)*ceil(h/28); >20 image blocks per request imposes a 2,000 px per-image limit, but over-limit images are REJECTED with invalid_request_error, not downscaled (the synthesis's "split with a continuity check" is unnecessary — just resize to 2,000 px when pages > 20); Sonnet 5 is $2/$10/$0.20; Start-tier rate limits (1,000 RPM, 2M ITPM, 400k OTPM) are not a constraint. Bounding boxes via structured outputs are documented with a reference resize helper.

Benchmarks are real but thin: the BusinessWareTech corpus is ~20 Western invoices (2006–2020); the March 2026 run tested Claude Sonnet 4.5 (90.27%) vs Gemini 3 Pro (94.75%) — one invoice's worth of gap, no Sonnet 5, no Indian layouts; the handwriting number (70.34% vs 88.19%) is "handwritten forms" with Claude version and corpus unstated. "Choose by eval" is the right conclusion, but the reason is that no benchmark contains Tally/SAP/brand-DMS layouts, not that Gemini leads.

Where the claim is weakened and where the plan built on it would fail at Tarsun:

1. The $0.029/page cost is 2–3x low for the schema R06 §8 specifies. It assumes 1,800 output tokens/page; the per-line schema (22 raw + 9 normalised + 5 confidence + verbatim row_text) measures ~

## Holds (confidence high) — Expo SDK 57 (RN 0.86) is New-Architecture-only; @powersync/react-native 2.2 uses op-sqlite as its default driver and requires a development build (not Expo Go); expo-background-task schedules at >= 15-minute inexact inte

Tried to refute each of the four factual components against primary sources; all survive.

1. Expo SDK 57 = RN 0.86, New Arch only. Expo's SDK 57 changelog (30 Jun 2026): "SDK 57 upgrades React Native from 0.85 to 0.86." Expo's New Architecture guide: "SDK 55 and later run entirely on the New Architecture. The New Architecture is always enabled and cannot be disabled" and "Starting with React Native 0.82, the option to disable the New Architecture was removed"; "SDK 54 is the last SDK version where the New Architecture can be disabled." The repo already pins expo ~57.0.19 / react-native 0.86.3 (frontend/apps/team/package.json). CONFIRMED.

2. @powersync/react-native 2.2 uses op-sqlite by default. npm registry: 2.2.0 published 2026-09-02, peerDependencies "@op-engineering/op-sqlite": ">=17.1.0 <19.0.0"; the old "@journeyapps/react-native-quick-sqlite" peer is gone (last 1.x, 1.35.10, still had it as optional). Package CHANGELOG 2.0.0 (21 Jul 2026): "Remove support for React Native Quick SQLite (RNQS). Additionally, OPSqliteOpenFactory is now the default and part of the @powersync/react-native package." CONFIRMED, with the nuance that the switch happened at 2.0.0, not 2.2; 2.2.0 added requestCheckpoint()/checkpointMode:'requests' and experimental Swift Package Manager builds (the SPM path needs RN 0.87+, which is opt-in and irrelevant to RN 0.86).

3. Requires a development build, not Expo Go. PowerSync RN docs: "Our native database adapter is not compatible with Expo Go's sand

## Holds (confidence high) — Expo SDK 57 (RN 0.86) is New-Architecture-only; @powersync/react-native 2.2 uses op-sqlite as its default driver and requires a development build (not Expo Go); expo-background-task schedules at >= 15-minute inexact inte

All three factual parts hold against primary sources, so the claim is NOT refuted; but one parenthetical is overstated and, as a plan input, the claim omits the things that actually decide solo feasibility.

VERIFIED FACTS

1. New-Arch-only: the installed RN 0.86.3 (node_modules/react-native/scripts/react_native_pods.rb) unconditionally sets RCT_NEW_ARCH_ENABLED=1, defaults RCT_REMOVE_LEGACY_ARCH=1, and prints "Calling pod install with RCT_NEW_ARCH_ENABLED=0 is not supported anymore since React Native 0.82". Expo's changelog: legacy arch removed from SDK 55+. Every native dep in the plan (react-native-maps 1.27.2 bundled, expo-* 57.x, op-sqlite 18.x with codegenConfig TurboModule, Reanimated 4/worklets in the template) is New-Arch compatible, so this is a constraint, not a blocker.
2. PowerSync + op-sqlite + dev build: npm shows @powersync/react-native 2.2.0 published 2026-09-02 (2.0.0 on 2026-07-21) with peerDependency "@op-engineering/op-sqlite": ">=17.1.0 <19.0.0"; the README install line is `npx expo install @powersync/react-native @op-engineering/op-sqlite`. op-sqlite docs: "You cannot use this library on a expo-go app, you need to pre-build your app." PowerSync docs: the native adapter "is not compatible with Expo Go's sandbox". The package ships a small native piece (loads powersync-sqlite-core 0.5.2 into op-sqlite) with both CocoaPods and SwiftPM wiring for RN 0.86.
3. expo-background-task: typings in 57.0.16 say "The minimum interval is 15 minutes… Tasks won't run exa

## Holds (confidence high) — Postgres LISTEN/NOTIFY fan-out and the PowerSync logical-replication slot both require direct (non-pooled) connections, so RDS Proxy in transaction mode would be bypassed by them anyway; transaction-local set_config(...,

VERDICT: the decision (no RDS Proxy at pilot, direct connections for the notifier and the slot, transaction-local set_config as the tenancy mechanism) is correct and is the right amount of engineering for one person. Two premises are wrong, and one of them matters: (a) RDS Proxy is not "unnecessary below ~3-4 tasks and adopt-later"; per AWS's own documentation it is incompatible with ADR 0002 at any task count, so the plan's "verify later" item (D11: "after verifying it does not pin connections on set_config(..., true)") already has its answer. (b) "~3-4 API tasks" is the wrong unit and, with library-default pool sizes, optimistic; the real limit is a connection budget on a 2 GiB instance, and it is reachable at TWO api tasks during a blue/green deploy.

SUB-CLAIM CHECK AGAINST PRIMARY SOURCES

1. LISTEN needs a dedicated connection: TRUE. PgBouncer's feature map lists LISTEN as "Never" under transaction pooling (NOTIFY is "Yes", so the app can NOTIFY through a pooler; only the listener needs its own connection). AWS lists "Listening on a notification channel" as a PostgreSQL pinning condition; a pinned connection is "the same underlying database connection until the session ends", i.e. a direct connection in effect. The plan's one dedicated LISTEN connection per api task (§9, line 370) is right.
2. The replication slot needs a direct connection: TRUE. AWS: "RDS Proxy currently doesn't support streaming replication mode" (logical replication rides the streaming-replication pro

## Holds (confidence high) — PowerSync self-hosted Open Edition has no dashboard and no custom write checkpoints, and the service licence is FSL-1.1 converting to Apache-2.0; therefore self-hosting is treated as a residency-forced exit only, not a c

Every factual sub-claim checks out against first-party sources, and the conclusion (Cloud Pro at ~10 tenants, self-host only under a residency demand) survives on economics — but two of the three stated premises do not actually support the "therefore", and one material fact is missing.

VERIFIED FACTS

1. No dashboard when self-hosting: docs say "The PowerSync Dashboard is currently not available when self-hosting PowerSync" (self-hosting/getting-started); pricing page lists Open Edition as "No dashboard, custom write checkpoints, or SLA support", with "Dashboard support planned" only for Enterprise Self-Hosted.
2. No custom write checkpoints in Open Edition: pricing page confirms; docs say "Custom Write Checkpoints are available for customers on our Team and Enterprise plans."
3. Licence: powersync-service LICENSE is FSL-1.1-ALv2, licensor Journey Mobile, Inc., with an irrevocable Apache-2.0 grant "effective on the second anniversary of the date we make the Software available" (per release).
4. Open Edition includes "Partial sync with Sync Streams" (pricing page), so the plan's Sync-Streams design is not functionally blocked by self-hosting. Postgres can be used as bucket storage (service ≥ 1.3.8) and can share the source server on PG ≥ 14 ("The source database and bucket storage database can be on the same server", "may lead to higher CPU usage").

WHERE THE REASONING IS WRONG
A. Custom write checkpoints are a non-differentiator for this plan. They are Team ($599+)/Enterpris

## Holds (confidence high) — PowerSync self-hosted Open Edition has no dashboard and no custom write checkpoints, and the service licence is FSL-1.1 converting to Apache-2.0; therefore self-hosting is treated as a residency-forced exit only, not a c

VERDICT: the decision (stay on PowerSync Cloud; do not self-host for cost at ~10 tenants) is correct, feasible for one developer, and orthogonal to the Kalyan realities. The stated reasons are mostly wrong or irrelevant, the real reason is missing, and two facts the plan defers to "verify in week 1" can be answered today. So: not refuted, but the reasoning needs replacing and the trigger needs broadening.

FACT CHECK (all fetched 2026-09-04, primary sources):

1. Open Edition: pricing page states "No custom write checkpoints; no dashboard; community support only"; docs: "The PowerSync Dashboard is currently not available when self-hosting PowerSync." TRUE.
2. Licence: powersync-service LICENSE is "Functional Source License, Version 1.1, ALv2 Future License", licensor Journey Mobile, Inc., Apache-2.0 "effective on the second anniversary". TRUE.
3. Custom write checkpoints: "available for customers on our Team and Enterprise plans". TRUE that OE lacks them — but so does Cloud Pro ($49), the plan the synthesis intends to run on. Team is $599/month.

WHY THE "THEREFORE" IS WEAK:
(a) Custom write checkpoints are a non-reason twice over: they are not on Cloud Pro either, so they do not discriminate Cloud from OE at this price; and they solve "uploads persist to intermediate systems before reaching the source database" (data flicker). ADR 0007 / §7.3 commits /sync/upload straight into Postgres in one transaction, exactly the case where standard write checkpoints suffice. Citing it as

## Holds (confidence high) — RDS db.t4g.small Single-AZ in ap-south-1 costs ~$0.042/hour (~$31/month) and logical replication for PowerSync requires rds.logical_replication=1 plus a bounded max_slot_wal_keep_size; a 1 GiB t4g.micro carrying a replic

Every factual component checks out against primary sources fetched today, and the sizing judgment is the right call for a solo founder; the only weaknesses are an under-stated cost line and an unspecified value for the one parameter that actually protects production.

Price (verified): I pulled the AWS Price List bulk CSV for ap-south-1 directly. Row effective 2026-09-01: "$0.042 per RDS db.t4g.small Single-AZ instance hour running PostgreSQL" (SKU YA9RJG9UAYJKR7G8); db.t4g.micro Single-AZ is $0.021. $0.042 x 730 h = $30.66, so "~$31" is correct for the instance alone. It omits 20 GB gp3 at $0.131/GB-month ($2.62), so the honest RDS line is ~$34, and RDS T4g instances run in Unlimited mode: if 24-hour average CPU exceeds the baseline you pay surplus credits at $0.075/vCPU-hour rather than getting throttled. That is the right failure mode for one person (a runaway query becomes a bill, not an outage), but it should be on the alarm list. Delta between micro and small is ~$15/month (about Rs 1,300), i.e. less than one founder-hour.

PowerSync on RDS (verified against docs.powersync.com/installation/database-setup and the AWS logical-replication guide): PowerSync requires rds.logical_replication = 1 in the parameter group, a role with rds_replication plus BYPASSRLS, a publication that must be named "powersync", and the instance must be publicly accessible over IPv4 with a security-group allowlist. AWS documents rds.logical_replication as a static parameter (reboot required) and w

## Holds (confidence high) — RDS db.t4g.small Single-AZ in ap-south-1 costs ~$0.042/hour (~$31/month) and logical replication for PowerSync requires rds.logical_replication=1 plus a bounded max_slot_wal_keep_size; a 1 GiB t4g.micro carrying a replic

Verified against primary sources on 2026-09-04.

1. PRICE — CONFIRMED exactly. I downloaded the AWS Price List bulk CSV for AmazonRDS/ap-south-1 (publication date 2026-09-03, prices effective 2026-09-01). On-demand PostgreSQL rows: db.t4g.micro Single-AZ $0.021/hr (Multi-AZ $0.042); db.t4g.small Single-AZ $0.042/hr (Multi-AZ $0.084); db.t4g.medium $0.084; db.t4g.large $0.167; db.m7g.large $0.240. $0.042 x 730 h = $30.66 ≈ $31. Caveat: that is instance-only. The plan's 20 GB gp3 adds $0.131/GB-mo = $2.62, backup storage beyond the free allocation (= provisioned storage) is $0.095/GB-mo, and db.t4g runs in Unlimited mode so sustained CPU above the 20 %/vCPU baseline is billed per vCPU-hour. Realistic all-in ≈ $34–36/month. (Third-party sites showing $0.032/hr are us-east-1; Mumbai is ~30 % higher, so the SYNTHESIS number is right.)

2. rds.logical_replication = 1 — CONFIRMED. AWS docs: "Set the rds.logical_replication static parameter to 1 ... Reboot the DB instance"; applying it also sets wal_level, max_wal_senders, max_replication_slots, max_connections and "can increase WAL generation". PowerSync's own AWS RDS setup page says the same, requires a publication named `powersync`, a role with `rds_replication` + BYPASSRLS, and that "the instance must be publicly accessible using an IPv4 address" (may be restricted to specific IPs). AWS also warns: "If you set up a logical replication slot and don't read from the slot, data can be written and quickly fill up your DB instance's st

## Holds (confidence high) — The e-invoice QR is an RS256-signed JWT carrying exactly 10 fields (SellerGstin, BuyerGstin, DocNo, DocTyp, DocDt, TotInvVal, ItemCnt, MainHsnCode, Irn, IrnDt), IRN = SHA256(SellerGstin + FY + DocTyp + upper(DocNo)), and

FACTS: verified, not just re-read. I decoded the NIC "QR code procedure" sample JWT locally: header {alg:RS256, kid, x5t, typ:JWT}; payload {iss:"NIC", data:"<stringified JSON>"} whose data object has exactly the 10 named fields. The RS256 signature verifies ("Verified OK" via openssl) against the public key NIC ships in that same PDF. SHA256("37ARZPT4384Q1MT"+"2025-26"+"INV"+"TEST-00DF1") equals the sample IRN; without upper() it does NOT match, so upper() is load-bearing. The NIC generate-IRN v1.03 ItemList schema has no MRP field at all, Discount is an amount (no percentage, no "GST benefit"), PrdDesc is free text ≤300 chars (case size only if the seller embeds "x 90"/"_120"), FreeQty/BchDtls{Nm,ExpDt,WrDt}/AttribDtls are optional. A GRN in this design needs MRP per lot, case size, batch and scheme %, so vision remains mandatory. The claim stands.

SOLO-DEV FEASIBILITY: the QR/IRN half is 2–3 days of zero-dependency code (base64url + JSON.parse twice — note `data` is double-encoded; SHA-256; Node crypto.verify; a committed irp-keys.json). The "structured pull" half is not pilot material: a GSP contract with no public rate card, the owner typing a GST OTP every 30 days, a <6-hour token refresh scheduler, encrypted credentials, and 6 IRPs (NIC1, NIC2, IRIS, Clear, EY, Cygnet) each with rotating keys loaded by JavaScript on NIC's page. The synthesis correctly parks "GST API enrichment" at week 31+, but weeks 9–12 say "docint steps 0–11", which includes step 3 — that wording s

## Holds (confidence high) — The e-invoice QR is an RS256-signed JWT carrying exactly 10 fields (SellerGstin, BuyerGstin, DocNo, DocTyp, DocDt, TotInvVal, ItemCnt, MainHsnCode, Irn, IrnDt), IRN = SHA256(SellerGstin + FY + DocTyp + upper(DocNo)), and

Core claim survives; three details need correction and several implementation gotchas were found.

1. RS256 JWT: CONFIRMED. NIC's Generate-IRN spec says SignedQRCode is "digitally signed using JSON Web Token(JWT) and JSON Web Signature (JWS) with 'SHA256RSA' algorithm". I decoded a real NIC-issued QR JWT from LogiTax's docs: header {"alg":"RS256","kid":"EDC57DE1...","typ":"JWT","x5t":"7cV94..."}. Gotcha A: an older (2020) sample carries alg = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" (non-standard string) — strict JWT libraries (jose) will reject it; verify the JWS with an explicit RSA-SHA256 check keyed by kid/x5t rather than trusting the alg header. Gotcha B: the JWT payload is NOT the 10 fields as claims; it is {"data":"<JSON-encoded string of the 10 fields>","iss":"NIC"} — parse twice. Public keys: NIC publishes production verification keys per "IRN generation period" for e-Invoice1 and e-Invoice2 (einvoice1.gst.gov.in/Others/Publickeys); IRIS IRP publishes its own (current production key valid "Upto 20-06-2026", so a rotation is due/has happened as of Sep 2026). There are six IRPs; key set must cover all, keyed by kid.

2. "Exactly 10 fields": CONFIRMED for current production. Two independent real decoded payloads (LogiTax 2021 CRN, Vayana 2023 INV) contain exactly those 10 keys in that order. Caveat: NIC's official FAQ lists only 8 business parameters and ClearTax docs list 9 (no IrnDt); a 2020-era sample I decoded had 9 keys (no IrnDt) and DocDt in yyyy-MM-dd
