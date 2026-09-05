-- Hand-written companion to 0016_docint_pipeline.sql: the guarantees drizzle-kit cannot express.
-- Everything declarable in src/schema/docint.ts — the `document_qr_status` enum, the 24 new columns on
-- the seven docint tables, the four new indexes, the two redundant indexes they subsume
-- (`extractions_document_idx`, `sku_match_candidates_idx`; coordination §5.4) and the two ALTER POLICY
-- statements that turn `documents_tenant` / `document_pages_tenant` from "any member of the tenant" into
-- the kind-scoped predicates of docint §3i — is in the GENERATED 0016 and is deliberately NOT repeated
-- here (docs/plans/00-coordination.md §2 rule 3: split by what drizzle can express, and drizzle-kit emits
-- ALTER POLICY for a same-named policy whose predicate changed, exactly as it did for `trip_points_read`
-- in 0014). The schema is therefore the single truth for the policy text, and the next `db:generate`
-- emits nothing for docint. Generating 0016 needed no answers (no rename question was asked); the
-- expect wrapper used for 0012/0014 was kept in front of it anyway.
--
-- What is here, and why each piece is an extension, a grant or an assertion rather than schema:
--   1. `CREATE EXTENSION pg_trgm` and the five trigram indexes (docint §3h). The docs/05 step-8 fuzzy
--      SKU stage and integrations' party/item matching (step 6 in the chain) stand on these. Three of the
--      five are on GLOBAL curated tables (`products`, `product_variants`, `product_aliases`), two on
--      tenant tables (`supplier_aliases`, `supplier_pack_configs`). Drizzle could declare a gin index,
--      but the extension it needs cannot be declared, and a generated file runs before its sibling — so
--      extension and indexes travel together here. `pg_trgm` is a trusted extension: the `dos` owner role
--      installs it without superuser (verified on Postgres 17.x; PG 13+).
--   2. FORCE ROW LEVEL SECURITY + grants re-asserted for the nine docint tables (0003 already did both;
--      0001/0003's ALTER DEFAULT PRIVILEGES grant; explicit and idempotent so the nine tables are correct
--      on a database whose defaults were changed by hand). No new table in this slice.
--   3. THE ASSERTION, the twin of 0011 §2, 0013 §6 and 0015 §6. 0016's policy text is generated from the
--      schema; a later `db:generate` against a drifted schema could quietly put the wide `tenantPolicy`
--      back on `documents` (any member — a shopkeeper, a rep — reads a page full of purchase rates: the
--      docs/17 A12 finding) and no test that does not look for it would fail. So the migration refuses
--      to finish unless:
--        (a) every docint table FORCEs row level security;
--        (b) `documents_tenant` (USING and WITH CHECK) excludes the retailer, names the inbound desk
--            (owner, manager, accountant, warehouse, system) and the three field kinds
--            (pod, claim_sheet, other), and names no other role by itself;
--        (c) `document_pages_tenant` (USING and WITH CHECK) is scoped through `documents`;
--        (d) the six priced tables (`extractions`, `extraction_checks`, `sku_match_candidates`,
--            `review_sessions`, `corrections_log`, `engine_disagreements`) carry at least one policy and
--            NO policy predicate on any of them names salesperson, delivery, retailer or warehouse —
--            the executable form of "extraction output carries printed purchase rates → back office
--            only" (docint §2, §4.21; never-list 1);
--        (e) `pg_trgm` is installed and the five trigram indexes exist with `gin_trgm_ops`.
--
-- Page images and PDFs live in object storage under `tenant/{tenantId}/docs/{documentId}/…`
-- (coordination §3.3); the tables hold keys and hashes only, so nothing here touches bytes.
--
-- Because drizzle runs every pending migration inside ONE transaction, this file uses nothing that
-- Postgres refuses inside the transaction that created it: `document_qr_status` is a NEW type (usable at
-- once; the ADD VALUE rule of 0014 does not apply), and no statement below references it anyway.

-- 1. Trigram matching. IF NOT EXISTS throughout: idempotent on the founder's database and on a fresh one.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_variants_name_trgm_idx" ON "product_variants" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_aliases_normalized_trgm_idx" ON "product_aliases" USING gin ("normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_aliases_normalized_trgm_idx" ON "supplier_aliases" USING gin ("normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_pack_configs_desc_trgm_idx" ON "supplier_pack_configs" USING gin ("supplier_description" gin_trgm_ops);--> statement-breakpoint

