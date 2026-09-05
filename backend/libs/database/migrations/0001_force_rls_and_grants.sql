-- ADR 0002: the runtime role obeys RLS on every tenant table, even as table owner, and has only DML rights.
-- `app_rw` is created by the previous migration (drizzle-kit manages the role); this migration grants it access.
GRANT USAGE ON SCHEMA public TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_rw;--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_ops" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_errors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "numbering_series" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;
