-- Hand-written companion to 0021_claims_expand.sql: the guarantees drizzle-kit cannot express.
--
-- WHAT IS DELIBERATELY NOT HERE. The plan (docs/plans/00-coordination.md §2, row "0018 claims", the
-- relative slot this pair landed in as 0021/0022) expected this file to carry "the coalesce()-based
-- partial unique indexes and the two check constraints (claims_settled_within_claimed, claims_period_order)
-- that drizzle cannot express". It does not, because drizzle-kit 0.31 CAN express every one of them, and
-- already had: `rep_auto_approve_bounds_idx` (coalesce, 0002), `invoices_order_active_idx` (partial, 0008),
-- `allocations_one_source` (ADD CONSTRAINT … CHECK on an existing table, 0006). So they are declared in
-- `src/schema/claims.ts` and `pnpm db:generate` emitted them into the GENERATED 0021:
--   `claims_open_period_idx`  UNIQUE (tenant_id, supplier_id, coalesce(brand_id, ''), kind, period_from,
--                             period_to) WHERE status <> 'rejected'   — one live claim per period
--   `claim_lines_source_unique_idx`  UNIQUE (tenant_id, source_type, source_id) WHERE status <> 'rejected'
--                             — a source is claimable exactly once (claims §4.9); `claim_lines_claim_source_idx`
--                             is NOT created, per coordination §5.4
--   `claim_settlements_ref_idx`  UNIQUE (tenant_id, claim_id, external_ref) WHERE external_ref IS NOT NULL
--   CHECK `claims_settled_within_claimed`   settled_paise + written_off_paise <= claimed_paise
--   CHECK `claims_period_order`             period_from <= period_to
--   CHECK `claim_lines_settled_within_amount`  settled_paise <= amount_paise   (claims §4.16, line half)
--   CHECK `claim_evidence_has_target`       document_id IS NOT NULL OR object_key IS NOT NULL
--   CHECK `claim_settlements_amount_positive`  amount_paise > 0
-- together with `ALTER TYPE claim_status ADD VALUE 'written_off'`, the four new enums, the 28 new columns,
-- the `claim_settlements` table with its back-office policy, and the replacement of `return_policies`'
-- wide any-member FOR ALL policy by a back-office read + owner-only write set. Repeating any of that here
-- is exactly the duplication §2 rule 3 forbids ("the next `pnpm db:generate` will emit it again"); this is
-- the same split 0011 and 0019 ended up with. Generating 0021 needed no answers (nothing renamed), so no
-- TTY was needed; the run was wrapped in expect anyway in case the policy swap prompted.
--
-- `'written_off'` is NEVER used as a value in this file: drizzle's migrator runs every pending migration in
-- ONE transaction, and Postgres refuses to use an enum value added in the transaction that adds it
-- (coordination §2 rule 4). Its existence is checked below through pg_enum, which is a catalogue read.
--
-- What IS here, and why each piece is a grant, a trigger or an assertion rather than schema:
--   1. FORCE ROW LEVEL SECURITY + the runtime grants for `claim_settlements` (coordination §8 item 5), and
--      the same re-asserted for the four claims tables 0003 already covered and for `return_policies`,
--      whose policy 0021 replaced (idempotent; explicit so all six are correct on a database whose defaults
--      were changed by hand — without FORCE the owner connection would bypass every policy below).
--   2. `dos_claim_child_tenant_guard()` — a line, a photo, a sheet or a settlement names a claim of ITS
--      OWN tenant. RLS already hides another tenant's claim from `app_rw`, but a foreign-key check bypasses
--      row security, so the FK alone would let the owner connection, a seed or the worker running
--      BYPASSRLS pin tenant B's settlement (money) onto tenant A's claim. A column-vs-other-table rule
--      cannot be a CHECK or a policy, hence a trigger — the twin of 0019 §2 — SECURITY DEFINER so the
--      check sees the parent whatever the caller's role may read, with an explicit tenant comparison so
--      the wider view never widens the rule.
--   3. THE ASSERTION, the twin of 0011 §2, 0013 §6, 0015 §6, 0017 §3 and 0019 §3. The policy text of 0021
--      is generated from the schema; a later `db:generate` against a drifted schema could quietly put a
--      wide `tenantPolicy` back on a table whose rows carry PURCHASE COST (`claim_lines.rate_paise` on a
--      damage line) and WHICH SCHEMES THE BRAND FUNDS — the Vyapar leak that made reps quit (claims §4.21,
--      docs/22 §9 never-list 1) — and no test that does not look for it would fail. So the migration
--      refuses to finish unless:
--        (a) every one of the six tables FORCEs row level security;
--        (b) every one carries at least one policy, and NO policy predicate on any of them names
--            salesperson, delivery, retailer or warehouse — the executable form of "a salesperson,
--            warehouse, delivery or retailer actor never reads any claims row" (claims §4.21) and of
--            "claims are served by owner-service and manager-service only" (coordination §6);
--        (c) `return_policies` is written by the owner alone: no INSERT/UPDATE/DELETE policy on it names
--            manager or accountant (`claims.policies.upsert = OWNER_ONLY`; the accountant sets no settings,
--            docs/22 §8 2026-09-05);
--        (d) `claim_status` carries `written_off` (catalogue read, never a cast);
--        (e) the six new indexes exist, each leading with `tenant_id` (coordination §8 item 6), the three
--            unique ones are partial, and the period index is the coalesce form (NULL brand_id would
--            otherwise never collide: NULLs are distinct in a unique index);
--        (f) `claim_lines_claim_source_idx` does NOT exist (coordination §5.4);
--        (g) the five check constraints exist with the arithmetic above;
--        (h) `claim_statements.object_key` and `generated_at` are nullable (the worker fills them;
--            docs/20 rule 3: nothing renders on the request path);
--        (i) the tenant guard of §2 is armed on all four child tables.
--
-- Claim evidence and claim sheets live in object storage under `tenant/{tenantId}/claims/…`
-- (coordination §3.3); the tables hold keys only, so nothing here touches bytes.

