-- Hand-written companion to 0010_warehouse_fulfilment.sql: the guarantees drizzle-kit cannot express.
--
-- WHAT IS DELIBERATELY NOT HERE. The plan (docs/plans/00-coordination.md §2, row 0011) expected this file
-- to carry the policy replacement on the five warehouse tables — drop the wide `*_tenant` policies, create
-- `staffReadPolicy` + `roleWritePolicies(STOCK_KEEPER_ROLES)`. It does not, because drizzle-kit CAN express
-- policies: they are declared in `src/schema/warehouse.ts`, so `pnpm db:generate` emitted all twenty-five
-- statements into the GENERATED 0010. Repeating them here would be exactly the duplication §2 rule 3
-- forbids ("nothing declared in the Drizzle schema is hand-written twice"), and the next `db:generate`
-- would keep re-emitting them. This is the same split receivables ended up with: its policy replacement is
-- in the generated 0006, and its hand-written 0007 carries only the trigger and the grants.
--
-- Generating 0010 needs a TTY: drizzle-kit's policyResolver asks, per new policy on a table that also
-- loses one, "created or renamed?". Every answer is "created" (option 0). Drive it with expect if there is
-- no terminal.
--
-- 1. FORCE ROW LEVEL SECURITY and the runtime grants, re-asserted for the five tables 0010 re-policies.
--    All five already carry both from 0003 and 0001/0003's ALTER DEFAULT PRIVILEGES, so on this database
--    every statement below is a no-op. They are here because the module's guarantee is "a shopkeeper can
--    never read the godown's paperwork", and that guarantee is worth exactly nothing on a database where
--    FORCE is off (the owner connection would bypass every policy) or where a hand-run GRANT diverged.
--    Idempotent, so it costs one cheap catalogue update to make the five tables correct anywhere.
ALTER TABLE "picklists" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pick_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pack_confirmations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "load_sheets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_challans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "picklists" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pick_lines" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pack_confirmations" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "load_sheets" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "delivery_challans" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "picklists" TO app_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pick_lines" TO app_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pack_confirmations" TO app_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "load_sheets" TO app_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "delivery_challans" TO app_worker;--> statement-breakpoint
-- 2. THE ASSERTION THIS FILE EXISTS FOR. 0010's policy work is generated from the schema, which means a
--    later `db:generate` run against a drifted schema could quietly put the wide FOR ALL policy back — and
--    nothing would fail, because a too-wide policy breaks no test that does not specifically look for it.
--    So the migration itself refuses to finish while any of the five tables is readable by a shopkeeper:
--
--      * FORCE ROW LEVEL SECURITY must be on (without it the owning role ignores every policy);
--      * no policy on these tables may be FOR ALL (`polcmd = '*'`). That is the shape of the old
--        `*_tenant` policy — one predicate serving both reads and writes, satisfied by any member of the
--        tenant including `retailer` — and it is what 0010 removes;
--      * a SELECT policy and an INSERT policy must both exist, so the tables are not simply unreachable.
--
--    Postgres cannot express "no policy is too wide" as a constraint, so it is a DO block that runs once at
--    migrate time. It is the executable form of coordination §5.3 and the migration-time twin of the
--    `retailer sees no picklist` case in src/rls.test.ts.
DO $$
DECLARE t text; wide int; sel int; ins int; forced boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['picklists','pick_lines','pack_confirmations','load_sheets','delivery_challans']
  LOOP
    SELECT c.relforcerowsecurity INTO forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t;
    IF forced IS DISTINCT FROM true THEN
      RAISE EXCEPTION '% does not FORCE row level security; the warehouse policies would not bind the owner connection', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT count(*) FILTER (WHERE p.polcmd = '*'),
           count(*) FILTER (WHERE p.polcmd = 'r'),
           count(*) FILTER (WHERE p.polcmd = 'a')
      INTO wide, sel, ins
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t;
    IF wide > 0 THEN
      RAISE EXCEPTION '% still carries a FOR ALL policy; a retailer-role token could read the godown paperwork (coordination section 5.3)', t
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF sel = 0 OR ins = 0 THEN
      RAISE EXCEPTION '% needs both a SELECT and an INSERT policy after 0010 (found % select, % insert)', t, sel, ins
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
END;
$$;