-- 2. FORCE RLS and the runtime grants, re-asserted for every docint table.
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_pages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extractions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extraction_checks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sku_match_candidates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "corrections_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engine_disagreements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_aliases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "documents", "document_pages", "extractions", "extraction_checks", "sku_match_candidates", "review_sessions", "corrections_log", "engine_disagreements", "supplier_aliases" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "documents", "document_pages", "extractions", "extraction_checks", "sku_match_candidates", "review_sessions", "corrections_log", "engine_disagreements", "supplier_aliases" TO app_worker;--> statement-breakpoint

-- 3. THE ASSERTION (see the header). Predicates are read back through pg_get_expr, which keeps string
--    literals single-quoted ('warehouse', 'claim_sheet') and the `<>` operator as written, so the
--    LIKE patterns below match the deparsed text of what 0016 installed — and would not match a wide
--    `tenantPolicy` put back by a drifted schema.
DO $$
DECLARE
  t text;
  forced boolean;
  n int;
  qual text;
  chk text;
BEGIN
  -- (a) FORCE on every docint table
  FOREACH t IN ARRAY ARRAY[
    'documents', 'document_pages', 'extractions', 'extraction_checks', 'sku_match_candidates',
    'review_sessions', 'corrections_log', 'engine_disagreements', 'supplier_aliases'
  ]
  LOOP
    SELECT c.relforcerowsecurity INTO forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t;
    IF forced IS DISTINCT FROM true THEN
      RAISE EXCEPTION '% does not FORCE row level security; the docint policies would not bind the owner connection', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (b) documents_tenant is the kind-scoped predicate of docint §3i, in both halves
  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
    INTO qual, chk
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'documents' AND p.polname = 'documents_tenant';
  IF qual IS NULL OR chk IS NULL THEN
    RAISE EXCEPTION 'documents_tenant is missing or one-sided (USING %, WITH CHECK %); 0016 installs it FOR ALL with both halves', qual IS NOT NULL, chk IS NOT NULL
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOREACH t IN ARRAY ARRAY[qual, chk]
  LOOP
    IF t NOT LIKE '%<> ''retailer''%'
       OR t NOT LIKE '%''owner''%' OR t NOT LIKE '%''manager''%' OR t NOT LIKE '%''accountant''%'
       OR t NOT LIKE '%''warehouse''%' OR t NOT LIKE '%''system''%'
       OR t NOT LIKE '%''pod''%' OR t NOT LIKE '%''claim_sheet''%' OR t NOT LIKE '%''other''%'
       OR t LIKE '%''salesperson''%' OR t LIKE '%''delivery''%'
       OR t LIKE '%''supplier_invoice''%' OR t LIKE '%''lorry_receipt''%' OR t LIKE '%''brand_dms_invoice''%' THEN
      RAISE EXCEPTION 'documents_tenant is not the kind-scoped predicate of docint section 3i (a shopkeeper or a rep could read a supplier invoice image, docs/17 A12): %', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (c) document_pages_tenant inherits the document's visibility
  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
    INTO qual, chk
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'document_pages' AND p.polname = 'document_pages_tenant';
  IF qual IS NULL OR chk IS NULL OR qual NOT LIKE '%FROM documents d%' OR chk NOT LIKE '%FROM documents d%' THEN
    RAISE EXCEPTION 'document_pages_tenant must be scoped through documents (USING %, WITH CHECK %)', qual, chk
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (d) the priced tables name no field role, in any policy, in either half
  FOREACH t IN ARRAY ARRAY[
    'extractions', 'extraction_checks', 'sku_match_candidates', 'review_sessions', 'corrections_log', 'engine_disagreements'
  ]
  LOOP
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF n = 0 THEN
      RAISE EXCEPTION '% has no policy; with FORCE RLS that is a closed table, and it must be the back-office policy of 0002', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND (   COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%''salesperson''%'
             OR COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%''delivery''%'
             OR COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%''retailer''%'
             OR COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%''warehouse''%'
             OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%''salesperson''%'
             OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%''delivery''%'
             OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%''retailer''%'
             OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%''warehouse''%');
    IF n > 0 THEN
      RAISE EXCEPTION '% has a policy that names a field role; extraction output carries printed purchase rates and stays with the back office (docint section 4.21, never-list 1)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (e) trigram stage is standing
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'pg_trgm is not installed; the docint SKU cascade and integrations fuzzy matching have no index to stand on'
      USING ERRCODE = 'undefined_object';
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'product_variants_name_trgm_idx', 'products_name_trgm_idx', 'product_aliases_normalized_trgm_idx',
    'supplier_aliases_normalized_trgm_idx', 'supplier_pack_configs_desc_trgm_idx'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = t AND indexdef LIKE '%gin_trgm_ops%') THEN
      RAISE EXCEPTION 'trigram index % is missing or is not a gin_trgm_ops index', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
END;
$$;
