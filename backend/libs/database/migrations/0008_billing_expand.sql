CREATE INDEX "credit_notes_retailer_idx" ON "credit_notes" USING btree ("tenant_id","retailer_id","note_date");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_order_active_idx" ON "invoices" USING btree ("tenant_id","order_id") WHERE order_id IS NOT NULL AND state <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_external_no_idx" ON "invoices" USING btree ("tenant_id","external_invoice_no") WHERE external_invoice_no IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invoices_source_date_idx" ON "invoices" USING btree ("tenant_id","source","invoice_date");