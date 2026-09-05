CREATE TYPE "public"."load_sheet_status" AS ENUM('draft', 'confirmed', 'cancelled');--> statement-breakpoint
DROP INDEX "pack_confirmations_order_idx";--> statement-breakpoint
ALTER TABLE "load_sheets" ALTER COLUMN "trip_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_challans" ADD COLUMN "series_code" text DEFAULT 'DC' NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_challans" ADD COLUMN "load_value_gst_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD COLUMN "status" "load_sheet_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD COLUMN "sheet_date" date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date NOT NULL;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD COLUMN "expected_packages" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD COLUMN "counted_packages" integer;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD COLUMN "variance_note" text;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD COLUMN "pin_verified_by" text;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD COLUMN "ewb_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "pack_confirmations" ADD COLUMN "picklist_id" text;--> statement-breakpoint
ALTER TABLE "pack_confirmations" ADD COLUMN "short_packed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD COLUMN "variant_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD COLUMN "line_no" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD COLUMN "suggested_lot_id" text;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD COLUMN "free_qty_pcs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD COLUMN "case_size" integer;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD COLUMN "fefo_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "picklists" ADD COLUMN "pick_date" date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date NOT NULL;--> statement-breakpoint
ALTER TABLE "picklists" ADD COLUMN "trip_id" text;--> statement-breakpoint
ALTER TABLE "picklists" ADD COLUMN "beat_id" text;--> statement-breakpoint
ALTER TABLE "picklists" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "picklists" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "picklists" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD CONSTRAINT "load_sheets_pin_verified_by_users_id_fk" FOREIGN KEY ("pin_verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_confirmations" ADD CONSTRAINT "pack_confirmations_picklist_id_picklists_id_fk" FOREIGN KEY ("picklist_id") REFERENCES "public"."picklists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_lines" ADD CONSTRAINT "pick_lines_suggested_lot_id_stock_lots_id_fk" FOREIGN KEY ("suggested_lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picklists" ADD CONSTRAINT "picklists_beat_id_beats_id_fk" FOREIGN KEY ("beat_id") REFERENCES "public"."beats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_challans_no_idx" ON "delivery_challans" USING btree ("tenant_id","series_code","fy","challan_no") WHERE challan_no IS NOT NULL;--> statement-breakpoint
CREATE INDEX "load_sheets_status_idx" ON "load_sheets" USING btree ("tenant_id","status","sheet_date");--> statement-breakpoint
CREATE INDEX "load_sheets_to_location_idx" ON "load_sheets" USING btree ("tenant_id","to_location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pack_confirmations_order_uniq" ON "pack_confirmations" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "pick_lines_variant_idx" ON "pick_lines" USING btree ("tenant_id","picklist_id","variant_id");--> statement-breakpoint
CREATE INDEX "pick_lines_order_line_idx" ON "pick_lines" USING btree ("tenant_id","order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "picklists_no_idx" ON "picklists" USING btree ("tenant_id","picklist_no") WHERE picklist_no IS NOT NULL;--> statement-breakpoint
CREATE INDEX "picklists_trip_idx" ON "picklists" USING btree ("tenant_id","trip_id");--> statement-breakpoint
DROP POLICY "delivery_challans_tenant" ON "delivery_challans" CASCADE;--> statement-breakpoint
DROP POLICY "load_sheets_tenant" ON "load_sheets" CASCADE;--> statement-breakpoint
DROP POLICY "pack_confirmations_tenant" ON "pack_confirmations" CASCADE;--> statement-breakpoint
DROP POLICY "pick_lines_tenant" ON "pick_lines" CASCADE;--> statement-breakpoint
DROP POLICY "picklists_tenant" ON "picklists" CASCADE;--> statement-breakpoint
CREATE POLICY "delivery_challans_read" ON "delivery_challans" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "delivery_challans_write_insert" ON "delivery_challans" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "delivery_challans_write_update" ON "delivery_challans" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "delivery_challans_write_delete" ON "delivery_challans" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "load_sheets_read" ON "load_sheets" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "load_sheets_write_insert" ON "load_sheets" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "load_sheets_write_update" ON "load_sheets" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "load_sheets_write_delete" ON "load_sheets" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "pack_confirmations_read" ON "pack_confirmations" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "pack_confirmations_write_insert" ON "pack_confirmations" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "pack_confirmations_write_update" ON "pack_confirmations" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "pack_confirmations_write_delete" ON "pack_confirmations" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "pick_lines_read" ON "pick_lines" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "pick_lines_write_insert" ON "pick_lines" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "pick_lines_write_update" ON "pick_lines" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "pick_lines_write_delete" ON "pick_lines" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "picklists_read" ON "picklists" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "picklists_write_insert" ON "picklists" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "picklists_write_update" ON "picklists" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "picklists_write_delete" ON "picklists" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));