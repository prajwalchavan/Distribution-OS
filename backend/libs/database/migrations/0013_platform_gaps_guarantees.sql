-- Hand-written companion to 0012_platform_gaps_expand.sql: the guarantees drizzle-kit cannot express.
-- Everything declarable in src/schema/*.ts — the new `file_objects` table, the columns, the indexes and the
-- 128 policies that replace 32 wide `*_tenant` FOR ALL policies — is in the GENERATED 0012 and is
-- deliberately NOT repeated here (docs/plans/00-coordination.md §2 rule 3). Generating 0012 needs a TTY
-- (drizzle-kit asks "created or renamed?" once per new policy on a table that also loses one; every
-- answer is "created"); drive it with expect when there is no terminal.
--
-- What is here, and why each piece is a trigger or a hand-written policy rather than schema:
--   1. FORCE ROW LEVEL SECURITY + grants for `file_objects` (every new tenant table, ADR 0002).
--   2. `tenant_settings_retailer_branding_read` — the shop's own app chrome shows the DISTRIBUTOR's
--      name and logo (docs/22 §7 white label, docs/23 §7), so the retailer role reads `branding.%` and
--      nothing else. Not declared in the schema for the same reason as 0009's staff policy.
--   3. `dos_load_sheet_approval_guard()` — the manager's PIN is given in the MANAGER app (founder,
--      2026-09-05): a load sheet reaches `confirmed` only with a manager approval on it.
--   4. `dos_numbering_series_guard()` — a series is the distributor's own configuration, editable by the
--      owner until the first document is issued (docs/17 §D1), and a counter never moves backwards.
--   5. `dos_retailers_guard()` — a shop edits its own name, owner, alternate phone, address and GSTIN
--      (`retailers.updateOwn`) and never its code, tier, beat, credit terms or links; credit terms are
--      set by the owner or the manager only — the accountant is a money desk (docs/22 §8, 2026-09-05).
--      Column-level rules cannot be written as row-level policies, hence a trigger.
--   6. A migrate-time assertion that none of the 32 re-policied tables still carries a FOR ALL policy,
--      the twin of 0011's block: a later `db:generate` against a drifted schema could quietly put the
--      wide policy back and nothing would fail.
--
-- Actor roles come from `current_setting('app.actor_role', true)`, which `withTenant()` sets for every
-- app_rw transaction. A connection with NO role set is the migrating/owner connection (seeds, migrations,
-- a DBA in psql) — it bypasses RLS anyway, so the role-based checks below treat '' like `system`; the
-- structural checks (an approval before a confirm, a locked series once issued) apply to everyone
-- including that connection; the counter-rewind rule is the one exception, see 4(a).

-- 1. file_objects: FORCE RLS and the runtime grants (0001/0003's ALTER DEFAULT PRIVILEGES already grant;
--    explicit and idempotent so the table is correct on a database whose defaults were changed by hand).
ALTER TABLE "file_objects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "file_objects" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "file_objects" TO app_worker;--> statement-breakpoint

-- 2. The shopkeeper reads the distributor's branding, and only that. `branding.%` can never match
--    `secret.%`; the second guard is belt and braces so a copy-paste of this policy onto another prefix
--    keeps the credential rule (0009) by construction. `upi_vpa`, `seller_fssai` and every threshold stay
--    hidden from the shop: the bill it looks at already carries what it needs (billing's `loadSettings`
--    escalates for those named keys only).
DROP POLICY IF EXISTS "tenant_settings_retailer_branding_read" ON "tenant_settings";--> statement-breakpoint
CREATE POLICY "tenant_settings_retailer_branding_read" ON "tenant_settings" AS PERMISSIVE FOR SELECT TO app_rw
  USING (
    tenant_id = (SELECT current_setting('app.tenant_id', true))
    AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
    AND key LIKE 'branding.%'
    AND key NOT LIKE 'secret.%'
  );--> statement-breakpoint

-- 3. Load-out needs the manager. The warehouse phone builds the sheet and counts the cartons; the manager
--    approves from the manager app (`approved_by` = the manager, `approved_at`); only then may the
--    warehouse confirm. Rules, in order:
--      (a) only an owner, a manager or the system writes the approval columns, and an owner/manager
--          signs with their own actor id — a warehouse actor who writes them is refused outright;
--      (b) `approved_by` and `approved_at` travel together;
--      (c) an approval is given to a draft (or in the same statement that confirms), never to a
--          cancelled sheet;
--      (d) `status` may become `confirmed` only with an approval on the row. An owner or manager who
--          confirms an unapproved sheet IS the approval — the trigger fills both columns from the actor,
--          so the desk path (manager-service `loadSheets.confirm`) stays one step and the existing
--          warehouse spec keeps passing — while a warehouse actor confirming without one is refused.
CREATE OR REPLACE FUNCTION dos_load_sheet_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  role text := COALESCE(current_setting('app.actor_role', true), '');
  actor text := COALESCE(current_setting('app.actor_id', true), '');
  approval_changed boolean;
  confirming boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    approval_changed := NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL;
    confirming := NEW.status = 'confirmed';
  ELSE
    approval_changed := NEW.approved_by IS DISTINCT FROM OLD.approved_by
                     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at;
    confirming := NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed';
  END IF;

  IF approval_changed THEN
    IF role NOT IN ('', 'system', 'owner', 'manager') THEN
      RAISE EXCEPTION 'load sheet %: only an owner or manager approves a load-out (the manager''s PIN is given in the manager app); a % actor may not write the approval', NEW.id, role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF role IN ('owner', 'manager') AND NEW.approved_by IS NOT NULL AND NEW.approved_by <> actor THEN
      RAISE EXCEPTION 'load sheet %: an approval is signed by the actor who gives it (approved_by % is not the actor %)', NEW.id, NEW.approved_by, actor
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.approved_by IS NOT NULL AND NEW.status = 'cancelled' THEN
      RAISE EXCEPTION 'load sheet % is cancelled and cannot be approved', NEW.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF confirming AND NEW.approved_by IS NULL THEN
    IF role IN ('owner', 'manager') THEN
      NEW.approved_by := actor;
      NEW.approved_at := now();
    ELSE
      RAISE EXCEPTION 'load sheet % cannot be confirmed: it carries no manager approval (approved_by / approved_at) — the manager gives the load-out PIN in the manager app first', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF (NEW.approved_by IS NULL) <> (NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION 'load sheet %: approved_by and approved_at are set together', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS load_sheets_approval_guard ON "load_sheets";--> statement-breakpoint
CREATE TRIGGER load_sheets_approval_guard BEFORE INSERT OR UPDATE ON "load_sheets" FOR EACH ROW EXECUTE FUNCTION dos_load_sheet_approval_guard();--> statement-breakpoint
--    Backfill (expand-only: fills a new column, moves no data): every sheet confirmed before this
--    migration was confirmed by an owner/manager token — that WAS the PIN (coordination §7 q15) — so the
--    confirmer is recorded as the approver. Runs on the migrating connection (no actor role), which the
--    trigger treats like the system role.
UPDATE "load_sheets" SET approved_by = confirmed_by, approved_at = COALESCE(confirmed_at, now())
  WHERE status = 'confirmed' AND approved_by IS NULL AND confirmed_by IS NOT NULL;--> statement-breakpoint

-- 4. A numbering series is configuration the owner sets during onboarding and "changeable until the first
--    invoice is issued" (docs/17 §D1). The policy on the table stays wide because `nextDocumentNumber()`
--    bumps `next_no` as whoever issues the document; this trigger is where the owner app's numbering
--    screen (`tenancy.numbering.upsert`, docs/23 §8.13 "lockedAfterFirstIssue") gets its guarantee:
--      (a) `next_no` never moves backwards under an app actor — a GST document number is never reissued
--          through any endpoint. The migrating/owner connection (no actor role) and the system role may
--          rewind: a DBA healing a dev database, and the retailers spec that simulates a counter lagging
--          behind imported codes, both do exactly that, and the unique indexes on the documents
--          themselves (`invoices_no_idx`, `credit_notes_no_idx`, `delivery_challans_no_idx`) still refuse
--          a reissued number;
--      (b) prefix, starting number, allocation mode and issuing device are locked once anything has been
--          issued (`next_no > 1`; with the default `starting_no = 1` the first issue leaves 2, and with a
--          configured start it leaves `starting_no + 1`) — start a new series instead;
--      (c) while still unlocked, only the owner (or the system) may change them;
--      (d) the key (tenant, series, FY) never changes.
CREATE OR REPLACE FUNCTION dos_numbering_series_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  role text := COALESCE(current_setting('app.actor_role', true), '');
  config_changed boolean := ROW(NEW.prefix, NEW.starting_no, NEW.allocation_mode, NEW.device_id)
                            IS DISTINCT FROM ROW(OLD.prefix, OLD.starting_no, OLD.allocation_mode, OLD.device_id);
BEGIN
  IF ROW(NEW.tenant_id, NEW.series_code, NEW.fy) IS DISTINCT FROM ROW(OLD.tenant_id, OLD.series_code, OLD.fy) THEN
    RAISE EXCEPTION 'numbering series %/%: the key of a series never changes', OLD.series_code, OLD.fy USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.next_no < OLD.next_no AND role NOT IN ('', 'system') THEN
    RAISE EXCEPTION 'numbering series %/%: next_no never moves backwards (% -> %); a document number is never reissued', OLD.series_code, OLD.fy, OLD.next_no, NEW.next_no
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF config_changed THEN
    IF OLD.next_no > 1 THEN
      RAISE EXCEPTION 'numbering series %/% has issued documents (next_no = %); its prefix, starting number and allocation mode are locked — configure a new series instead', OLD.series_code, OLD.fy, OLD.next_no
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF role NOT IN ('', 'system', 'owner') THEN
      RAISE EXCEPTION 'numbering series %/%: only the owner configures a series; a % actor may not', OLD.series_code, OLD.fy, role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS numbering_series_guard ON "numbering_series";--> statement-breakpoint
CREATE TRIGGER numbering_series_guard BEFORE UPDATE ON "numbering_series" FOR EACH ROW EXECUTE FUNCTION dos_numbering_series_guard();--> statement-breakpoint

-- 5. Who may change what on a retailer row. Two rules, both column-level and therefore a trigger:
--      (a) the RETAILER role (its own row, through `retailers_retailer_update`) edits name, owner name,
--          alternate phone, address, GSTIN, GST type, PAN and its pin on the map — never its code, tier,
--          beat, credit terms, cash discount, Tally name, external ids, merge, active flag, identity,
--          phone (the identity key) or tenant; and it never INSERTS a retailer;
--      (b) tier and the four credit terms (`setCredit`: tier, limit in paise, limit in bills, days, mode)
--          change only under an owner, a manager or the system. A rep onboarding a shop inserts it with
--          the defaults (tier C, no credit) and the app's credit block already answers 403; this is the
--          database saying the same thing to every path, and to the accountant (docs/22 §8, 2026-09-05).
CREATE OR REPLACE FUNCTION dos_retailers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  role text := COALESCE(current_setting('app.actor_role', true), '');
BEGIN
  IF role = 'retailer' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'a shop does not create its own retailer record; the distributor onboards it' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF ROW(NEW.id, NEW.tenant_id, NEW.identity_id, NEW.code, NEW.phone, NEW.beat_id, NEW.tier,
           NEW.credit_limit_paise, NEW.credit_limit_bills, NEW.credit_days, NEW.credit_mode, NEW.payment_terms,
           NEW.cash_discount_bps, NEW.cash_discount_days, NEW.tally_ledger_name, NEW.external_ids,
           NEW.onboarded_by, NEW.merged_into, NEW.active)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.tenant_id, OLD.identity_id, OLD.code, OLD.phone, OLD.beat_id, OLD.tier,
           OLD.credit_limit_paise, OLD.credit_limit_bills, OLD.credit_days, OLD.credit_mode, OLD.payment_terms,
           OLD.cash_discount_bps, OLD.cash_discount_days, OLD.tally_ledger_name, OLD.external_ids,
           OLD.onboarded_by, OLD.merged_into, OLD.active) THEN
      RAISE EXCEPTION 'retailer %: a shop edits its own name, owner, alternate phone, address and GSTIN — never its code, tier, beat, credit terms, phone or links', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF role NOT IN ('', 'system', 'owner', 'manager') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.tier <> 'C' OR NEW.credit_limit_paise <> 0 OR NEW.credit_limit_bills <> 0 OR NEW.credit_days <> 0 OR NEW.credit_mode <> 'indicate' THEN
        RAISE EXCEPTION 'retailer %: a % actor onboards a shop with the default tier and no credit; the owner or manager sets credit terms (setCredit)', NEW.id, role
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF ROW(NEW.tier, NEW.credit_limit_paise, NEW.credit_limit_bills, NEW.credit_days, NEW.credit_mode)
          IS DISTINCT FROM
          ROW(OLD.tier, OLD.credit_limit_paise, OLD.credit_limit_bills, OLD.credit_days, OLD.credit_mode) THEN
      RAISE EXCEPTION 'retailer %: tier and credit terms are set by the owner or the manager (setCredit); a % actor may not', OLD.id, role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS retailers_guard ON "retailers";--> statement-breakpoint
CREATE TRIGGER retailers_guard BEFORE INSERT OR UPDATE ON "retailers" FOR EACH ROW EXECUTE FUNCTION dos_retailers_guard();--> statement-breakpoint

-- 6. THE ASSERTION. 0012's policy work is generated from the schema; a later `db:generate` against a
--    drifted schema could quietly put a wide FOR ALL policy back and no test that does not look for it
--    would fail. So the migration refuses to finish while any of the 32 tables it re-policies (or the new
--    one) is still readable AND writable by any member through one predicate. Same shape as 0011 §2, and
--    the migrate-time twin of the per-role refusal cases in src/rls.test.ts.
DO $$
DECLARE t text; wide int; sel int; forced boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships', 'tenants', 'audit_log', 'feature_flags', 'sync_errors', 'file_objects',
    'rep_product_authorisations', 'supplier_pack_configs', 'suppliers', 'tenant_brands', 'tenant_products',
    'beat_assignments', 'beats', 'pjp', 'visits',
    'bargain_requests', 'price_list_items', 'price_lists', 'rep_auto_approve_bounds', 'retailer_price_overrides', 'schemes',
    'cycle_count_lines', 'cycle_counts', 'locations', 'reservations', 'stock_balances', 'stock_ledger', 'stock_lots',
    'approvals', 'grn_lines', 'grns', 'inbound_discrepancies', 'lorry_receipts'
  ]
  LOOP
    SELECT c.relforcerowsecurity INTO forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t;
    IF forced IS DISTINCT FROM true THEN
      RAISE EXCEPTION '% does not FORCE row level security; its policies would not bind the owner connection', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) FILTER (WHERE p.polcmd = '*'), count(*) FILTER (WHERE p.polcmd = 'r')
      INTO wide, sel
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t;
    IF wide > 0 THEN
      RAISE EXCEPTION '% still carries a FOR ALL policy; any member of the tenant could write it (migration 0012 splits reads from writes)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF sel = 0 THEN
      RAISE EXCEPTION '% has no SELECT policy after 0012; it would be unreachable', t USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
END;
$$;
