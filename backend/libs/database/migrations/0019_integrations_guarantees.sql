-- Hand-written companion to 0018_integrations_expand.sql: the guarantees drizzle-kit cannot express.
-- Everything declarable in src/schema/integrations.ts — the `staged` value of `job_status`, the new
-- `import_profiles` table with its two indexes and its back-office policy, the seven new columns on
-- `import_jobs` (`source_file_name`, `profile_id`, `has_header_row`, `sheet_name`, `source_columns`,
-- `started_at`, `finished_at`), the two on `import_rows` (`reviewed_by`, `reviewed_at`), the three FKs and
-- the two new indexes (`import_jobs_profile_idx`, `tally_sync_ledger_export_idx`) — is in the GENERATED
-- 0018 and is deliberately NOT repeated here (docs/plans/00-coordination.md §2 rule 3). Generating 0018
-- needed no answers (additions only, nothing removed or renamed), so no TTY and no expect wrapper.
--
-- Coordination §2 assigned integrations ONE generated file and no sibling, because the brief
-- (docs/plans/integrations.md §3) added no table. The founder's answer of 2026-09-04 23:40 (docs/17 §D7,
-- docs/22 §8) then made the GENERIC mapped importer the first deliverable — "upload → preview → map columns
-- → SAVE PROFILE → dry run → commit" — and docs/23 §8.6 lists `integrations.profiles.list/upsert` as the
-- endpoints the owner app's wizard (O21) needs. A saved profile needs a table, and a new table needs what
-- only this file can give it; hence the sibling.
--
-- What is here, and why each piece is a grant, a trigger or an assertion rather than schema:
--   1. FORCE ROW LEVEL SECURITY + the runtime grants for `import_profiles` (coordination §8 item 5), and
--      the same re-asserted for the five integrations tables 0003 already covered (idempotent; explicit
--      so the six are correct on a database whose defaults were changed by hand).
--   2. `dos_import_jobs_profile_guard()` — a job that names a saved profile must be in the profile's
--      tenant AND aimed at the profile's target. RLS already hides another tenant's profile from `app_rw`,
--      but the FK alone would let the owner connection, a seed or a worker running BYPASSRLS point a
--      `retailers` job at an `opening_balances` mapping — and "a wrong default here would misfile real
--      money" (integrations §4.13). A column-vs-other-table rule cannot be a CHECK or a policy, hence a
--      trigger; SECURITY DEFINER so the check sees the profile row whatever the caller's role may read
--      (the same hole 0007 closed on the journal balance trigger), with an explicit tenant comparison so
--      the wider view never widens the rule.
--   3. THE ASSERTION, the twin of 0011 §2, 0013 §6, 0015 §6 and 0017 §3. The policy text of 0018 is
--      generated from the schema; a later `db:generate` against a drifted schema could quietly put a wide
--      `tenantPolicy` on a table whose rows decide where real shops and real money land, and no test that
--      does not look for it would fail. So the migration refuses to finish unless:
--        (a) every one of the six integrations tables FORCEs row level security;
--        (b) every one carries at least one policy, and NO policy predicate on any of them names
--            salesperson, delivery, retailer or warehouse — the executable form of "no salesperson,
--            warehouse, delivery or retailer screen in any of the six apps ever touches this module"
--            (integrations §1, §5.16) and of the accountant's "reads and exports" seat (docs/22 §8,
--            2026-09-05), which is a back-office seat;
--        (c) `job_status` carries `staged` (read from the catalogue, never used as a value: 0018 added it
--            in this same transaction and Postgres forbids USING a value before the transaction that
--            added it commits — coordination §2 rule 4; the first use is application code);
--        (d) the three new indexes exist, each leading with `tenant_id` (coordination §8 item 6);
--        (e) `pg_trgm` is installed (0017): the party and item matchers of integrations §4.6–4.7 stand on
--            it, and this slice was told to verify it rather than assume it.
--
-- Import source files and export files live in object storage under `tenant/{tenantId}/import/…` and
-- `tenant/{tenantId}/exports/…` (coordination §3.3, `file_domain`); the tables hold keys only, so nothing
-- here touches bytes.

