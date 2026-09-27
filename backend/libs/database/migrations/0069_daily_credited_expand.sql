ALTER TABLE "daily_tenant_stats" ADD COLUMN "credited_paise" bigint;--> statement-breakpoint
CREATE INDEX "credit_notes_date_idx" ON "credit_notes" USING btree ("tenant_id","note_date");