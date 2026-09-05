CREATE TYPE "public"."file_domain" AS ENUM('logo', 'pod', 'expense', 'claim', 'import', 'damage', 'docs', 'invoices', 'challans', 'exports', 'statements', 'receipts');--> statement-breakpoint
CREATE TYPE "public"."file_object_status" AS ENUM('pending', 'uploaded', 'deleted');--> statement-breakpoint
CREATE TABLE "file_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"domain" "file_domain" NOT NULL,
	"entity_id" text NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text,
	"status" "file_object_status" DEFAULT 'pending' NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "audit_log_entity_idx";--> statement-breakpoint
ALTER TABLE "cycle_counts" ADD COLUMN "posted_by" text;--> statement-breakpoint
ALTER TABLE "inbound_discrepancies" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "dispute_reason" text;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "pdf_object_key" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "pdf_object_key" text;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_objects_key_idx" ON "file_objects" USING btree ("tenant_id","object_key");--> statement-breakpoint
CREATE INDEX "file_objects_entity_idx" ON "file_objects" USING btree ("tenant_id","domain","entity_id");--> statement-breakpoint
CREATE INDEX "file_objects_status_idx" ON "file_objects" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_discrepancies" ADD CONSTRAINT "inbound_discrepancies_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_sheets" ADD CONSTRAINT "load_sheets_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_time_idx" ON "audit_log" USING btree ("tenant_id","entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("tenant_id","actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sync_errors_device_idx" ON "sync_errors" USING btree ("tenant_id","device_id","created_at");--> statement-breakpoint
CREATE INDEX "tenant_products_updated_idx" ON "tenant_products" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "beat_assignments_beat_idx" ON "beat_assignments" USING btree ("tenant_id","beat_id","valid_from");--> statement-breakpoint
CREATE INDEX "retailers_updated_idx" ON "retailers" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "bargain_requests_retailer_idx" ON "bargain_requests" USING btree ("tenant_id","retailer_id","created_at");--> statement-breakpoint
CREATE INDEX "price_list_items_updated_idx" ON "price_list_items" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "retailer_price_overrides_updated_idx" ON "retailer_price_overrides" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "schemes_updated_idx" ON "schemes" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "cycle_counts_status_idx" ON "cycle_counts" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ageing_snapshots_as_of_idx" ON "ageing_snapshots" USING btree ("tenant_id","as_of");--> statement-breakpoint
DROP POLICY "memberships_tenant" ON "memberships" CASCADE;--> statement-breakpoint
DROP POLICY "tenants_own_row" ON "tenants" CASCADE;--> statement-breakpoint
DROP POLICY "audit_log_tenant" ON "audit_log" CASCADE;--> statement-breakpoint
DROP POLICY "feature_flags_tenant" ON "feature_flags" CASCADE;--> statement-breakpoint
DROP POLICY "sync_errors_tenant" ON "sync_errors" CASCADE;--> statement-breakpoint
DROP POLICY "rep_product_authorisations_tenant" ON "rep_product_authorisations" CASCADE;--> statement-breakpoint
DROP POLICY "supplier_pack_configs_tenant" ON "supplier_pack_configs" CASCADE;--> statement-breakpoint
DROP POLICY "suppliers_tenant" ON "suppliers" CASCADE;--> statement-breakpoint
DROP POLICY "tenant_brands_tenant" ON "tenant_brands" CASCADE;--> statement-breakpoint
DROP POLICY "tenant_products_tenant" ON "tenant_products" CASCADE;--> statement-breakpoint
DROP POLICY "beat_assignments_tenant" ON "beat_assignments" CASCADE;--> statement-breakpoint
DROP POLICY "beats_tenant" ON "beats" CASCADE;--> statement-breakpoint
DROP POLICY "pjp_tenant" ON "pjp" CASCADE;--> statement-breakpoint
DROP POLICY "visits_tenant" ON "visits" CASCADE;--> statement-breakpoint
DROP POLICY "bargain_requests_tenant" ON "bargain_requests" CASCADE;--> statement-breakpoint
DROP POLICY "price_list_items_tenant" ON "price_list_items" CASCADE;--> statement-breakpoint
DROP POLICY "price_lists_tenant" ON "price_lists" CASCADE;--> statement-breakpoint
DROP POLICY "rep_auto_approve_bounds_tenant" ON "rep_auto_approve_bounds" CASCADE;--> statement-breakpoint
DROP POLICY "retailer_price_overrides_tenant" ON "retailer_price_overrides" CASCADE;--> statement-breakpoint
DROP POLICY "schemes_tenant" ON "schemes" CASCADE;--> statement-breakpoint
DROP POLICY "cycle_count_lines_tenant" ON "cycle_count_lines" CASCADE;--> statement-breakpoint
DROP POLICY "cycle_counts_tenant" ON "cycle_counts" CASCADE;--> statement-breakpoint
DROP POLICY "locations_tenant" ON "locations" CASCADE;--> statement-breakpoint
DROP POLICY "reservations_tenant" ON "reservations" CASCADE;--> statement-breakpoint
DROP POLICY "stock_balances_tenant" ON "stock_balances" CASCADE;--> statement-breakpoint
DROP POLICY "stock_ledger_tenant" ON "stock_ledger" CASCADE;--> statement-breakpoint
DROP POLICY "stock_lots_tenant" ON "stock_lots" CASCADE;--> statement-breakpoint
DROP POLICY "approvals_tenant" ON "approvals" CASCADE;--> statement-breakpoint
DROP POLICY "grn_lines_tenant" ON "grn_lines" CASCADE;--> statement-breakpoint
DROP POLICY "grns_tenant" ON "grns" CASCADE;--> statement-breakpoint
DROP POLICY "inbound_discrepancies_tenant" ON "inbound_discrepancies" CASCADE;--> statement-breakpoint
DROP POLICY "lorry_receipts_tenant" ON "lorry_receipts" CASCADE;--> statement-breakpoint
CREATE POLICY "memberships_read" ON "memberships" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "memberships_write_insert" ON "memberships" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "memberships_write_update" ON "memberships" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "memberships_write_delete" ON "memberships" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "tenants_read" ON "tenants" AS PERMISSIVE FOR SELECT TO "app_rw" USING (id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "tenants_owner_update" ON "tenants" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')) WITH CHECK (id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system'));--> statement-breakpoint
CREATE POLICY "tenants_system_insert" ON "tenants" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK ((SELECT current_setting('app.actor_role', true)) = 'system');--> statement-breakpoint
CREATE POLICY "audit_log_read" ON "audit_log" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "audit_log_insert" ON "audit_log" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        actor_id = (SELECT current_setting('app.actor_id', true))
        OR (SELECT current_setting('app.actor_role', true)) = 'system'
      ));--> statement-breakpoint
