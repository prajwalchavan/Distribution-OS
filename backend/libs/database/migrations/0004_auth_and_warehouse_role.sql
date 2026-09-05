CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."auth_event_kind" AS ENUM('login_ok', 'login_failed', 'locked', 'refresh', 'refresh_reuse_detected', 'logout', 'password_changed', 'password_set_by_admin', 'tenant_switched', 'session_revoked');--> statement-breakpoint
ALTER TYPE "public"."membership_role" ADD VALUE 'warehouse';--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"username_attempted" text,
	"tenant_id" text,
	"kind" "auth_event_kind" NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text,
	"role" "membership_role",
	"device_id" text NOT NULL,
	"device_name" text,
	"platform" "device_platform",
	"refresh_token_hash" text NOT NULL,
	"previous_refresh_token_hash" text,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" "user_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_events_user_idx" ON "auth_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_events_username_idx" ON "auth_events" USING btree ("username_attempted","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_refresh_hash_idx" ON "auth_sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree (lower("username")) WHERE username is not null;--> statement-breakpoint
CREATE POLICY "order_state_transitions_retailer_insert" ON "order_state_transitions" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND actor_id = (SELECT current_setting('app.actor_id', true))
        AND EXISTS (
          SELECT 1 FROM sales_orders o
          WHERE o.id = order_state_transitions.order_id
            AND o.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND o.retailer_id IN (
              SELECT l.retailer_id FROM retailer_links l
              WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
                AND l.user_id = (SELECT current_setting('app.actor_id', true))
                AND l.status = 'active'
            )
        ));--> statement-breakpoint
CREATE POLICY "auth_events_own_read" ON "auth_events" AS PERMISSIVE FOR SELECT TO "app_rw" USING (user_id = (SELECT current_setting('app.actor_id', true))
        OR (SELECT current_setting('app.actor_role', true)) = 'system');--> statement-breakpoint
CREATE POLICY "auth_events_insert" ON "auth_events" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "auth_sessions_own" ON "auth_sessions" AS PERMISSIVE FOR ALL TO "app_rw" USING (user_id = (SELECT current_setting('app.actor_id', true))) WITH CHECK (user_id = (SELECT current_setting('app.actor_id', true)));--> statement-breakpoint
CREATE POLICY "auth_sessions_admin_read" ON "auth_sessions" AS PERMISSIVE FOR SELECT TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) = 'system'
        OR ((SELECT current_setting('app.actor_role', true)) = 'owner'
            AND tenant_id = (SELECT current_setting('app.tenant_id', true))));--> statement-breakpoint
ALTER POLICY "sales_orders_retailer_update" ON "sales_orders" TO app_rw USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND created_by = (SELECT current_setting('app.actor_id', true)) AND state IN ('draft', 'submitted')) WITH CHECK (state IN ('draft', 'submitted', 'cancelled'));