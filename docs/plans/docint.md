# docint — implementation brief

Reference pattern: `backend/libs/core/src/modules/procurement/**` and `backend/libs/core/src/modules/orders/**` (controller / service / mappers / spec / sync). Follow `docs/16-module-implementation-pattern.md` exactly. Everything below reuses column names verbatim from `backend/libs/database/src/schema/docint.ts`, `procurement.ts`, `catalog.ts`, `tenant-catalog.ts`.

**Packages touched**

- `backend/libs/docint` — **NEW workspace package `@dos/docint`**, pure TS + Drizzle + `@anthropic-ai/sdk`, **no Nest decorators** (decision D18, `docs/15`). The worker runs on `tsx`, which emits no `design:paramtypes`, so it can never import `@dos/core`; both `@dos/core` and `@dos/worker` import this package. Add it to `backend/pnpm-workspace.yaml` `packages: - libs/*` (already matched) and add `"@anthropic-ai/sdk"` to the `catalog:` there, then `pnpm install`.
- `backend/libs/contracts/src/docint.ts` + a `docint` block in `permissions.ts` (main session wires `contract.ts` / `index.ts`).
- `backend/libs/core/src/modules/docint/**` — Nest module (controller, services, spec).
- `backend/worker/src/jobs/docint-*.ts` — pg-boss consumers; add `"@dos/docint": "workspace:*"` to `backend/worker/package.json`.
- `backend/libs/database/src/schema/docint.ts` + migrations `0006_docint_pipeline.sql` (drizzle-generated) and `0007_docint_guarantees.sql` (hand-written, appended to `migrations/meta/_journal.json`).
- `backend/libs/database/src/seed-demo/docint.ts` (new file, called from `seed-demo/index.ts`).

---

## 1. Purpose and boundaries

1. **docint owns the inbound-document pipeline and nothing else**: it turns a photograph or PDF into a *reviewed, human-approved* draft of a supplier invoice. It owns `documents`, `document_pages`, `extractions`, `extraction_checks`, `sku_match_candidates`, `review_sessions`, `corrections_log`, `engine_disagreements`, `supplier_aliases` — no other module writes those tables.
2. **It never auto-commits and never touches stock or money.** The only write outside its own tables is one call to `SupplierInvoiceService.create()` (imported from `../procurement/index.js`) at `documents.commit`, which creates a `supplier_invoices` row with `source = 'docint'` and `status` `in_review`/`approved`. Lots, `stock_ledger` `grn` rows, `stock_balances` and `tenant_product_costs` are written later and only by `procurement.grns.post`.
3. **Modules it calls (through exported services only):** `SupplierInvoiceService` (procurement) for the commit; `CatalogService` (catalog) for variant lookup/search inside the SKU cascade; `TenantCatalogService` (tenant-catalog) for supplier resolution. It reads `product_external_codes` / `product_aliases` / `product_variants` / `hsn_rates` through `CatalogService` helpers (`variantSummaryColumns`, `variantSearchPredicate`) rather than ad-hoc joins.
4. **Events out (never direct calls):** `outbox_events` rows with `aggregate_type = 'document'` (`docint.document.submitted|extracted|needs_review|reviewed|failed`) and `aggregate_type = 'supplier_invoice'` (`docint.supplier_invoice.drafted`). The worker relay turns `submitted` into the pg-boss `docint.extract` job and later feeds notifications.
5. **Nothing calls into docint.** Warehouse/GRN screens read `supplier_invoices` (procurement) once the commit has happened; the document id is carried on `supplier_invoices.document_id` (a plain text id — docint is downstream in the FK order).

---

## 2. Endpoints

Role shorthand: **BO** = `owner, manager, accountant` (+ `system` internally, via the existing `BACK_OFFICE` constant in `backend/libs/core/src/platform/authz.ts`). **CAP** = `owner, manager, accountant, warehouse` (a new `DOCINT_CAPTURE` constant in the module; also add `'warehouse'` to `STAFF` in `platform/authz.ts` — it is missing there since migration 0004 added the role). `salesperson`, `delivery` and `retailer` get **no docint procedure at all**; extraction output carries printed purchase rates.

All mutations extend `MutationBase` (`idempotencyKey`) and carry a client UUIDv7 id; all GET inputs use `QueryBoolSchema` / `QueryIntSchema`; every list is `limit` (hard cap ≤ 200/500) + `cursor` (last row id) → `{ items, nextCursor }` (docs/20 rule 3). Every mutation body is `requireRole(...)` → `requireDb(this.db)` → `withTenant(db, ctx, tx => idempotent(tx, input.idempotencyKey, input, …))`.

