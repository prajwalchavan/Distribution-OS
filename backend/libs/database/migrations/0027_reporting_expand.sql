CREATE TABLE "daily_owner_stats" (
	"tenant_id" text NOT NULL,
	"day" date NOT NULL,
	"net_sales_paise" bigint DEFAULT 0 NOT NULL,
	"cogs_paise" bigint DEFAULT 0 NOT NULL,
	"gross_margin_paise" bigint DEFAULT 0 NOT NULL,
	"stock_value_paise" bigint DEFAULT 0 NOT NULL,
	"near_expiry_value_paise" bigint DEFAULT 0 NOT NULL,
	"scheme_spend_company_paise" bigint DEFAULT 0 NOT NULL,
	"scheme_spend_distributor_paise" bigint DEFAULT 0 NOT NULL,
	"by_brand" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_owner_stats_tenant_id_day_pk" PRIMARY KEY("tenant_id","day"),
	CONSTRAINT "daily_owner_stats_margin_identity" CHECK (gross_margin_paise = net_sales_paise - cogs_paise),
	CONSTRAINT "daily_owner_stats_values_nonnegative" CHECK (stock_value_paise >= 0 AND near_expiry_value_paise >= 0 AND scheme_spend_company_paise >= 0 AND scheme_spend_distributor_paise >= 0)
);
--> statement-breakpoint
ALTER TABLE "daily_owner_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_retailer_stats" (
	"tenant_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"day" date NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"invoiced_paise" bigint DEFAULT 0 NOT NULL,
	"collected_paise" bigint DEFAULT 0 NOT NULL,
	"lines_sold" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_retailer_stats_tenant_id_retailer_id_day_pk" PRIMARY KEY("tenant_id","retailer_id","day"),
	CONSTRAINT "daily_retailer_stats_counts_nonnegative" CHECK (orders_count >= 0 AND lines_sold >= 0)
);
--> statement-breakpoint
ALTER TABLE "daily_retailer_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" ADD COLUMN "overdue_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" ADD COLUMN "partial_stops" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" ADD COLUMN "on_time_stops" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" ADD COLUMN "pod_stops" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" ADD COLUMN "ordered_pcs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" ADD COLUMN "picked_pcs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" ADD COLUMN "by_category" jsonb;--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" ADD COLUMN "by_beat" jsonb;--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" ADD COLUMN "by_payment_mode" jsonb;--> statement-breakpoint
ALTER TABLE "daily_owner_stats" ADD CONSTRAINT "daily_owner_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_retailer_stats" ADD CONSTRAINT "daily_retailer_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_retailer_stats" ADD CONSTRAINT "daily_retailer_stats_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_retailer_stats_day_idx" ON "daily_retailer_stats" USING btree ("tenant_id","day");--> statement-breakpoint
CREATE INDEX "daily_rep_stats_day_idx" ON "daily_rep_stats" USING btree ("tenant_id","day");--> statement-breakpoint
ALTER TABLE "daily_tenant_stats" ADD CONSTRAINT "daily_tenant_stats_counts_nonnegative" CHECK (orders_count >= 0 AND delivered_stops >= 0 AND partial_stops >= 0 AND failed_stops >= 0 AND on_time_stops >= 0 AND pod_stops >= 0 AND ordered_pcs >= 0 AND picked_pcs >= 0 AND active_retailers >= 0);--> statement-breakpoint
DROP POLICY "daily_tenant_stats_tenant" ON "daily_tenant_stats" CASCADE;--> statement-breakpoint
DROP POLICY "retailer_behaviour_tenant" ON "retailer_behaviour" CASCADE;--> statement-breakpoint
CREATE POLICY "daily_tenant_stats_staff" ON "daily_tenant_stats" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "retailer_behaviour_staff" ON "retailer_behaviour" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "daily_owner_stats_back_office" ON "daily_owner_stats" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "daily_retailer_stats_staff" ON "daily_retailer_stats" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));