CREATE POLICY "feature_flags_read" ON "feature_flags" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "feature_flags_write_insert" ON "feature_flags" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system'));--> statement-breakpoint
CREATE POLICY "feature_flags_write_update" ON "feature_flags" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system'));--> statement-breakpoint
CREATE POLICY "feature_flags_write_delete" ON "feature_flags" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system'));--> statement-breakpoint
CREATE POLICY "sync_errors_read" ON "sync_errors" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        user_id = (SELECT current_setting('app.actor_id', true))
        OR (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')
      ));--> statement-breakpoint
CREATE POLICY "sync_errors_insert" ON "sync_errors" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        user_id = (SELECT current_setting('app.actor_id', true))
        OR (SELECT current_setting('app.actor_role', true)) = 'system'
      ));--> statement-breakpoint
CREATE POLICY "sync_errors_resolve" ON "sync_errors" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        user_id = (SELECT current_setting('app.actor_id', true))
        OR (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')
      )) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "rep_product_authorisations_read" ON "rep_product_authorisations" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')
        OR user_id = (SELECT current_setting('app.actor_id', true))
      ));--> statement-breakpoint
CREATE POLICY "rep_product_authorisations_write_insert" ON "rep_product_authorisations" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "rep_product_authorisations_write_update" ON "rep_product_authorisations" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "rep_product_authorisations_write_delete" ON "rep_product_authorisations" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "supplier_pack_configs_read" ON "supplier_pack_configs" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "supplier_pack_configs_write_insert" ON "supplier_pack_configs" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "supplier_pack_configs_write_update" ON "supplier_pack_configs" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "supplier_pack_configs_write_delete" ON "supplier_pack_configs" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "suppliers_read" ON "suppliers" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "suppliers_write_insert" ON "suppliers" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "suppliers_write_update" ON "suppliers" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "suppliers_write_delete" ON "suppliers" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "tenant_brands_read" ON "tenant_brands" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "tenant_brands_write_insert" ON "tenant_brands" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "tenant_brands_write_update" ON "tenant_brands" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "tenant_brands_write_delete" ON "tenant_brands" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "tenant_products_read" ON "tenant_products" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "tenant_products_write_insert" ON "tenant_products" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "tenant_products_write_update" ON "tenant_products" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "tenant_products_write_delete" ON "tenant_products" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "beat_assignments_read" ON "beat_assignments" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "beat_assignments_write_insert" ON "beat_assignments" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "beat_assignments_write_update" ON "beat_assignments" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "beat_assignments_write_delete" ON "beat_assignments" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "beats_read" ON "beats" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "beats_write_insert" ON "beats" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "beats_write_update" ON "beats" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "beats_write_delete" ON "beats" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "pjp_read" ON "pjp" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "pjp_write_insert" ON "pjp" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "pjp_write_update" ON "pjp" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "pjp_write_delete" ON "pjp" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "retailers_retailer_update" ON "retailers" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        ));--> statement-breakpoint
CREATE POLICY "visits_read" ON "visits" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "visits_write_insert" ON "visits" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "visits_write_update" ON "visits" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "visits_write_delete" ON "visits" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "bargain_requests_read" ON "bargain_requests" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "bargain_requests_insert" ON "bargain_requests" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) NOT IN ('retailer', 'owner', 'manager', 'system')
            AND status IN ('requested', 'auto_approved')
            AND requested_by = (SELECT current_setting('app.actor_id', true)))
        OR ((SELECT current_setting('app.actor_role', true)) = 'retailer'
            AND status = 'requested'
            AND requested_by = (SELECT current_setting('app.actor_id', true))
            AND retailer_id IN (
              SELECT l.retailer_id FROM retailer_links l
              WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
                AND l.user_id = (SELECT current_setting('app.actor_id', true))
                AND l.status = 'active'
            ))
      ));--> statement-breakpoint
