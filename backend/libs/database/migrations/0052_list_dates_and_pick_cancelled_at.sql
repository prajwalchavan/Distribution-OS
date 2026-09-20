ALTER TABLE "pick_lines" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "sales_orders_created_idx" ON "sales_orders" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "invoices_date_idx" ON "invoices" USING btree ("tenant_id","invoice_date","id");