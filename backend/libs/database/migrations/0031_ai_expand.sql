CREATE TYPE "public"."ai_draft_source" AS ENUM('whatsapp', 'voice', 'text');--> statement-breakpoint
CREATE TYPE "public"."ai_draft_status" AS ENUM('parsed', 'needs_review', 'confirmed', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."route_plan_method" AS ENUM('nearest_neighbour_2opt', 'manual');--> statement-breakpoint
CREATE TABLE "ai_forecasts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"horizon_days" integer NOT NULL,
	"expected_qty_pcs" integer DEFAULT 0 NOT NULL,
	"reorder_qty_pcs" integer DEFAULT 0 NOT NULL,
	"on_hand_pcs" integer DEFAULT 0 NOT NULL,
	"days_cover" integer,
	"method" text NOT NULL,
	"confidence_bps" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_forecasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_order_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"source" "ai_draft_source" NOT NULL,
	"retailer_id" text,
	"inbound_message_id" text,
	"raw_text" text,
	"audio_object_key" text,
	"transcript" text,
	"parsed_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_confidence_bps" integer DEFAULT 0 NOT NULL,
	"status" "ai_draft_status" DEFAULT 'parsed' NOT NULL,
	"created_order_id" text,
	"created_by" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"reject_reason" text,
	"provider" text,
	"model" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_order_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "route_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"method" "route_plan_method" NOT NULL,
	"sequence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_distance_m" integer DEFAULT 0 NOT NULL,
	"total_duration_s" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"applied_by" text,
	"overridden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "route_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_forecasts" ADD CONSTRAINT "ai_forecasts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_forecasts" ADD CONSTRAINT "ai_forecasts_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_forecasts" ADD CONSTRAINT "ai_forecasts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_order_drafts" ADD CONSTRAINT "ai_order_drafts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_order_drafts" ADD CONSTRAINT "ai_order_drafts_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_order_drafts" ADD CONSTRAINT "ai_order_drafts_inbound_message_id_inbound_messages_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."inbound_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_order_drafts" ADD CONSTRAINT "ai_order_drafts_created_order_id_sales_orders_id_fk" FOREIGN KEY ("created_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_order_drafts" ADD CONSTRAINT "ai_order_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_order_drafts" ADD CONSTRAINT "ai_order_drafts_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_forecasts_key_idx" ON "ai_forecasts" USING btree ("tenant_id","variant_id","location_id","horizon_days");--> statement-breakpoint
CREATE INDEX "ai_forecasts_cover_idx" ON "ai_forecasts" USING btree ("tenant_id","location_id","days_cover");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_order_drafts_idempotency_idx" ON "ai_order_drafts" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ai_order_drafts_status_idx" ON "ai_order_drafts" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ai_order_drafts_retailer_idx" ON "ai_order_drafts" USING btree ("tenant_id","retailer_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_order_drafts_created_by_idx" ON "ai_order_drafts" USING btree ("tenant_id","created_by","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_order_drafts_inbound_idx" ON "ai_order_drafts" USING btree ("tenant_id","inbound_message_id") WHERE inbound_message_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "route_plans_trip_idx" ON "route_plans" USING btree ("tenant_id","trip_id","computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "route_plans_applied_idx" ON "route_plans" USING btree ("tenant_id","trip_id") WHERE applied_at IS NOT NULL;--> statement-breakpoint
CREATE POLICY "ai_forecasts_read" ON "ai_forecasts" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "ai_forecasts_write_insert" ON "ai_forecasts" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('system'));--> statement-breakpoint
CREATE POLICY "ai_forecasts_write_update" ON "ai_forecasts" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('system'));--> statement-breakpoint
CREATE POLICY "ai_forecasts_write_delete" ON "ai_forecasts" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('system'));--> statement-breakpoint
CREATE POLICY "ai_order_drafts_read" ON "ai_order_drafts" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'salesperson' AND created_by = (SELECT current_setting('app.actor_id', true)))
        OR ((SELECT current_setting('app.actor_role', true)) = 'salesperson' AND EXISTS (
        SELECT 1 FROM retailers r
        JOIN beat_assignments ba ON ba.beat_id = r.beat_id AND ba.tenant_id = r.tenant_id
        WHERE r.id = ai_order_drafts.retailer_id
          AND r.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND ba.user_id = (SELECT current_setting('app.actor_id', true))
          AND ba.valid_from <= CURRENT_DATE
          AND (ba.valid_to IS NULL OR ba.valid_to >= CURRENT_DATE)
      ))
        OR ((SELECT current_setting('app.actor_role', true)) = 'retailer' AND ai_order_drafts.retailer_id IN (
        SELECT l.retailer_id FROM retailer_links l
        WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND l.user_id = (SELECT current_setting('app.actor_id', true))
          AND l.status = 'active'
      ))
      ));--> statement-breakpoint
