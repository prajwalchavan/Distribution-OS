ALTER TABLE "sales_orders" ADD COLUMN "refused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "undelivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retailer_outstanding_summary" ADD COLUMN "undelivered_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "invoices_undelivered_idx" ON "invoices" USING btree ("tenant_id","undelivered_at") WHERE undelivered_at IS NOT NULL;