-- 1. FORCE RLS and the runtime grants for the six tables (the new one first).
ALTER TABLE "claim_settlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_statements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "return_policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "claim_settlements", "claims", "claim_lines", "claim_evidence", "claim_statements", "return_policies" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "claim_settlements", "claims", "claim_lines", "claim_evidence", "claim_statements", "return_policies" TO app_worker;--> statement-breakpoint

-- 2. A claim's line, photo, sheet and settlement belong to the claim's tenant.
CREATE OR REPLACE FUNCTION dos_claim_child_tenant_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_tenant text;
BEGIN
  SELECT tenant_id INTO c_tenant FROM claims WHERE id = NEW.claim_id;
  IF c_tenant IS NULL THEN
    RAISE EXCEPTION '% %: claim % does not exist', TG_TABLE_NAME, NEW.id, NEW.claim_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF c_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION '% %: claim % belongs to another tenant', TG_TABLE_NAME, NEW.id, NEW.claim_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS claim_lines_tenant_guard ON "claim_lines";--> statement-breakpoint
CREATE TRIGGER claim_lines_tenant_guard
  BEFORE INSERT OR UPDATE OF claim_id, tenant_id ON "claim_lines"
  FOR EACH ROW EXECUTE FUNCTION dos_claim_child_tenant_guard();--> statement-breakpoint
DROP TRIGGER IF EXISTS claim_evidence_tenant_guard ON "claim_evidence";--> statement-breakpoint
CREATE TRIGGER claim_evidence_tenant_guard
  BEFORE INSERT OR UPDATE OF claim_id, tenant_id ON "claim_evidence"
  FOR EACH ROW EXECUTE FUNCTION dos_claim_child_tenant_guard();--> statement-breakpoint
DROP TRIGGER IF EXISTS claim_statements_tenant_guard ON "claim_statements";--> statement-breakpoint
CREATE TRIGGER claim_statements_tenant_guard
  BEFORE INSERT OR UPDATE OF claim_id, tenant_id ON "claim_statements"
  FOR EACH ROW EXECUTE FUNCTION dos_claim_child_tenant_guard();--> statement-breakpoint
DROP TRIGGER IF EXISTS claim_settlements_tenant_guard ON "claim_settlements";--> statement-breakpoint
CREATE TRIGGER claim_settlements_tenant_guard
  BEFORE INSERT OR UPDATE OF claim_id, tenant_id ON "claim_settlements"
  FOR EACH ROW EXECUTE FUNCTION dos_claim_child_tenant_guard();--> statement-breakpoint

-- 3. THE ASSERTION (see the header). Predicates are read back through pg_get_expr, which keeps string
--    literals single-quoted ('salesperson', 'retailer'), so the LIKE patterns below match the deparsed
--    text of what 0002/0021 installed — and would match a wide policy put there by a drifted schema.
DO $$
DECLARE
  t text;
  forced boolean;
  n int;
  def text;
