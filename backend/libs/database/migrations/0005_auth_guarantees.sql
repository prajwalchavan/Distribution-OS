-- Hand-written companion to 0004_auth_and_warehouse_role.sql: the guarantees drizzle-kit cannot express.
-- 1. FORCE ROW LEVEL SECURITY so even the table owner obeys the policies (ADR 0002).
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- 2. The sign-in audit trail is append-only, like every other ledger: a lockout, a refresh-token reuse or a
--    revocation must stay explainable afterwards. dos_reject_mutation() is created by 0003; CREATE OR REPLACE
--    keeps this migration self-contained. auth_events also has no UPDATE/DELETE policy, so app_rw cannot
--    reach a row to mutate in the first place; the trigger is the guarantee for every other role.
CREATE OR REPLACE FUNCTION dos_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (ADR 0003/0004); write a compensating row instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER auth_events_append_only BEFORE UPDATE OR DELETE ON "auth_events" FOR EACH ROW EXECUTE FUNCTION dos_reject_mutation();--> statement-breakpoint
-- 3. Grants for the runtime roles, mirroring 0001 (app_rw) and 0003 (app_worker). Both migrations also set
--    ALTER DEFAULT PRIVILEGES in schema public, so tables created by the migrating role already carry these;
--    the explicit GRANTs are idempotent and keep the two new tables correct on a database whose default
--    privileges were changed by hand. RLS, not GRANT, is what separates the roles.
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_sessions" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_events" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_sessions" TO app_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_events" TO app_worker;
