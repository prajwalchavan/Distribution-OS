CREATE TYPE "public"."membership_role" AS ENUM('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'retailer');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('curator', 'support');--> statement-breakpoint
CREATE TYPE "public"."tenant_plan" AS ENUM('pilot', 'starter', 'growth');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'closed');--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN CREATE ROLE "app_rw"; END IF;
END $$;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text NOT NULL,
	"gstin" text,
	"state_code" text NOT NULL,
	"plan" "tenant_plan" DEFAULT 'pilot' NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"locale" text DEFAULT 'hi-IN' NOT NULL,
	"platform_role" "platform_role",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "numbering_series" (
	"tenant_id" text NOT NULL,
	"series_code" text NOT NULL,
	"fy" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"next_no" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "numbering_series_tenant_id_series_code_fy_pk" PRIMARY KEY("tenant_id","series_code","fy")
);
--> statement-breakpoint
ALTER TABLE "numbering_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_errors" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"op_id" text NOT NULL,
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"code" text NOT NULL,
	"message_hi" text NOT NULL,
	"message_en" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_errors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_ops" (
	"tenant_id" text NOT NULL,
	"device_id" text NOT NULL,
	"op_id" text NOT NULL,
	"outcome" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_ops_tenant_id_device_id_op_id_pk" PRIMARY KEY("tenant_id","device_id","op_id")
);
--> statement-breakpoint
ALTER TABLE "sync_ops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbering_series" ADD CONSTRAINT "numbering_series_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_errors" ADD CONSTRAINT "sync_errors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_ops" ADD CONSTRAINT "sync_ops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_idx" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_idx" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox_events" USING btree ("created_at") WHERE published_at IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "sync_errors_user_idx" ON "sync_errors" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE POLICY "memberships_tenant" ON "memberships" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "tenants_own_row" ON "tenants" AS PERMISSIVE FOR ALL TO "app_rw" USING (id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "users_visible" ON "users" AS PERMISSIVE FOR SELECT TO "app_rw" USING (id = (SELECT current_setting('app.actor_id', true)) OR EXISTS (
        SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.tenant_id = (SELECT current_setting('app.tenant_id', true))
      ));--> statement-breakpoint
CREATE POLICY "users_self_update" ON "users" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (id = (SELECT current_setting('app.actor_id', true)));--> statement-breakpoint
CREATE POLICY "users_insert" ON "users" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "idempotency_tenant" ON "idempotency_keys" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "numbering_series_tenant" ON "numbering_series" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "outbox_tenant" ON "outbox_events" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "sync_errors_tenant" ON "sync_errors" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "sync_ops_tenant" ON "sync_ops" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));