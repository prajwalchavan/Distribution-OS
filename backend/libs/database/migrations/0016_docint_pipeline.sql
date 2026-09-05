CREATE TYPE "public"."document_qr_status" AS ENUM('absent', 'decoded', 'verified', 'signature_failed', 'mismatched');--> statement-breakpoint
DROP INDEX "extractions_document_idx";--> statement-breakpoint
DROP INDEX "sku_match_candidates_idx";--> statement-breakpoint
ALTER TABLE "document_pages" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "document_pages" ADD COLUMN "printed_page_label" text;--> statement-breakpoint
ALTER TABLE "document_pages" ADD COLUMN "qr_detected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "expected_pages" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "rejected_reason" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "prompt_profile" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "qr_status" "document_qr_status" DEFAULT 'absent' NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_checks" ADD COLUMN "line_no" integer;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "invoice_no" text;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "invoice_date" date;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "supplier_gstin" text;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "buyer_gstin" text;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "total_paise" bigint;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "line_count" integer;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "engine_version" text;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "escalated_from_extraction_id" text;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD COLUMN "edits_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sku_match_candidates" ADD COLUMN "matched_by" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "sku_match_candidates" ADD COLUMN "features" jsonb;--> statement-breakpoint
ALTER TABLE "supplier_aliases" ADD COLUMN "hits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_aliases" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "documents_supplier_idx" ON "documents" USING btree ("tenant_id","supplier_id","created_at");--> statement-breakpoint
CREATE INDEX "extraction_checks_failed_idx" ON "extraction_checks" USING btree ("tenant_id","extraction_id","passed");--> statement-breakpoint
CREATE INDEX "extractions_latest_idx" ON "extractions" USING btree ("tenant_id","document_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sku_match_candidates_unique_idx" ON "sku_match_candidates" USING btree ("tenant_id","extraction_id","line_no","variant_id");--> statement-breakpoint
ALTER POLICY "document_pages_tenant" ON "document_pages" TO app_rw USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_pages.document_id AND d.tenant_id = (SELECT current_setting('app.tenant_id', true)))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_pages.document_id AND d.tenant_id = (SELECT current_setting('app.tenant_id', true))));--> statement-breakpoint
ALTER POLICY "documents_tenant" ON "documents" TO app_rw USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer' AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system') OR kind IN ('pod', 'claim_sheet', 'other'))) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer' AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'warehouse', 'system') OR kind IN ('pod', 'claim_sheet', 'other')));