| procedure path | METHOD /http/path | roles | input fields | output fields | behaviour |
| --- | --- | --- | --- | --- | --- |
| `docint.documents.create` | POST `/docint/documents` | CAP | `idempotencyKey: string`, `id: uuid` (req), `kind: 'supplier_invoice'\|'lorry_receipt'\|'brand_dms_invoice'\|'claim_sheet'\|'pod'\|'other'` (req), `supplierId: uuid?`, `expectedPages: int?`, `capturedAt: iso?`, `note: string(≤200)?` | `{ item: Document }` | Inserts `documents` with `status='uploaded'`, `uploaded_by = ctx.actorId`, `captured_at`, `expected_pages`. No pipeline runs yet. Idempotent replay returns the stored row; a different payload under the same key → 409. |
| `docint.documents.pageUploadUrl` | POST `/docint/documents/{id}/pages/upload-url` | CAP | `idempotencyKey`, `id: uuid` (document), `pageNo: int≥1`, `mimeType: 'image/jpeg'\|'image/png'\|'application/pdf'`, `bytes: int≤15_000_000` | `{ objectKey, uploadUrl: string\|null, method: 'PUT'\|null, headers: Record<string,string>, expiresAt: iso, inline: boolean }` | Storage adapter (`@dos/docint` `createStorage()`). `objectKey = tenant/{tenantId}/docs/{documentId}/page-{pageNo}.{ext}` (docs/05 step 0). S3 driver returns a pre-signed PUT (`inline:false`, docs/20 rule 15); the local dev driver returns `inline:true, uploadUrl:null`, meaning "send the bytes on `addPage`". Does not write `document_pages`. |
| `docint.documents.addPage` | POST `/docint/documents/{id}/pages` | CAP | `idempotencyKey`, `id: uuid` (document), `pageId: uuid` (req), `pageNo: int≥1`, `mimeType`, `bytes: int?`, `width: int?`, `height: int?`, `objectKey: string?`, `contentBase64: string?` (exactly one of the two), `printedPageLabel: string?` ("1 of 5" as printed), `qrDetected: boolean?` | `{ item: DocumentWithPages }` | Writes one `document_pages` row (`object_key`, `mime_type`, `width`, `height`, `bytes`, new `sha256`, `printed_page_label`, `qr_detected`); with `contentBase64` the adapter persists the bytes first. Recomputes `documents.content_hash` = sha256 of the page sha256s in `page_no` order; a collision on `documents_hash_idx` → 409 `CONFLICT` carrying the existing `documentId` (docs/05 "same invoice photographed twice"). Refuses once `status` is beyond `extracting`. |
| `docint.documents.verifyQr` | POST `/docint/documents/{id}/qr` | CAP | `idempotencyKey`, `id: uuid`, `qrText: string(≤4000)` (the RS256 JWT printed in the e-invoice QR) | `{ item: Document, qr: { sellerGstin, buyerGstin, docNo, docTyp, docDt, totInvValPaise, itemCnt, mainHsnCode, irn, irnDt } \| null, duplicate: { supplierInvoiceId?: string, documentId?: string } \| null }` | Decodes the JWT payload, checks the 10 fields (docs/05 step 1), verifies the signature against cached IRP keys by `kid` when `DOCINT_IRP_KEYS` is configured. Sets `qr_payload`, `irn`, `irn_verified`, new `qr_status` (`decoded`/`verified`/`signature_failed`/`mismatched`), and `supplier_id` resolved from `sellerGstin` via `supplier_aliases.gstin` then `suppliers.gstin`. Dedupes on `supplier_invoices.irn` and other `documents.irn` in the tenant → returns `duplicate` and leaves the document alone. Never blocks: a failed signature is amber, not an error. |
| `docint.documents.submit` | POST `/docint/documents/{id}/submit` | CAP | `idempotencyKey`, `id: uuid` | `{ item: Document, jobId: string \| null }` | Capture is closed. Page-completeness check: if `expected_pages` is set (or any `printed_page_label` parses "n of m") and pages are missing → 400 with the missing page numbers, status unchanged. Otherwise `documents.status` `uploaded` → `verifying`, writes an `outbox_events` row `docint.document.submitted`, and enqueues pg-boss `docint.extract`. With `DOCINT_INLINE_JOBS=1` (specs, local demo) the pipeline runs inline in the same request and the response already shows `extracted`/`needs_review`. |
| `docint.documents.list` | GET `/docint/documents` | CAP | `kind?`, `status?`, `supplierId?`, `uploadedBy?`, `from: iso.date?`, `to: iso.date?`, `limit: QueryInt 1–200 = 50`, `cursor?` | `{ items: Document[], nextCursor }` | `documents` newest first (`id desc`), tenant filtered by RLS. **No money field in `Document`** — id, kind, status, supplierId, irn, irnVerified, qrStatus, pageCount, expectedPages, attemptCount, failureCode, committedEntityType/Id, uploadedBy, createdAt. |
| `docint.documents.get` | GET `/docint/documents/{id}` | CAP | `id: uuid` | `{ item: DocumentWithPages }` — document + `pages: [{ id, pageNo, objectKey, mimeType, width, height, bytes, printedPageLabel, qrDetected, readUrl }]` + `checkSummary: { errors, warnings }` + `lock: { reviewerId, reviewerName, lockedUntil } \| null` | `readUrl` is a signed GET from the storage adapter, TTL 10 min (docs/17 A12: the signed-URL procedure checks document kind by role — a `supplier_invoice` page is never served to a non-CAP role, which is also enforced by RLS after the policy change in §3). |
| `docint.documents.reject` | POST `/docint/documents/{id}/reject` | BO | `idempotencyKey`, `id: uuid`, `reason: 'duplicate'\|'unreadable'\|'not_ours'\|'wrong_buyer_gstin'\|'other'`, `note: string(≤200)?` | `{ item: Document }` | `status` → `rejected`, new `rejected_reason`; flips any `open` `review_sessions` row to `abandoned`. Refuses when `status = 'committed'` (a committed document is corrected by a credit note, never by rejection). |
| `docint.extractions.run` | POST `/docint/documents/{id}/extract` | BO | `idempotencyKey`, `id: uuid`, `engine: 'llm_vision'\|'llm_vision_secondary'\|'template'?` (default `llm_vision`), `force: boolean = false` | `{ item: Document, jobId: string \| null }` | Retry / escalate by hand. Increments `documents.attempt_count`, sets `status='extracting'`, enqueues `docint.extract` (or `docint.escalate` for `llm_vision_secondary`). Refuses while a `review_sessions` row is `open` or `status='committed'`; `force` is required to re-extract a document that already has an extraction. |
| `docint.extractions.list` | GET `/docint/documents/{id}/extractions` | **BO only** | `id: uuid`, `includeResult: QueryBool = false` | `{ items: Extraction[] }` where `Extraction = { id, engine, model, promptVersion, confidence, costPaise, latencyMs, invoiceNo, invoiceDate, supplierGstin, buyerGstin, totalPaise, lineCount, createdAt, checks: ExtractionCheck[], result?: ExtractedInvoice }` | Carries printed rates → back office only, matching `tenantRolePolicy('extractions_back_office', BACK_OFFICE_ROLES)`. `checks` come from `extraction_checks` (`check`, `passed`, `severity`, new `line_no`, `detail`). |
| `docint.matches.list` | GET `/docint/extractions/{extractionId}/candidates` | BO | `extractionId: uuid`, `lineNo: QueryInt?`, `limit: QueryInt 1–500 = 200` | `{ items: [{ id, lineNo, variantId, variantName, brandName, netQty, netUnit, defaultCaseSize, mrpPaise, score, reason, chosen, matchedBy }] }` | `sku_match_candidates` for the extraction, ordered `line_no asc, score desc`; joined to `product_variants` through `CatalogService`. `reason` is the cascade step that produced it (`supplier_alias`, `external_code`, `ean`, `hsn_brand_mrp`, `trgm`, `reviewer`). |
| `docint.matches.choose` | POST `/docint/extractions/{id}/lines/{lineNo}/match` | BO | `idempotencyKey`, `id: uuid` (extraction), `lineNo: int`, `variantId: uuid`, `pcsPerCase: int?`, `rememberAlias: boolean = true` | `{ items: SkuCandidate[] }` (the line's candidates after the change) | Sets `chosen = true` on the chosen `sku_match_candidates` row (inserting it with `score = 1`, `reason = 'reviewer'`, new `matched_by = 'reviewer'` when the reviewer picked something outside the candidate set) and `false` on the rest of that `line_no`. Upserts `supplier_pack_configs` on `(tenant_id, supplier_id, variant_id)` with `pcs_per_case` (`pcsPerCase` else the parsed pack size else `product_variants.default_case_size`), `supplier_code`, `supplier_description` — exactly as `SupplierInvoiceService.matchLine` does. When `rememberAlias`, upserts `supplier_aliases` on `(tenant_id, normalized)` and bumps its new `hits`. Writes a `corrections_log` row when a session is open. `product_aliases` is **global and curator-only** — never written from here. |
| `docint.matches.rerun` | POST `/docint/extractions/{id}/rematch` | BO | `idempotencyKey`, `id: uuid` | `{ green: int, amber: int, red: int }` | Re-runs the SKU cascade for every `line_no` that has no `chosen` candidate (used right after `catalog.propose` creates a missing product). Upserts candidates through the new unique index; never disturbs a `chosen` line. |
| `docint.review.start` | POST `/docint/documents/{id}/review` | BO | `idempotencyKey`, `id: uuid` (document), `sessionId: uuid` (req), `baseExtractionId: uuid?` | `{ session: ReviewSession }` where `ReviewSession = { id, documentId, reviewerId, baseExtractionId, status, lockedUntil, editsCount, reviewed: ReviewedInvoice, checks: ExtractionCheck[], blocking: int, threeWayMatch: { poCases, lrPackages, gateCount } \| null }` | Single-writer lock (docs/05 step 10). If an `open` row exists with `locked_until > now()` and a different `reviewer_id` → 409 with the holder's name (the second manager sees read-only). A stale `open` row (`locked_until <= now()`) is flipped to `abandoned` first so `review_sessions_open_idx` admits the new row. `reviewed` is seeded by merging the best `extractions.result` with the `chosen` candidates and the pack-size normalisation. `documents.status` → `needs_review`. |
| `docint.review.heartbeat` | POST `/docint/review-sessions/{id}/heartbeat` | BO | `idempotencyKey` (fresh per beat), `id: uuid` | `{ lockedUntil: iso }` | Extends `locked_until` by `DOCINT_LOCK_TTL_SECONDS` (default 300) and stamps new `heartbeat_at`. Refuses (403) when `reviewer_id ≠ ctx.actorId` or the session is not `open`. |
| `docint.review.save` | POST `/docint/review-sessions/{id}` | BO | `idempotencyKey`, `id: uuid`, `patch: { header?: {...}, lines?: [{ lineNo, description?, variantId?, hsnCode?, batchNo?, mfgDate?, expiryDate?, mrpPaise?, printedQty?, printedUnit?, caseSize?, qtyPcs?, freeQtyPcs?, ratePaise?, rateBasis?, basisQty?, discountBps?, discountPaise?, gstBps?, cessBps?, taxablePaise?, taxPaise?, lineTotalPaise? }], annotations?: [{ id, applied: boolean }] }` (lines ≤ 500) | `{ session: ReviewSession, checks: ExtractionCheck[], blocking: int }` | Merges the patch into `review_sessions.reviewed`, writes **one `corrections_log` row per changed JSON path** (`path` like `lines[3].qtyPcs`, `before`, `after`) and bumps new `edits_count`. Re-runs the pure validators over the merged document and replaces the `extraction_checks` rows whose `check` starts `review.` (the engine's own checks are kept for the eval). Handwritten annotations are recorded as applied/dismissed and **never overwrite a printed value silently**. Refuses when the lock is not the actor's or the session is not `open`. |
| `docint.review.release` | POST `/docint/review-sessions/{id}/release` | BO | `idempotencyKey`, `id: uuid` | `{ session: ReviewSession }` | Session `open` → `abandoned`; `documents.status` falls back to `extracted`. Lets another manager take the document. |
| `docint.review.submit` | POST `/docint/review-sessions/{id}/submit` | BO | `idempotencyKey`, `id: uuid` | `{ session: ReviewSession, checks: ExtractionCheck[], blocking: int }` | Final validation. Refuses with 400 while **any** check has `passed=false AND severity='error'` (commit is disabled while a red remains — docs/05 step 10). Sets `status='submitted'`, `submitted_at`, `documents.status='reviewed'`, writes outbox `docint.document.reviewed`. Creates **no** supplier invoice: committing stays a separate deliberate action. |
| `docint.documents.commit` | POST `/docint/documents/{id}/commit` | BO | `idempotencyKey`, `id: uuid` (document), `supplierInvoiceId: uuid` (req, the row to create), `supplierId: uuid`, `purchaseOrderId: uuid?`, `lineIds: [{ lineNo: int, id: uuid }]` (client ids for `supplier_invoice_lines`) | `{ item: Document, supplierInvoice: SupplierInvoiceWithLines }` | Only from `documents.status='reviewed'`. Maps the submitted `reviewed` payload onto `CreateSupplierInvoiceInput` (`source: 'docint'`, `documentId: id`, header + lines with `rate_basis`/`basis_qty` from the printed rate — docs/17 A4) and calls `SupplierInvoiceService.create()` **inside the same `withTenant` transaction**, so its header-total check (`Σ lineTotalPaise + freight + roundOff = totalPaise`) and IRN/(supplier, no, date) duplicate refusal apply unchanged. Then sets `committed_entity_type='supplier_invoice'`, `committed_entity_id`, `committed_at`, `status='committed'`, upserts `supplier_aliases`/`supplier_pack_configs`, and writes outbox `docint.supplier_invoice.drafted`. **Writes no stock ledger row, no lot, no cost, no journal** — `procurement.grns.open → count → post` does all of that. Idempotent on the document id: a replay returns the same supplier invoice. |
| `docint.queue.list` | GET `/docint/queue` | **BO only** | `status: 'extracted'\|'needs_review'\|'reviewed'\|'failed'?`, `supplierId?`, `limit: QueryInt 1–200 = 50`, `cursor?` | `{ items: [{ documentId, kind, status, supplierId, supplierName, invoiceNo, invoiceDate, totalPaise, lineCount, redCount, amberCount, unmatchedLines, irnVerified, qrStatus, ageMinutes, lockedByUserId, lockedByName }], nextCursor }` | The manager's inbound worklist. Joins `documents` to the newest `extractions` row (new denormalised `invoice_no` / `invoice_date` / `total_paise` / `line_count` columns keep it index-only) plus counts from `extraction_checks` and `sku_match_candidates`. Carries totals → back office only. |
| `docint.stats.summary` | GET `/docint/stats` | BO | `from: iso.date`, `to: iso.date`, `supplierId?` | `{ documents, committed, rejected, failed, escalated, avgLatencyMs, p95LatencyMs, costPaise, editsPerDocument, editsPerTenLines, bySupplier: [{ supplierId, supplierName, documents, editsPerTenLines, failureRate }] }` | The docs/11 alarm surface and the docs/17 acceptance metric (line recall ≥ 98 %, ≤ 1.5 edits per 10-line invoice). Reads `extractions.cost_paise`/`latency_ms` and `review_sessions.edits_count`. Bounded by the date range; hard-capped at 400 supplier rows. |

**Service wiring (main session only).** `contractKeys: [... 'docint']` and `modules: [... DocintModule]` in `backend/owner-service/src/service.ts` and `backend/manager-service/src/service.ts`; `backend/warehouse-service/src/service.ts` also gets the module (its role list becomes `['warehouse']`), and `TenantGuard` + the per-procedure permission matrix answer 403 for the review/extraction procedures there. `sales`, `delivery`, `retailer` services do **not** list docint.

**`backend/libs/contracts/src/permissions.ts` block:**

```
'docint.documents.create'      : ['owner','manager','accountant','warehouse']
'docint.documents.pageUploadUrl': ['owner','manager','accountant','warehouse']
'docint.documents.addPage'     : ['owner','manager','accountant','warehouse']
'docint.documents.verifyQr'    : ['owner','manager','accountant','warehouse']
'docint.documents.submit'      : ['owner','manager','accountant','warehouse']
'docint.documents.list'        : ['owner','manager','accountant','warehouse']
'docint.documents.get'         : ['owner','manager','accountant','warehouse']
'docint.documents.reject'      : ['owner','manager','accountant']
'docint.documents.commit'      : ['owner','manager','accountant']
'docint.extractions.run'       : ['owner','manager','accountant']
'docint.extractions.list'      : ['owner','manager','accountant']
'docint.matches.list'          : ['owner','manager','accountant']
'docint.matches.choose'        : ['owner','manager','accountant']
'docint.matches.rerun'         : ['owner','manager','accountant']
'docint.review.start'          : ['owner','manager','accountant']
'docint.review.heartbeat'      : ['owner','manager','accountant']
'docint.review.save'           : ['owner','manager','accountant']
'docint.review.release'        : ['owner','manager','accountant']
'docint.review.submit'         : ['owner','manager','accountant']
'docint.queue.list'            : ['owner','manager','accountant']
'docint.stats.summary'         : ['owner','manager','accountant']
```

---

## 3. Schema changes needed

Migrations are expand-only from now: generate `0006_docint_pipeline.sql` with `pnpm db:generate` after editing `backend/libs/database/src/schema/docint.ts`, then hand-write `0007_docint_guarantees.sql` and append **both** to `migrations/meta/_journal.json` (next `idx` 6 and 7, `version: "7"`). No new tables → no new FORCE-RLS lines and no new GRANTs are strictly required, but keep the existing FORCE lines intact.

### 3a. `documents` — new columns and one new enum

```ts
export const documentQrStatus = pgEnum('document_qr_status', [
  'absent', 'decoded', 'verified', 'signature_failed', 'mismatched',
])
```

| column | type | why |
| --- | --- | --- |
| `expected_pages` | `integer` | "1 of 5" printed on the page; the missing-pages red check (docs/05 §5.1). |
| `captured_at` | `timestamptz` | device capture time, distinct from `created_at` (offline capture). |
| `note` | `text` | reviewer note at capture. |
| `rejected_reason` | `text` | `documents.reject`. |
| `attempt_count` | `integer NOT NULL DEFAULT 0` | pg-boss retry ×3 then `failure_code='extraction_failed'`. |
| `job_id` | `text` | last pg-boss job id, for support. |
| `prompt_profile` | `text` | `tally` / `sap-reliance` / `guiltfree-dms` / `marg-gst-local` / `brand-dms-secondary` (docs/05 step 2). |
| `qr_status` | `document_qr_status NOT NULL DEFAULT 'absent'` | `irn_verified` alone cannot say "signature failed, continue on vision". |

New index: `documents_supplier_idx` on `(tenant_id, supplier_id, created_at)`.

### 3b. `document_pages` — new columns

`sha256 text` (per-page hash feeding `documents.content_hash`), `printed_page_label text`, `qr_detected boolean NOT NULL DEFAULT false`.

### 3c. `extractions` — denormalised header + escalation link

`invoice_no text`, `invoice_date date`, `supplier_gstin text`, `buyer_gstin text`, `total_paise bigint` (use the `paise()` helper), `line_count integer`, `engine_version text`, `escalated_from_extraction_id text` (plain id, self-reference, no FK). New index `extractions_latest_idx` on `(tenant_id, document_id, created_at)`. This is what makes `docint.queue.list` cheap without opening the `result` jsonb, and it stays inside the existing `tenantRolePolicy('extractions_back_office', BACK_OFFICE_ROLES)`.

### 3d. `extraction_checks` — anchor a check to a line

`line_no integer` (null = header/document-level). New index `extraction_checks_failed_idx` on `(tenant_id, extraction_id, passed)`.

### 3e. `sku_match_candidates` — upsertable + eval features

`matched_by text NOT NULL DEFAULT 'auto'` (`auto` | `reviewer`), `features jsonb` (the fusion inputs: alias hit, code hit, hsn prefix, mrp delta, trgm similarity — needed by the week-10 eval). New **unique** index `sku_match_candidates_unique_idx` on `(tenant_id, extraction_id, line_no, variant_id)` so `matches.rerun` can `onConflictDoUpdate`.

### 3f. `review_sessions`

`edits_count integer NOT NULL DEFAULT 0` (the ≤ 1.5-edits acceptance metric), `heartbeat_at timestamptz`.

### 3g. `supplier_aliases`

`hits integer NOT NULL DEFAULT 0`, `last_seen_at timestamptz` — mirrors `product_aliases.hits`, ranks aliases in the cascade.

### 3h. `pg_trgm` — **missing today** (hand-written `0007`)

`grep -rn "CREATE EXTENSION" backend/libs/database/migrations` returns nothing, so the docs/05 step-8 trigram stage has no index to stand on. Add to `0007_docint_guarantees.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_variants_name_trgm_idx" ON "product_variants" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_aliases_normalized_trgm_idx" ON "product_aliases" USING gin ("normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_aliases_normalized_trgm_idx" ON "supplier_aliases" USING gin ("normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_pack_configs_desc_trgm_idx" ON "supplier_pack_configs" USING gin ("supplier_description" gin_trgm_ops);
```

(no pgvector — docs/05 step 8: only if the eval shows the cascade stalls.)

### 3i. RLS policy change (hand-written `0007`) — docs/17 A12

`documents` and `document_pages` currently use `tenantPolicy(...)`, i.e. **any tenant member including `retailer` and `salesperson`** can read a supplier-invoice photo, which is exactly the "purchase price leaks through invoice images" finding. Permissive policies OR together, so the existing policy must be **altered**, not supplemented. In `schema/docint.ts` replace `tenantPolicy('documents_tenant')` with an explicit `pgPolicy` carrying this predicate, and in `0007`:

```sql
ALTER POLICY "documents_tenant" ON "documents" TO app_rw
  USING (tenant_id = (SELECT current_setting('app.tenant_id', true))
     AND (SELECT current_setting('app.actor_role', true)) <> 'retailer'
     AND ((SELECT current_setting('app.actor_role', true)) IN ('owner','manager','accountant','warehouse','system')
          OR kind IN ('pod','claim_sheet','other')))
  WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true))
     AND (SELECT current_setting('app.actor_role', true)) <> 'retailer'
     AND ((SELECT current_setting('app.actor_role', true)) IN ('owner','manager','accountant','warehouse','system')
          OR kind IN ('pod','claim_sheet','other')));--> statement-breakpoint
ALTER POLICY "document_pages_tenant" ON "document_pages" TO app_rw
  USING (tenant_id = (SELECT current_setting('app.tenant_id', true))
     AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_pages.document_id
                   AND d.tenant_id = (SELECT current_setting('app.tenant_id', true))))
  WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true))
     AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_pages.document_id
                   AND d.tenant_id = (SELECT current_setting('app.tenant_id', true))));
```

The `document_pages` `EXISTS` inherits the parent's visibility (a `documents` row the actor cannot see makes the page invisible too) without joining `retailer_identities` — no 42P17 recursion risk. `delivery` keeps POD upload; `salesperson` keeps claim-sheet capture; neither can reach a supplier invoice image.

### 3j. Not changed

`stock_lots.case_size`, `supplier_invoices.document_id`, `supplier_invoice_lines.rate_basis/basis_qty`, `tenant_product_costs.per_piece_cost` all already exist (docs/17 A2/A4). `product_external_codes` and `product_aliases` stay global and curator-writable — docint only reads them.

---

## 4. Domain rules and edge cases

1. **Money is integer paise everywhere on the wire and in the DB** (`PaiseSchema`, `paise()`); quantities are integer pieces (`PiecesSchema`, `pieces()`); percentages are basis points (`BpsSchema`). The LLM returns rupee strings — the adapter converts with `fromRupees()` from `@dos/domain` and never with `parseFloat * 100`.
2. **A printed per-case rate is stored as printed** (docs/17 A4): `rate_paise` + `rate_basis='case'` + `basis_qty = pcs per case`. ₹135.43/case ÷ 12 is not an integer paise, so the per-piece figure lives only in `tenant_product_costs.per_piece_cost numeric(14,4)`, written later by the GRN, never here.
3. **Buy-side pack size is `supplier_pack_configs.pcs_per_case`, never `tenant_products.case_size_override`** (docs/17 B "case size precedence"). Resolution order for a line: parsed from the printed description (`parseCaseSizeFromName()` in `@dos/domain/quantity.ts` — it already handles `x 90`, `_120`, `(16+5.5)`) → existing `supplier_pack_configs` row → `product_variants.default_case_size`. Disagreement between the three → amber check `review.case_size_disagreement` showing all three; the reviewer picks, and that upserts `supplier_pack_configs`. This is the second (and last) number a human is allowed to type.
4. **Validators are pure functions in `@dos/docint`, no DB, no Nest** — GSTIN mod-36 (`isValidGstin()` from `@dos/domain`) with a confusion-set retry (0/O, 1/I, 5/S, 8/B); intra vs inter-state split against `splitGst(taxable, rateBps, supplierStateCode, placeOfSupplyStateCode)`; HSN length 4/6/8 and a dated rate in `hsn_rates` for `invoice_date`; per-line `qty × rate − discount = taxable` and `taxable + tax = lineTotal`; `Σ lines = subtotal`; s.170 rounding within ±₹1 (`roundToRupee()`); `Σ lineTotal + freight + roundOff = total`; page completeness; QR cross-checks (`ItemCnt` = line count, `TotInvVal` within ₹2 of total); IRN hash `SHA256(SellerGstin + FY + DocTyp + upper(DocNo))` when the QR failed. Severity `error` = red (blocks submit), `warn` = amber (does not).
5. **Dates and FY are IST.** `businessDate()` and `financialYear()` from `@dos/domain/calendar.ts` for the invoice's business date and the IRN-hash FY. Never `new Date().toISOString().slice(0,10)`.
6. **No state column is ever assigned by hand.** `documents.status` moves through a machine defined in `@dos/docint` (`uploaded → verifying → extracting → extracted → needs_review → reviewed → committed`, plus `rejected` and `failed` from any non-terminal state) built with `defineMachine()` from `backend/libs/domain/src/state-machines/machine.ts`, alongside the existing order/trip/invoice machines. `review_sessions.status`: `open → submitted | abandoned`.
7. **Nothing auto-commits, ever.** `documents.commit` requires `status='reviewed'`, i.e. a human pressed submit on a session that had zero red checks. `submit` and `commit` are two calls on purpose — one asserts "the reading is right", the other "book it".
8. **Never a second legal invoice** (ADR 0014). A `brand_dms_invoice` document runs steps 0, 4, 5, 8 and commits down a different path: it will create a `sales_orders(source='brand_dms_import', state='packed')` + an `invoices` row in the **external** numbering series carrying the DMS number (`numbering_series.allocation_mode='external'`, docs/17 A5). That commit path belongs to the billing module; in this slice `documents.commit` refuses `kind='brand_dms_invoice'` with `NOT_IMPLEMENTED` and the document stays `reviewed`. Its capture/extraction/review path is fully built and demo-seeded.
9. **Duplicates are blocked, not merged.** The precedence is IRN → `(supplier_id, invoice_no, invoice_date)` → `documents.content_hash`. `SupplierInvoiceService.create()` already returns 409 with the existing `supplierInvoiceId` on the first two; docint surfaces the same as `duplicate` on `verifyQr` and 409 on `addPage`. A "revised copy" is a debit/credit note, never a re-commit.
10. **`BuyerGstin ≠ tenants.gstin` is red, not fatal.** Check `review.buyer_gstin_mismatch` with `severity='error'`; only an `owner`-role reviewer may clear it (branch/consignee case). Record the override in `corrections_log` at path `header.buyerGstin`.
11. **Multiple MRPs for one SKU on one invoice → separate lots.** The commit maps each line to its own `supplier_invoice_lines` row with its own `mrp_paise`/`batch_no`/`expiry_date`; the GRN then creates a `stock_lots` row per `(variant_id, batch_no, mrp)` (`ADR 0003` unique key). Never merge two printed lines because they share a variant.
12. **Batch-tracked lines need `batch_no` + `expiry_date` before submit** (`review.batch_required`, red). Lot identity is batch + MRP + expiry.
13. **A hallucinated line is detectable and must be caught**: missing `evidence.row_text` in the engine output, or `Σ lines ≠ subtotal`, or `ItemCnt` mismatch → red with the row crop. The engine contract therefore *requires* per-line `evidence: { pageNo, rowText, bbox? }`; an extraction without it fails validation before it ever reaches review.
14. **Handwritten annotations never alter a printed value.** They land in `extractions.result.handwritten_annotations[]` and are shown in their own panel; applying one is an explicit reviewer edit and produces a `corrections_log` row.
15. **The LLM adapter is behind one interface with a stub in tests.** `ExtractionEngine = { name, run(input: { pages: PageImage[], profile, hints }): Promise<ExtractedInvoice & { model, promptVersion, costPaise, latencyMs, confidence }> }`. `DOCINT_ENGINE=stub` (default whenever `NODE_ENV=test` or `ANTHROPIC_API_KEY` is unset) returns a fixture keyed by `documents.content_hash` from `docs/fixtures/docint/*.json`; **no spec ever calls the network**. `DOCINT_ENGINE=anthropic` uses `@anthropic-ai/sdk`.
16. **Anthropic call shape** (`backend/libs/docint/src/engines/anthropic.ts`) — `new Anthropic()` (reads `ANTHROPIC_API_KEY`), one request per invoice with every page as a base64 `image` content block at 2,576 px long edge, and **`>20` images drops the cap to 2,000 px, so a longer invoice is split into batches with a continuity check** (docs/05 step 4):
    - `model: process.env.DOCINT_MODEL ?? 'claude-sonnet-5'` — the exact id string, never date-suffixed. Escalation (docs/05 step 7) uses `DOCINT_ESCALATION_MODEL ?? 'claude-opus-5'`.
    - `output_config: { format: { type: 'json_schema', schema: EXTRACTED_INVOICE_JSON_SCHEMA }, effort: 'medium' }` — the **`output_config.format`** shape; the old top-level `output_format` parameter is deprecated. Validate the returned JSON with the Zod schema anyway.
    - `thinking: { type: 'adaptive' }` — on Sonnet 5 `budget_tokens` is rejected with a 400. Do not send `temperature`/`top_p` (also removed on Sonnet 5). Do not use assistant prefill (400).
    - Cache the system prompt + JSON schema: `system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }]`, and assert `usage.cache_read_input_tokens > 0` in the adapter's debug log. Note Sonnet 5 does **not** support mid-conversation `role: 'system'` messages.
    - Stream (`client.messages.stream(...)` + `await stream.finalMessage()`) with `max_tokens: 64000`; a 10-page invoice exceeds the non-streaming HTTP timeout budget.
    - Record `costPaise` from `usage` × the rate in config, `latencyMs`, `model`, `promptVersion` on the `extractions` row. Catch `Anthropic.RateLimitError` / `Anthropic.APIError` by class (never string-match) and rethrow as transient so pg-boss retries.
17. **Capture never blocks.** Every failure mode in docs/05 §5.1 downgrades: QR unreadable → vision only; signature fails → `qr_status='signature_failed'`, amber; structured pull fails → skipped silently; blurry page → amber "retake page n". Only a missing page, a red arithmetic failure, an unmatched SKU, a missing batch or a buyer-GSTIN mismatch blocks the *commit*.
18. **`extraction_failed` is the one place manual typing is allowed** (docs/05) — after 3 attempts the document is `failed` and the manager types the invoice through `procurement.supplierInvoices.create` directly. `docint.stats.summary` counts those so the rate is visible.
19. **Bounded work per request** (docs/20 rule 3): `pages ≤ 20` per document, `lines ≤ 500` per patch, `limit ≤ 200` on lists (500 on candidates), no endpoint loads a whole tenant's document history. Image bytes never pass through the database, and in the S3 driver they never pass through the service either (rule 15).
20. **Concurrency.** The review lock is a row in `review_sessions` guarded by the partial unique index `review_sessions_open_idx`; take it with an `INSERT … ON CONFLICT DO NOTHING` and read back, never with a `SELECT` then `INSERT`. Two managers racing → the loser gets 409 with the holder's name, not a corrupted `reviewed` payload.
21. **What must never happen:** a stock ledger row, a `stock_lots` row, a `tenant_product_costs` row, a `journal_lines` row or a `numbering_series` allocation written from this module; a `salesperson`, `delivery` or `retailer` actor reading `extractions`, `sku_match_candidates`, `review_sessions`, `corrections_log`, `engine_disagreements` or a `supplier_invoice`-kind `documents`/`document_pages` row; a write to the global `product_aliases`/`product_external_codes` from a tenant actor; a commit while any red check stands; a page image or extraction JSON logged at info level (it contains purchase rates).

---

## 5. DB-backed spec list

All in `backend/libs/core/src/modules/docint/docint.spec.ts` (module specs live in core), wrapped in `describeDb`, fixtures keyed by a unique `run = uuidv7().slice(-8)`, booted with `bootTestApp([TenantCatalogModule, CatalogModule, InventoryModule, ProcurementModule, DocintModule])`, `DOCINT_ENGINE=stub`, `DOCINT_INLINE_JOBS=1`. Pure-function specs go in `backend/libs/docint/src/*.test.ts` (no DB).

| spec | asserts |
| --- | --- |
| `create → addPage → submit → extracted` | happy path: `documents.status` walks `uploaded → verifying → extracting → extracted`, three `document_pages` rows exist, one `extractions` row with `engine='llm_vision'`, `model='claude-sonnet-5'`, `line_count = 4`. |
| `submit is idempotent` | the same `idempotencyKey` replayed returns the identical body and creates exactly one `extractions` row and one outbox event. |
| `addPage rejects a duplicate content hash` | a second document whose pages hash the same → 409 carrying the first `documentId`; `documents_hash_idx` is what enforces it. |
| `verifyQr sets irn and finds a duplicate` | valid QR → `irn_verified=true`, `qr_status='verified'`, `supplier_id` resolved from `supplier_aliases.gstin`; a second document with the same IRN → `duplicate.documentId` set and its own `irn` left null. |
| `missing page blocks submit` | `expected_pages=5` with 3 pages → 400 listing pages 4,5; status stays `uploaded`. |
| `validators mark the red checks` | a fixture whose line 3 arithmetic is off by ₹4 and whose total misses by ₹9 → `extraction_checks` has `line_arithmetic` (`line_no=3`, `severity='error'`) and `sum_lines_equals_total` failed; `queue.list` reports `redCount=2`. |
| `SKU cascade tiers` | line 1 matches `supplier_aliases` exact (score ≥ 0.9, `chosen=true`, `matched_by='auto'`), line 2 matches `product_external_codes` on the printed supplier code, line 3 lands amber with 3 trigram candidates and no `chosen`, line 4 red with zero candidates. |
| `matches.choose remembers the pack` | choosing a variant for line 3 upserts `supplier_pack_configs(tenant_id, supplier_id, variant_id)` with `pcs_per_case=120` parsed from `TY!WAFERS ... _120`, bumps `supplier_aliases.hits`, writes a `corrections_log` row, and leaves the global `product_aliases` untouched. |
| `matches.rerun after catalog.propose` | proposing the missing product then `rerun` turns the red line green without disturbing the already-`chosen` lines (unique index upsert, not duplicate rows). |
| `review lock is single-writer` | manager A `review.start` succeeds; manager B gets 409 with A's name; after A `review.release` (or `locked_until` expiry) B succeeds and the stale row is `abandoned`. |
| `review.save logs every correction` | patching `lines[2].qtyPcs` and `lines[3].variantId` writes exactly two `corrections_log` rows with the right `path`/`before`/`after` and sets `review_sessions.edits_count = 2`. |
| `submit refuses while a red stands` | `review.submit` with one failed `severity='error'` check → 400; after the reviewer fixes the line and saves, submit succeeds and `documents.status='reviewed'`. |
| `commit creates the supplier invoice and nothing else` | `documents.commit` → one `supplier_invoices` row (`source='docint'`, `document_id` set, header total check satisfied) + its lines with `rate_basis='case'`/`basis_qty=12`; **zero** rows added to `stock_ledger`, `stock_lots`, `stock_balances`, `tenant_product_costs`, `journal_lines`; `documents.committed_entity_id` set, `status='committed'`. |
| `commit is idempotent and refuses out of state` | replay returns the same `supplierInvoiceId`; committing an `extracted` (not `reviewed`) document → 400; committing a `brand_dms_invoice` → `NOT_IMPLEMENTED`. |
| `commit then GRN posts stock` | `procurement.grns.open/count/post` against the committed invoice writes the `grn` ledger rows — proves the hand-off without docint doing it. |
| `no context → 401` | every procedure called without actor headers/token returns 401. |
| **role: salesperson** | `GET /docint/documents` → 403; a direct `withTenant` select as `salesperson` on `documents` for a `supplier_invoice` row returns **0 rows** (new policy) and on `extractions` returns 0 rows. |
| **role: delivery** | `POST /docint/documents` with `kind='pod'` succeeds under RLS in a raw `withTenant` insert, but `kind='supplier_invoice'` is refused by the policy; the API procedure itself is 403 for `delivery`. |
| **role: retailer** | a `withTenant` select as `retailer` on `documents`, `document_pages`, `extractions`, `sku_match_candidates`, `review_sessions`, `corrections_log`, `engine_disagreements` returns **0 rows in every case**; `POST /docint/documents` → 403. |
| **role: warehouse** | can `create`/`addPage`/`verifyQr`/`submit`/`list`/`get`, and is 403 on `extractions.list`, `matches.*`, `review.*`, `queue.list`, `commit` — the printed-rate surface is back office only. |
| **role: accountant** | full review + commit path succeeds (the CA reviews inbound invoices). |
| **tenant isolation** | tenant B's owner cannot see tenant A's document, pages, extraction or review session (0 rows, not an error). |
| `validators.test.ts` (pure) | GSTIN confusion-set retry, intra/inter split, s.170 ±₹1, IRN hash vector, `ItemCnt` mismatch — golden fixtures from invoices A–G. |
| `packsize.test.ts` (pure) | `x 90` → 90, `_120` → 120, `(16+5.5)` → the promo pack, `CS1` → null, `2 Case` with 180 pcs → 90. |
| `matcher.test.ts` (DB) | the fusion scoring is monotonic and the ≥0.90 / 0.60–0.90 / <0.60 bands land where docs/05 step 8 says. |

Run: `cd backend && DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos pnpm --filter @dos/core test -- src/modules/docint` and `pnpm --filter @dos/docint test`.

---

## 6. Demo data to add in seed-demo

New file `backend/libs/database/src/seed-demo/docint.ts`, exporting `seedDocint(db, tenantId, variants, tenantCatalog, people, stock)`, called from `seed-demo/index.ts` **after** `seedStock` (it references the invoices that file created). Every row uses `demoId('<kind>', key)` and `insertMany` (`onConflictDoNothing`) so the seed stays idempotent. Page bytes: write one 1×1 JPEG per page into `DOCINT_STORAGE_DIR` (default `backend/.storage`) so `readUrl` resolves locally; the directory is gitignored.

For **Tarsun Enterprises** (the existing pilot tenant, suppliers `reliance`, `guruKripa`, `momMakhana`, `guiltfree`, `alansFoods`):

1. **7 `documents` rows.**
   - `doc:reliance-1` — `kind='supplier_invoice'`, supplier reliance, `status='committed'`, `irn_verified=true`, `qr_status='verified'`, `committed_entity_type='supplier_invoice'`, `committed_entity_id = demoId('supplier-invoice','reliance-1')`, `expected_pages=2`, `prompt_profile='sap-reliance'`, uploaded by the manager 9 days ago.
   - `doc:guru-kripa-2` — `status='extracted'`, QR verified, 4 lines all green, zero failing checks → the "ready to review" row in the queue.
   - `doc:guiltfree-2` — `status='needs_review'`, 3 pages, `prompt_profile='guiltfree-dms'`, 4 lines: 2 green, 1 amber (3 candidates, the `_120` pack-size disagreement), 1 red (no match, "create product" case).
   - `doc:mom-makhana-2` — `status='failed'`, `failure_code='extraction_failed'`, `attempt_count=3` — the one place manual typing is allowed.
   - `doc:toyumm-dms-1` — `kind='brand_dms_invoice'`, supplier guiltfree, `status='needs_review'`, 1 page, `prompt_profile='brand-dms-secondary'`.
   - `doc:lr-guiltfree-1` — `kind='lorry_receipt'`, `status='committed'`, linked from the existing `lorry_receipts.document_id`.
   - `doc:pod-ganesh-1` — `kind='pod'`, uploaded by delivery user Ganesh More — exists so the RLS kind rule is visible in the demo data.
2. **13 `document_pages` rows** across those documents (2+4+3+1+1+1+1), `object_key = 'tenant/{tenantId}/docs/{documentId}/page-{n}.jpg'`, `mime_type='image/jpeg'`, `width=2576`, `height=3435`, `sha256` filled, `printed_page_label` `'1 of 2'` etc., `qr_detected=true` on page 1 of the two QR-verified documents.
3. **5 `extractions` rows** — one `engine='qr'` on `doc:reliance-1`; `engine='llm_vision'`, `model='claude-sonnet-5'`, `prompt_version='v1'` on `doc:reliance-1`, `doc:guru-kripa-2`, `doc:guiltfree-2`, `doc:toyumm-dms-1`, with `confidence` 0.93–0.99, `cost_paise` 180–420, `latency_ms` 6,000–14,000, and `result` = the full normalised invoice JSON whose header and line amounts **equal the already-seeded `supplier_invoices` / `supplier_invoice_lines` rows** for the reliance and guru-kripa documents (so the demo is internally consistent). Denormalised `invoice_no`, `invoice_date`, `supplier_gstin`, `buyer_gstin`, `total_paise`, `line_count` filled on every row. One extra `engine='llm_vision_secondary'`, `model='claude-opus-5'` row on `doc:guiltfree-2` with `escalated_from_extraction_id` set.
4. **~48 `extraction_checks` rows** — 10 per extraction (`gstin_checksum`, `gst_split_state`, `hsn_dated_rate`, `line_arithmetic`, `sum_lines_equals_subtotal`, `rounding_section_170`, `page_completeness`, `qr_line_count`, `qr_total`, `irn_hash`), all `passed=true` except on `doc:guiltfree-2`: `line_arithmetic` failed `severity='warn'` `line_no=3` and `pack_size_unknown` failed `severity='error'` `line_no=4`.
5. **~14 `sku_match_candidates` rows** — green lines: 1 candidate each, `score` 0.95–0.99, `reason='supplier_alias'` or `'external_code'`, `chosen=true`, `matched_by='auto'`; the amber line: 3 candidates at 0.72/0.66/0.61, `reason='trgm'`, none chosen; the red line: none.
6. **2 `review_sessions`** — one `status='open'` on `doc:guiltfree-2` held by manager Vikas Kadam, `locked_until = now + 5 min`, `edits_count=3` (demonstrates the "second manager sees read-only" state); one `status='submitted'` on `doc:reliance-1` by the manager with `submitted_at` 9 days ago.
7. **4 `corrections_log` rows** on the submitted session — paths `lines[2].qtyPcs`, `lines[3].variantId`, `lines[3].caseSize`, `header.roundOffPaise`.
8. **1 `engine_disagreements` row** on `doc:guiltfree-2`, `path='lines[2].ratePaise'`, `values={"llm_vision":13543,"llm_vision_secondary":13453}`, `resolved_value=13543`.
9. **5 `supplier_aliases` rows**, one per supplier — e.g. `alias='GURU KRIPA AGENCIES'`, `normalized='gurukripaagencies'`, `gstin` = that supplier's GSTIN, `hits=12`, `last_seen_at` 7 days ago.
10. **Global catalog additions** (curator-owned, seeded on the owner connection): ~8 `product_external_codes` rows tying real printed codes to variants (`system='reliance'` code `494607257` → `campa-cola-750ml`; `system='guiltfree'` codes → the four `too-yumm-*` variants; `system='fieldassist'` "Item ERP Id" → `too-yumm-karare-60g`) and ~10 `product_aliases` rows of printed descriptions (`TY!WAFERS CHILLI 21.5G(16+5.5)_120`, `MOM Makhana 12g - Himalayan Salt N Paper x 90`, `MOM Panchameva 20G Pouch x 144`, …), `source='docint'`, `hits` 3–20.
11. **The other two demo distributors** (the three-distributor requirement in the build log): 2 documents each — one `committed` supplier invoice tied to that tenant's own seeded supplier invoice, one `needs_review` with an amber line — plus 1 `supplier_aliases` row each, so the queue is non-empty in every tenant and cross-tenant isolation is visible in the UI.
12. **Fixtures for the stub engine**: `docs/fixtures/docint/{reliance-1,guru-kripa-2,guiltfree-2,toyumm-dms-1}.json`, keyed by the same `content_hash` the seed writes, so a spec or a local demo can re-run extraction without the network.

---

## 7. Worker jobs / outbox events

**pg-boss queues** (registered in `backend/worker/src/main.ts` next to `OUTBOX_RELAY` / `RETENTION`, consumers in `backend/worker/src/jobs/`; bounded concurrency, docs/20 rule 6):

| queue | payload | behaviour |
| --- | --- | --- |
| `docint.extract` | `{ tenantId, documentId, attempt }` | Reads the document's tenant with `withSystem`, then does all work inside `withTenant(db, { tenantId, actorId: SYSTEM, actorRole: 'system' }, …)`. Steps 1–8 of docs/05: QR re-verify → pre-classify + prompt profile → optional structured pull → engine run → validators → pack-size normalisation → SKU cascade. Writes `extractions`, `extraction_checks`, `sku_match_candidates`; sets `documents.status` `extracted` (no reds) or `needs_review` (any red/amber), writes outbox `docint.document.extracted`. Retry ×3 with exponential backoff; on the final failure sets `status='failed'`, `failure_code='extraction_failed'`, `attempt_count=3` and writes outbox `docint.document.failed`. Concurrency capped (default 4) and keyed per tenant for fairness (docs/20 rule 5). |
| `docint.escalate` | `{ tenantId, documentId, baseExtractionId }` | Enqueued automatically when ≥ 2 `severity='error'` arithmetic checks fail or the page count mismatches (docs/05 step 7). Re-runs on `claude-opus-5`, writes a second `extractions` row with `escalated_from_extraction_id`, keeps whichever version passes more checks as the review base, and writes an `engine_disagreements` row per differing path. |
| `docint.structured_pull` | `{ tenantId, documentId }` | Stub in this slice: logs "no GSP/EWB credentials configured" and completes. Never blocks and never fails the document (docs/05 step 3 + §5.1 "structured pull fails → skip silently"). Keep the queue and the job so the credentials can be dropped in later. |

**Retention** (add to `backend/worker/src/jobs/retention.ts`): `extraction_checks` and `sku_match_candidates` for `documents` in `rejected`/`failed` older than 180 days are deleted in bounded batches; original page objects are **kept** (they are the business record behind a GRN) — flag object-storage lifecycle as a later ticket.

**Outbox events** (written inside the business transaction, `aggregate_type` / `event_type` / `payload`):

| aggregate_type | event_type | payload | consumer |
| --- | --- | --- | --- |
| `document` | `docint.document.submitted` | `{ documentId, kind, supplierId, pages }` | relay → enqueue `docint.extract` |
| `document` | `docint.document.extracted` | `{ documentId, extractionId, lineCount, redCount, amberCount }` | queue badge / SSE later |
| `document` | `docint.document.needs_review` | `{ documentId, redCount, amberCount }` | manager notification later |
| `document` | `docint.document.reviewed` | `{ documentId, reviewSessionId, editsCount }` | metrics |
| `document` | `docint.document.failed` | `{ documentId, failureCode, attemptCount }` | admin alarm (docs/11) |
| `supplier_invoice` | `docint.supplier_invoice.drafted` | `{ supplierInvoiceId, documentId, supplierId, invoiceNo, invoiceDate }` | prompts the warehouse GRN; later WhatsApp/Tally |

Register the handlers in `relayOutbox()` (it currently logs "no handlers registered yet").

**Offline sync handlers** (`SyncRegistry`, registered in `DocintModule.onModuleInit`, following `orders.sync.ts`): `documents` and `document_pages`, **PUT only**. A device may create a document and its page rows offline; it may never set a `status` other than `uploaded`, never send image bytes through the sync op (the attachment queue uploads to `object_key` separately), and never submit. Rejections are `SyncRejection` (2xx + `sync_errors`, never 4xx): `unsupported_op`, `state_not_allowed`, `document_not_found`, `document_locked`, `page_missing_object`, `duplicate_document`. Both messages in English and Hindi, as in `orders.sync.ts`.

---

## 8. Founder questions this brief had to assume an answer for

1. **May the `warehouse` role see printed purchase rates during review?** *Assumed no.* Capture, QR verify, page upload, list and get are open to `warehouse`; extraction detail, SKU matching, review and commit are `owner/manager/accountant` only — consistent with `grn_lines` carrying "no rates here" and with the existing `tenantRolePolicy(..., BACK_OFFICE_ROLES)` on every docint table except `documents`/`document_pages`/`supplier_aliases`. If Tarsun's gate staff must also review, `BACK_OFFICE_ROLES` has to grow and migration 0007 must alter six policies.
2. **Who may type an invoice when extraction fails?** *Assumed back office only*, through the existing `procurement.supplierInvoices.create`; docint offers no manual-entry endpoint, and `docint.stats.summary` counts the failures so the rate stays visible (docs/05 "manual typing allowed only here and measured").
3. **docs/17 §C item 8 — does the CA already key Too Yumm invoices into Tally?** *Assumed yes, double-posting is a real risk*, so `documents.commit` refuses `kind='brand_dms_invoice'` in this slice; the brand-DMS commit path lands with billing, where the external numbering series and `tally_export_source` on `tenant_brands` (docs/17 A1) can settle it in one place.
4. **docs/17 §C item 6 — no FieldAssist / TradeEzee sample exports yet.** *Assumed* the brand-DMS retailer match (name / phone / beat / `Buyer ERP Id`) can be built against `external_party_codes` (docs/17 A7) once a real export exists; the demo seed uses a single invented `system='fieldassist'` code so the plumbing is exercised.
5. **Which model, and what does a page cost?** *Assumed* `claude-sonnet-5` as the default with `claude-opus-5` for escalation, per docs/05 — but docs/05 §5.2 is explicit that Sonnet 5 is "the prior, not the decision" until the week-10 eval. The engine sits behind one interface and the model id is `DOCINT_MODEL`, so switching is a config change. **No monthly Anthropic budget or per-page cost ceiling has been set** — `extractions.cost_paise` is recorded from day one so the founder can set one after the first 100 invoices.
6. **How long do original page images live?** *Assumed indefinitely* (they are the evidence behind a GRN and an AP entry); only derived rows for rejected/failed documents are swept at 180 days. A DPDP/retention decision on object storage is deferred.
7. **Is the buyer-GSTIN override an owner-only action?** *Assumed yes* — a branch or consignee GSTIN on the invoice is red and only an `owner` reviewer may clear it, recorded in `corrections_log`. If Tarsun bills through more than one GSTIN, a `tenant_settings` list of accepted buyer GSTINs is the cheaper answer.
8. **Local file storage.** *Assumed* a `local` storage driver writing under `DOCINT_STORAGE_DIR` (default `backend/.storage`, gitignored) because there is no S3 and no Docker on this machine; the S3 driver with pre-signed PUT/GET is written behind the same interface but is only exercised when `DOCINT_STORAGE_DRIVER=s3`. `docs/20` rule 15 ("nothing binary passes through a service") is therefore satisfied in production and deliberately relaxed for local dev, where `addPage` accepts `contentBase64`.

**New env vars to document in `backend/.env` and the service READMEs:** `ANTHROPIC_API_KEY` (already present), `DOCINT_ENGINE` (`stub`|`anthropic`, default `stub` when the key is absent or `NODE_ENV=test`), `DOCINT_MODEL` (`claude-sonnet-5`), `DOCINT_ESCALATION_MODEL` (`claude-opus-5`), `DOCINT_STORAGE_DRIVER` (`local`|`s3`), `DOCINT_STORAGE_DIR`, `DOCINT_LOCK_TTL_SECONDS` (300), `DOCINT_MAX_PAGES` (20), `DOCINT_INLINE_JOBS` (specs/demo), `DOCINT_IRP_KEYS` (optional JWKS for QR signature verification).

**Definition of done:** contract + permissions entry + service + controller + module + spec present; `pnpm docs:readme` re-run; `cd backend && pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm db:migrate && DATABASE_URL=… pnpm test` green; no cost/margin column reachable by `salesperson`/`delivery`/`retailer`/`warehouse`; `backend/libs/database/src/rls.test.ts` extended with the four role assertions from §5; `docs/18-build-log.md` row updated. The main session — not the subagent — edits `backend/libs/contracts/src/contract.ts`, `backend/libs/contracts/src/index.ts`, `backend/libs/core/src/index.ts`, module `index.ts` files and every `*-service/src/service.ts`.
