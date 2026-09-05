CREATE TYPE "public"."claim_period_kind" AS ENUM('monthly', 'fortnightly', 'quarterly', 'adhoc');--> statement-breakpoint
CREATE TYPE "public"."claim_value_basis" AS ENUM('ptd', 'landed_cost', 'mrp', 'invoice_rate', 'scheme_amount');--> statement-breakpoint
CREATE TYPE "public"."claim_line_status" AS ENUM('open', 'claimed', 'settled', 'rejected', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."claim_settlement_mode" AS ENUM('credit_note', 'bank_receipt', 'goods_replacement', 'adjustment');--> statement-breakpoint
ALTER TYPE "public"."claim_status" ADD VALUE 'written_off';--> statement-breakpoint
CREATE TABLE "claim_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"settled_on" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"mode" "claim_settlement_mode" NOT NULL,
	"external_ref" text,
	"document_id" text,
	"grn_id" text,
	"journal_entry_id" text,
	"note" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_settlements_amount_positive" CHECK (amount_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "claim_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_statements" ALTER COLUMN "object_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_statements" ALTER COLUMN "generated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "return_policies" ADD COLUMN "claim_period_kind" "claim_period_kind" DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "return_policies" ADD COLUMN "claim_cutoff_day" integer;--> statement-breakpoint
ALTER TABLE "return_policies" ADD COLUMN "settlement_days" integer;--> statement-breakpoint
ALTER TABLE "return_policies" ADD COLUMN "damage_value_basis" "claim_value_basis" DEFAULT 'ptd' NOT NULL;--> statement-breakpoint
ALTER TABLE "return_policies" ADD COLUMN "expiry_value_basis" "claim_value_basis" DEFAULT 'ptd' NOT NULL;--> statement-breakpoint
ALTER TABLE "return_policies" ADD COLUMN "claim_supplier_id" text;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD COLUMN "kind" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD COLUMN "line_no" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD COLUMN "status" "claim_line_status" DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD COLUMN "retailer_id" text;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD COLUMN "lot_id" text;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD COLUMN "batch_no" text;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD COLUMN "expiry_date" date;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD COLUMN "case_size" integer;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD COLUMN "mrp_paise" bigint;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD COLUMN "rate_paise" bigint;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD COLUMN "basis" "claim_value_basis";--> statement-breakpoint
ALTER TABLE "claim_lines" ADD COLUMN "settled_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_statements" ADD COLUMN "export_job_id" text;--> statement-breakpoint
ALTER TABLE "claim_statements" ADD COLUMN "row_count" integer;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "claim_channel" "claim_channel" DEFAULT 'dos' NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "written_off_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "accrued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "submitted_by" text;--> statement-breakpoint
ALTER TABLE "claim_settlements" ADD CONSTRAINT "claim_settlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_settlements" ADD CONSTRAINT "claim_settlements_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_settlements" ADD CONSTRAINT "claim_settlements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_settlements_claim_idx" ON "claim_settlements" USING btree ("tenant_id","claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_settlements_ref_idx" ON "claim_settlements" USING btree ("tenant_id","claim_id","external_ref") WHERE external_ref IS NOT NULL;--> statement-breakpoint
ALTER TABLE "return_policies" ADD CONSTRAINT "return_policies_claim_supplier_id_suppliers_id_fk" FOREIGN KEY ("claim_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_lines_status_idx" ON "claim_lines" USING btree ("tenant_id","claim_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_lines_source_unique_idx" ON "claim_lines" USING btree ("tenant_id","source_type","source_id") WHERE status <> 'rejected';--> statement-breakpoint
CREATE INDEX "claims_due_idx" ON "claims" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_open_period_idx" ON "claims" USING btree ("tenant_id","supplier_id",coalesce(brand_id, ''),"kind","period_from","period_to") WHERE status <> 'rejected';--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_has_target" CHECK (document_id IS NOT NULL OR object_key IS NOT NULL);--> statement-breakpoint
ALTER TABLE "claim_lines" ADD CONSTRAINT "claim_lines_settled_within_amount" CHECK (settled_paise <= amount_paise);--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_settled_within_claimed" CHECK (settled_paise + written_off_paise <= claimed_paise);--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_period_order" CHECK (period_from <= period_to);--> statement-breakpoint
DROP POLICY "return_policies_tenant" ON "return_policies" CASCADE;--> statement-breakpoint
CREATE POLICY "return_policies_read" ON "return_policies" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "return_policies_write_insert" ON "return_policies" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system'));--> statement-breakpoint
CREATE POLICY "return_policies_write_update" ON "return_policies" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system'));--> statement-breakpoint
CREATE POLICY "return_policies_write_delete" ON "return_policies" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system'));--> statement-breakpoint
CREATE POLICY "claim_settlements_back_office" ON "claim_settlements" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));