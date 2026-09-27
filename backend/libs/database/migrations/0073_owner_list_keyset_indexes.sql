-- Generated (drizzle-kit): expand-only, indexes only. UX-O-8 / verifier finding 6 (owner-ux repair).
-- Messages, export jobs, GRNs, purchase orders and supplier bills now list newest first on their window column
-- with the id as the tie-break, keyset-paged on (column, id). Without a (tenant_id, column, id) index an
-- unfiltered page sorted every row of the tenant; with it the page is an index walk that stops at the limit.
CREATE INDEX "grns_created_idx" ON "grns" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "purchase_orders_created_idx" ON "purchase_orders" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "supplier_invoices_date_idx" ON "supplier_invoices" USING btree ("tenant_id","invoice_date","id");--> statement-breakpoint
CREATE INDEX "messages_created_idx" ON "messages" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "export_jobs_created_idx" ON "export_jobs" USING btree ("tenant_id","created_at","id");
