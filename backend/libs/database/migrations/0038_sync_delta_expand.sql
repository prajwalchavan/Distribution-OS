CREATE TABLE "sync_tombstones" (
	"tenant_id" text NOT NULL,
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text DEFAULT 'deleted' NOT NULL,
	CONSTRAINT "sync_tombstones_tenant_id_table_name_row_id_pk" PRIMARY KEY("tenant_id","table_name","row_id")
);
--> statement-breakpoint
ALTER TABLE "sync_tombstones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_challans" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_challans" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "sync_tombstones_pull_idx" ON "sync_tombstones" USING btree ("tenant_id","deleted_at");--> statement-breakpoint
CREATE INDEX "sync_tombstones_table_idx" ON "sync_tombstones" USING btree ("tenant_id","table_name","deleted_at");--> statement-breakpoint
CREATE INDEX "brands_updated_idx" ON "brands" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "manufacturers_updated_idx" ON "manufacturers" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "product_variants_updated_idx" ON "product_variants" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "products_updated_idx" ON "products" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "beat_assignments_updated_idx" ON "beat_assignments" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "beats_updated_idx" ON "beats" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "pjp_updated_idx" ON "pjp" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "retailer_links_updated_idx" ON "retailer_links" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "visits_updated_idx" ON "visits" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "bargain_requests_updated_idx" ON "bargain_requests" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "price_lists_updated_idx" ON "price_lists" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "locations_updated_idx" ON "locations" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "stock_balances_updated_idx" ON "stock_balances" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "stock_lots_updated_idx" ON "stock_lots" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "sales_order_lines_updated_idx" ON "sales_order_lines" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "sales_orders_updated_idx" ON "sales_orders" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "delivery_challans_updated_idx" ON "delivery_challans" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "load_sheets_updated_idx" ON "load_sheets" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "pack_confirmations_updated_idx" ON "pack_confirmations" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "pick_lines_updated_idx" ON "pick_lines" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "picklists_updated_idx" ON "picklists" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "credit_note_lines_updated_idx" ON "credit_note_lines" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "credit_notes_updated_idx" ON "credit_notes" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "invoice_lines_updated_idx" ON "invoice_lines" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "invoices_updated_idx" ON "invoices" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "receipts_updated_idx" ON "receipts" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "retailer_outstanding_updated_idx" ON "retailer_outstanding_summary" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "deliveries_updated_idx" ON "deliveries" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "delivery_lines_updated_idx" ON "delivery_lines" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "trip_stops_updated_idx" ON "trip_stops" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "trips_updated_idx" ON "trips" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "vehicles_updated_idx" ON "vehicles" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE POLICY "sync_tombstones_read" ON "sync_tombstones" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) OR tenant_id = '*');