CREATE POLICY "ai_order_drafts_insert" ON "ai_order_drafts" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'salesperson' AND created_by = (SELECT current_setting('app.actor_id', true)))
        OR ((SELECT current_setting('app.actor_role', true)) = 'salesperson' AND EXISTS (
        SELECT 1 FROM retailers r
        JOIN beat_assignments ba ON ba.beat_id = r.beat_id AND ba.tenant_id = r.tenant_id
        WHERE r.id = ai_order_drafts.retailer_id
          AND r.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND ba.user_id = (SELECT current_setting('app.actor_id', true))
          AND ba.valid_from <= CURRENT_DATE
          AND (ba.valid_to IS NULL OR ba.valid_to >= CURRENT_DATE)
      ))
        OR ((SELECT current_setting('app.actor_role', true)) = 'retailer' AND ai_order_drafts.retailer_id IN (
        SELECT l.retailer_id FROM retailer_links l
        WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND l.user_id = (SELECT current_setting('app.actor_id', true))
          AND l.status = 'active'
      ))
      ));--> statement-breakpoint
CREATE POLICY "ai_order_drafts_update" ON "ai_order_drafts" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'salesperson' AND created_by = (SELECT current_setting('app.actor_id', true)))
        OR ((SELECT current_setting('app.actor_role', true)) = 'salesperson' AND EXISTS (
        SELECT 1 FROM retailers r
        JOIN beat_assignments ba ON ba.beat_id = r.beat_id AND ba.tenant_id = r.tenant_id
        WHERE r.id = ai_order_drafts.retailer_id
          AND r.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND ba.user_id = (SELECT current_setting('app.actor_id', true))
          AND ba.valid_from <= CURRENT_DATE
          AND (ba.valid_to IS NULL OR ba.valid_to >= CURRENT_DATE)
      ))
        OR ((SELECT current_setting('app.actor_role', true)) = 'retailer' AND ai_order_drafts.retailer_id IN (
        SELECT l.retailer_id FROM retailer_links l
        WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND l.user_id = (SELECT current_setting('app.actor_id', true))
          AND l.status = 'active'
      ))
      )) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'salesperson' AND created_by = (SELECT current_setting('app.actor_id', true)))
        OR ((SELECT current_setting('app.actor_role', true)) = 'salesperson' AND EXISTS (
        SELECT 1 FROM retailers r
        JOIN beat_assignments ba ON ba.beat_id = r.beat_id AND ba.tenant_id = r.tenant_id
        WHERE r.id = ai_order_drafts.retailer_id
          AND r.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND ba.user_id = (SELECT current_setting('app.actor_id', true))
          AND ba.valid_from <= CURRENT_DATE
          AND (ba.valid_to IS NULL OR ba.valid_to >= CURRENT_DATE)
      ))
        OR ((SELECT current_setting('app.actor_role', true)) = 'retailer' AND ai_order_drafts.retailer_id IN (
        SELECT l.retailer_id FROM retailer_links l
        WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
          AND l.user_id = (SELECT current_setting('app.actor_id', true))
          AND l.status = 'active'
      ))
      ));--> statement-breakpoint
CREATE POLICY "route_plans_read" ON "route_plans" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
              SELECT 1 FROM trips t
              WHERE t.id = route_plans.trip_id
                AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
            ))
      ));--> statement-breakpoint
CREATE POLICY "route_plans_insert" ON "route_plans" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "route_plans_update" ON "route_plans" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
              SELECT 1 FROM trips t
              WHERE t.id = route_plans.trip_id
                AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
            ))
      )) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) = 'delivery' AND EXISTS (
              SELECT 1 FROM trips t
              WHERE t.id = route_plans.trip_id
                AND (t.driver_id = (SELECT current_setting('app.actor_id', true)) OR t.helper_id = (SELECT current_setting('app.actor_id', true)))
            ))
      ));