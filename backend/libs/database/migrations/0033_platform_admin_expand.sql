CREATE TYPE "public"."platform_admin_role" AS ENUM('super', 'support', 'billing');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'past_due', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."support_grant_scope" AS ENUM('read', 'read_write');--> statement-breakpoint
ALTER TYPE "public"."tenant_plan" ADD VALUE 'standard';--> statement-breakpoint
ALTER TYPE "public"."tenant_plan" ADD VALUE 'pro';--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" "platform_admin_role" NOT NULL,
	"created_by" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text NOT NULL,
	"action" text NOT NULL,
	"tenant_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plan" "tenant_plan" NOT NULL,
	"status" "subscription_status" DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"period_start" date,
	"period_end" date,
	"seats" integer DEFAULT 0 NOT NULL,
	"price_paise_month" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"admin_user_id" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"scope" "support_grant_scope" DEFAULT 'read' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "onboarded_by" text;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit" ADD CONSTRAINT "platform_audit_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit" ADD CONSTRAINT "platform_audit_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_user_idx" ON "platform_admins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_admins_active_idx" ON "platform_admins" USING btree ("role","created_at") WHERE disabled_at IS NULL;--> statement-breakpoint
CREATE INDEX "platform_audit_admin_idx" ON "platform_audit" USING btree ("admin_user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_tenant_idx" ON "platform_audit" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_action_idx" ON "platform_audit" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_tenant_idx" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "support_grants_tenant_idx" ON "support_grants" USING btree ("tenant_id","requested_at");--> statement-breakpoint
CREATE INDEX "support_grants_admin_idx" ON "support_grants" USING btree ("admin_user_id","requested_at");--> statement-breakpoint
CREATE INDEX "support_grants_live_idx" ON "support_grants" USING btree ("expires_at") WHERE revoked_at IS NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_onboarded_by_users_id_fk" FOREIGN KEY ("onboarded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenants_platform_read" ON "tenants" AS PERMISSIVE FOR SELECT TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system'));--> statement-breakpoint
CREATE POLICY "tenants_platform_insert" ON "tenants" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) = 'platform_admin');--> statement-breakpoint
CREATE POLICY "tenants_platform_update" ON "tenants" AS PERMISSIVE FOR UPDATE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) = 'platform_admin') WITH CHECK ((SELECT current_setting('app.actor_role', true)) = 'platform_admin');--> statement-breakpoint
CREATE POLICY "platform_admins_read" ON "platform_admins" AS PERMISSIVE FOR SELECT TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system'));--> statement-breakpoint
CREATE POLICY "platform_admins_write_insert" ON "platform_admins" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system'));--> statement-breakpoint
CREATE POLICY "platform_admins_write_update" ON "platform_admins" AS PERMISSIVE FOR UPDATE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system')) WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system'));--> statement-breakpoint
CREATE POLICY "platform_audit_read" ON "platform_audit" AS PERMISSIVE FOR SELECT TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system'));--> statement-breakpoint
CREATE POLICY "platform_audit_insert" ON "platform_audit" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (((SELECT current_setting('app.actor_role', true)) = 'platform_admin'
          AND admin_user_id = (SELECT current_setting('app.actor_id', true)))
        OR (SELECT current_setting('app.actor_role', true)) = 'system');--> statement-breakpoint
CREATE POLICY "subscriptions_read" ON "subscriptions" AS PERMISSIVE FOR SELECT TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system'));--> statement-breakpoint
CREATE POLICY "subscriptions_write_insert" ON "subscriptions" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system'));--> statement-breakpoint
CREATE POLICY "subscriptions_write_update" ON "subscriptions" AS PERMISSIVE FOR UPDATE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system')) WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system'));--> statement-breakpoint
CREATE POLICY "support_grants_read" ON "support_grants" AS PERMISSIVE FOR SELECT TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'owner'
            AND tenant_id = (SELECT current_setting('app.tenant_id', true))));--> statement-breakpoint
CREATE POLICY "support_grants_insert" ON "support_grants" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system'));--> statement-breakpoint
CREATE POLICY "support_grants_update" ON "support_grants" AS PERMISSIVE FOR UPDATE TO "app_rw" USING ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'owner'
            AND tenant_id = (SELECT current_setting('app.tenant_id', true)))) WITH CHECK ((SELECT current_setting('app.actor_role', true)) IN ('platform_admin', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'owner'
            AND tenant_id = (SELECT current_setting('app.tenant_id', true))));