CREATE POLICY "bargain_requests_decide" ON "bargain_requests" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "price_list_items_read" ON "price_list_items" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "price_list_items_write_insert" ON "price_list_items" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "price_list_items_write_update" ON "price_list_items" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "price_list_items_write_delete" ON "price_list_items" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "price_lists_read" ON "price_lists" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "price_lists_write_insert" ON "price_lists" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "price_lists_write_update" ON "price_lists" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "price_lists_write_delete" ON "price_lists" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "rep_auto_approve_bounds_read" ON "rep_auto_approve_bounds" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')
        OR user_id = (SELECT current_setting('app.actor_id', true))
      ));--> statement-breakpoint
CREATE POLICY "rep_auto_approve_bounds_write_insert" ON "rep_auto_approve_bounds" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system'));--> statement-breakpoint
CREATE POLICY "rep_auto_approve_bounds_write_update" ON "rep_auto_approve_bounds" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system'));--> statement-breakpoint
CREATE POLICY "rep_auto_approve_bounds_write_delete" ON "rep_auto_approve_bounds" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system'));--> statement-breakpoint
CREATE POLICY "retailer_price_overrides_read" ON "retailer_price_overrides" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "retailer_price_overrides_write_insert" ON "retailer_price_overrides" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "retailer_price_overrides_write_update" ON "retailer_price_overrides" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "retailer_price_overrides_write_delete" ON "retailer_price_overrides" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "schemes_read" ON "schemes" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "schemes_write_insert" ON "schemes" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "schemes_write_update" ON "schemes" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "schemes_write_delete" ON "schemes" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "cycle_count_lines_read" ON "cycle_count_lines" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "cycle_count_lines_write_insert" ON "cycle_count_lines" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "cycle_count_lines_write_update" ON "cycle_count_lines" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "cycle_count_lines_write_delete" ON "cycle_count_lines" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "cycle_counts_read" ON "cycle_counts" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "cycle_counts_write_insert" ON "cycle_counts" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "cycle_counts_write_update" ON "cycle_counts" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "cycle_counts_write_delete" ON "cycle_counts" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "locations_read" ON "locations" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "locations_write_insert" ON "locations" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "locations_write_update" ON "locations" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "locations_write_delete" ON "locations" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "reservations_read" ON "reservations" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "reservations_write_insert" ON "reservations" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "reservations_write_update" ON "reservations" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "reservations_write_delete" ON "reservations" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "stock_balances_read" ON "stock_balances" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "stock_balances_write_insert" ON "stock_balances" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "stock_balances_write_update" ON "stock_balances" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "stock_balances_write_delete" ON "stock_balances" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "stock_ledger_read" ON "stock_ledger" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "stock_ledger_write_insert" ON "stock_ledger" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "stock_ledger_write_update" ON "stock_ledger" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "stock_ledger_write_delete" ON "stock_ledger" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "stock_lots_read" ON "stock_lots" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)));--> statement-breakpoint
CREATE POLICY "stock_lots_write_insert" ON "stock_lots" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "stock_lots_write_update" ON "stock_lots" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "stock_lots_write_delete" ON "stock_lots" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "approvals_read" ON "approvals" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "approvals_insert" ON "approvals" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "approvals_retailer_insert" ON "approvals" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND status = 'pending' AND requested_by = (SELECT current_setting('app.actor_id', true))
        AND EXISTS (
          SELECT 1 FROM sales_orders o
          WHERE o.id = approvals.order_id
            AND o.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND o.created_by = (SELECT current_setting('app.actor_id', true))
        ));--> statement-breakpoint
