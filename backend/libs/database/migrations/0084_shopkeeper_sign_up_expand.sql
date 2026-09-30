-- Generated (drizzle-kit): expand-only. The shopkeeper's own account (founder, 2026-09-29, docs/22 §8 "The
-- shopkeeper is independent"): a shopkeeper signs up alone, asks to be joined to a distributor's shop, and that
-- distributor's owner or manager approves.
-- (1) users.signed_up_at / users.shop_name: the login the person made themselves, and the shop's name as they call it.
--     Both null for every login a desk made; nothing is backfilled.
-- (2) retailers.shop_code: the code printed on the bill that finds the distributor and the shop. Added NULLABLE here,
--     with its platform-wide unique index; 0085 makes one for every existing shop, then gives the column its default
--     (dos_new_shop_code()) and NOT NULL.
-- (3) shop_join_requests: who asks, which distributor, which shop, the typed name, the state and the decision, with
--     its policies (the distributor's owner and manager; the asker's own rows). FORCE RLS, the grants, the guard
--     trigger and the assertion are in the hand-written 0085.
CREATE TYPE "public"."shop_join_state" AS ENUM('waiting', 'approved', 'refused', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."shop_join_via" AS ENUM('code', 'name');--> statement-breakpoint
CREATE TABLE "shop_join_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"via" "shop_join_via" NOT NULL,
	"retailer_id" text,
	"shop_name" text NOT NULL,
	"person_name" text NOT NULL,
	"person_phone" text NOT NULL,
	"state" "shop_join_state" DEFAULT 'waiting' NOT NULL,
	"reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_join_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signed_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "shop_name" text;--> statement-breakpoint
ALTER TABLE "retailers" ADD COLUMN "shop_code" text;--> statement-breakpoint
ALTER TABLE "shop_join_requests" ADD CONSTRAINT "shop_join_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_join_requests" ADD CONSTRAINT "shop_join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_join_requests" ADD CONSTRAINT "shop_join_requests_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_join_requests" ADD CONSTRAINT "shop_join_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_join_requests_tenant_state_idx" ON "shop_join_requests" USING btree ("tenant_id","state","created_at");--> statement-breakpoint
CREATE INDEX "shop_join_requests_user_idx" ON "shop_join_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_join_requests_waiting_idx" ON "shop_join_requests" USING btree ("tenant_id","user_id",coalesce("retailer_id", '')) WHERE state = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX "retailers_shop_code_idx" ON "retailers" USING btree ("shop_code");--> statement-breakpoint
CREATE POLICY "shop_join_requests_desk_read" ON "shop_join_requests" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "shop_join_requests_desk_update" ON "shop_join_requests" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "shop_join_requests_own_read" ON "shop_join_requests" AS PERMISSIVE FOR SELECT TO "app_rw" USING (user_id = (SELECT current_setting('app.actor_id', true)));--> statement-breakpoint
CREATE POLICY "shop_join_requests_own_insert" ON "shop_join_requests" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (user_id = (SELECT current_setting('app.actor_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer' AND state = 'waiting' AND decided_by IS NULL AND decided_at IS NULL);--> statement-breakpoint
CREATE POLICY "shop_join_requests_own_withdraw" ON "shop_join_requests" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (user_id = (SELECT current_setting('app.actor_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer' AND state = 'waiting') WITH CHECK (user_id = (SELECT current_setting('app.actor_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer' AND state = 'withdrawn' AND decided_by IS NULL);