BEGIN
  -- (a) FORCE on every claims table and on the policy table
  FOREACH t IN ARRAY ARRAY[
    'claims', 'claim_lines', 'claim_evidence', 'claim_statements', 'claim_settlements', 'return_policies'
  ]
  LOOP
    SELECT c.relforcerowsecurity INTO forced
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF forced IS DISTINCT FROM true THEN
      RAISE EXCEPTION '% does not FORCE row level security; the back-office policy would not bind the owner connection', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (b) every one has a policy, and none names a field role, in either half
  FOREACH t IN ARRAY ARRAY[
    'claims', 'claim_lines', 'claim_evidence', 'claim_statements', 'claim_settlements', 'return_policies'
  ]
  LOOP
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF n = 0 THEN
      RAISE EXCEPTION '% has no policy; with FORCE RLS that is a closed table, and it must be the back-office policy of 0002/0021', t
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
      RAISE EXCEPTION '% has a policy that names a field role; a claim line carries purchase cost and says which schemes the brand funds (claims section 4.21)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- and none is the wide any-member form: a predicate that names no role at all is the 0002 tenantPolicy
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t
        AND COALESCE(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid), '') NOT LIKE '%app.actor_role%';
    IF n > 0 THEN
      RAISE EXCEPTION '% has a policy that names no role: that is the any-member FOR ALL policy of 0002, under which a shopkeeper token reads the claim', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (c) the claim policy is set by the owner alone: no write policy on return_policies admits the manager
  --     or the accountant (reads stay back office: `claims.policies.list`)
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'return_policies'
      AND p.polcmd IN ('a', 'w', 'd', '*')
      AND (   COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid), '') LIKE '%''manager''%'
           OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid), '') LIKE '%''accountant''%');
  IF n > 0 THEN
    RAISE EXCEPTION 'return_policies has a write policy that admits the manager or the accountant; claims.policies.upsert is owner only (claims section 2, docs/22 section 8 2026-09-05)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'return_policies' AND p.polcmd = 'r';
  IF n = 0 THEN
    RAISE EXCEPTION 'return_policies has no SELECT policy; claims.policies.list would read nothing'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (d) the write-off state exists on the claim enum (catalogue read only, never a cast)
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
    WHERE ty.typname = 'claim_status' AND e.enumlabel = 'written_off'
  ) THEN
    RAISE EXCEPTION 'claim_status has no ''written_off'' value; 0021 must add it before a claim can be closed as a loss'
      USING ERRCODE = 'undefined_object';
  END IF;
  FOREACH t IN ARRAY ARRAY['claim_value_basis', 'claim_period_kind', 'claim_settlement_mode', 'claim_line_status']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = t AND typtype = 'e') THEN
      RAISE EXCEPTION 'enum % is missing (0021)', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;

  -- (e) the six new query paths exist and lead with tenant_id; the unique ones are partial
  FOREACH t IN ARRAY ARRAY[
    'claims_open_period_idx', 'claims_due_idx', 'claim_lines_source_unique_idx', 'claim_lines_status_idx',
    'claim_settlements_claim_idx', 'claim_settlements_ref_idx'
  ]
  LOOP
    SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = 'public' AND indexname = t;
    IF def IS NULL OR def NOT LIKE '%(tenant_id,%' THEN
      RAISE EXCEPTION 'index % is missing or does not lead with tenant_id', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['claims_open_period_idx', 'claim_lines_source_unique_idx', 'claim_settlements_ref_idx']
  LOOP
    SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = 'public' AND indexname = t;
    IF def NOT LIKE 'CREATE UNIQUE INDEX%' OR def NOT LIKE '% WHERE %' THEN
      RAISE EXCEPTION 'index % must be a PARTIAL UNIQUE index (rejected rows and NULL refs must not block a re-claim)', t
        USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
  SELECT indexdef INTO def FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'claims_open_period_idx';
  IF def NOT LIKE '%COALESCE(brand_id%' AND def NOT LIKE '%coalesce(brand_id%' THEN
    RAISE EXCEPTION 'claims_open_period_idx must key on coalesce(brand_id, ''''): a NULL brand never collides in a unique index, so two shortage claims could cover one period'
      USING ERRCODE = 'undefined_object';
  END IF;

  -- (f) the redundant lookup index the brief proposed is not there (coordination section 5.4)
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'claim_lines_claim_source_idx') THEN
    RAISE EXCEPTION 'claim_lines_claim_source_idx exists; claim_lines_source_unique_idx is the guarantee and claim_lines_claim_idx the lookup (coordination section 5.4)'
      USING ERRCODE = 'duplicate_object';
  END IF;

  -- (g) the five arithmetic guarantees are real constraints, not service code
  FOREACH t IN ARRAY ARRAY[
    'claims_settled_within_claimed', 'claims_period_order', 'claim_lines_settled_within_amount',
    'claim_evidence_has_target', 'claim_settlements_amount_positive'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND con.conname = t AND con.contype = 'c'
    ) THEN
      RAISE EXCEPTION 'check constraint % is missing (0021)', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
  SELECT pg_get_constraintdef(con.oid) INTO def
    FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
    WHERE c.relname = 'claims' AND con.conname = 'claims_settled_within_claimed';
  IF def NOT LIKE '%written_off_paise%' OR def NOT LIKE '%claimed_paise%' THEN
    RAISE EXCEPTION 'claims_settled_within_claimed must bound settled_paise + written_off_paise by claimed_paise (claims section 4.16); found %', def
      USING ERRCODE = 'check_violation';
  END IF;

  -- (h) the statement row is created before the sheet exists: both worker-filled columns are nullable
  FOREACH t IN ARRAY ARRAY['object_key', 'generated_at']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'claim_statements' AND column_name = t AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'claim_statements.% is NOT NULL; the request path inserts the row before the worker renders the sheet (docs/20 rule 3)', t
        USING ERRCODE = 'not_null_violation';
    END IF;
  END LOOP;

  -- (i) the tenant guard is armed on every child table
  FOREACH t IN ARRAY ARRAY['claim_lines', 'claim_evidence', 'claim_statements', 'claim_settlements']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t AND tg.tgname = t || '_tenant_guard' AND NOT tg.tgisinternal
    ) THEN
      RAISE EXCEPTION '% has no tenant guard trigger; a foreign-key check bypasses row security, so a row could be pinned onto another tenant''s claim', t
        USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
END;
$$;