-- 1. FORCE RLS and the runtime grants for the six integrations tables (the new one first).
ALTER TABLE "import_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_rows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "export_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tally_mappings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tally_sync_ledger" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "import_profiles", "import_jobs", "import_rows", "export_jobs", "tally_mappings", "tally_sync_ledger" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "import_profiles", "import_jobs", "import_rows", "export_jobs", "tally_mappings", "tally_sync_ledger" TO app_worker;--> statement-breakpoint

-- 2. A job's saved profile is in the job's tenant and aimed at the job's target.
CREATE OR REPLACE FUNCTION dos_import_jobs_profile_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p_tenant text;
  p_target text;
BEGIN
  IF NEW.profile_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tenant_id, target INTO p_tenant, p_target FROM import_profiles WHERE id = NEW.profile_id;
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'import job %: profile % does not exist', NEW.id, NEW.profile_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF p_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'import job %: profile % belongs to another tenant', NEW.id, NEW.profile_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_target <> NEW.target THEN
    RAISE EXCEPTION 'import job %: profile % maps columns for target % and cannot drive a % import', NEW.id, NEW.profile_id, p_target, NEW.target
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS import_jobs_profile_guard ON "import_jobs";--> statement-breakpoint
CREATE TRIGGER import_jobs_profile_guard
  BEFORE INSERT OR UPDATE OF profile_id, target, tenant_id ON "import_jobs"
  FOR EACH ROW EXECUTE FUNCTION dos_import_jobs_profile_guard();--> statement-breakpoint

-- 3. THE ASSERTION (see the header). Predicates are read back through pg_get_expr, which keeps string
--    literals single-quoted ('salesperson', 'retailer'), so the LIKE patterns below match the deparsed
--    text of what 0002/0018 installed — and would match a wide policy put there by a drifted schema.
DO $$
DECLARE
  t text;
  forced boolean;
  n int;
BEGIN
  -- (a) FORCE on every integrations table
  FOREACH t IN ARRAY ARRAY[
    'import_profiles', 'import_jobs', 'import_rows', 'export_jobs', 'tally_mappings', 'tally_sync_ledger'
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

  -- (b) every integrations table has a policy, and none names a field role, in either half
  FOREACH t IN ARRAY ARRAY[
    'import_profiles', 'import_jobs', 'import_rows', 'export_jobs', 'tally_mappings', 'tally_sync_ledger'
  ]
  LOOP
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relname = t;
    IF n = 0 THEN
      RAISE EXCEPTION '% has no policy; with FORCE RLS that is a closed table, and it must be the back-office policy of 0002/0018', t
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
      RAISE EXCEPTION '% has a policy that names a field role; the import wizard and the Tally desk are back office only (integrations section 1, section 5.16)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (c) the wizard's review state exists on the shared job enum (catalogue read only, never a cast)
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
    WHERE ty.typname = 'job_status' AND e.enumlabel = 'staged'
  ) THEN
    RAISE EXCEPTION 'job_status has no ''staged'' value; 0018 must add it before the import wizard can pause for review'
      USING ERRCODE = 'undefined_object';
  END IF;

  -- (d) the three new query paths exist and lead with tenant_id
  FOREACH t IN ARRAY ARRAY['import_profiles_name_idx', 'import_jobs_profile_idx', 'tally_sync_ledger_export_idx']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = t AND indexdef LIKE '%(tenant_id,%'
    ) THEN
      RAISE EXCEPTION 'index % is missing or does not lead with tenant_id', t USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;

  -- (e) the fuzzy party and item matchers have their extension
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'pg_trgm is not installed (0017); the integrations party and item matching has no index to stand on'
      USING ERRCODE = 'undefined_object';
  END IF;
END;
$$;