CREATE POLICY "approvals_update" ON "approvals" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR EXISTS (
          SELECT 1 FROM sales_orders o
          WHERE o.id = approvals.order_id AND o.created_by = (SELECT current_setting('app.actor_id', true))
        )
      )) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')
        OR status = 'expired'
      ));--> statement-breakpoint
CREATE POLICY "grn_lines_read" ON "grn_lines" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "grn_lines_write_insert" ON "grn_lines" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "grn_lines_write_update" ON "grn_lines" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "grn_lines_write_delete" ON "grn_lines" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "grns_read" ON "grns" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "grns_write_insert" ON "grns" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "grns_write_update" ON "grns" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "grns_write_delete" ON "grns" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "inbound_discrepancies_read" ON "inbound_discrepancies" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "inbound_discrepancies_write_insert" ON "inbound_discrepancies" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "inbound_discrepancies_write_update" ON "inbound_discrepancies" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "inbound_discrepancies_write_delete" ON "inbound_discrepancies" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "lorry_receipts_read" ON "lorry_receipts" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "lorry_receipts_write_insert" ON "lorry_receipts" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "lorry_receipts_write_update" ON "lorry_receipts" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "lorry_receipts_write_delete" ON "lorry_receipts" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "file_objects_read" ON "file_objects" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "file_objects_write_insert" ON "file_objects" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "file_objects_write_update" ON "file_objects" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "file_objects_write_delete" ON "file_objects" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));