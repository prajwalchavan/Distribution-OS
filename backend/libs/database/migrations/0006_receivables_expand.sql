CREATE TABLE "retailer_outstanding_summary" (
	"tenant_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"outstanding_paise" bigint DEFAULT 0 NOT NULL,
	"overdue_paise" bigint DEFAULT 0 NOT NULL,
	"unallocated_credit_paise" bigint DEFAULT 0 NOT NULL,
	"open_bills" integer DEFAULT 0 NOT NULL,
	"oldest_due_date" date,
	"oldest_invoice_date" date,
	"last_receipt_at" timestamp with time zone,
	"last_receipt_paise" bigint,
	"bucket_0_7_paise" bigint DEFAULT 0 NOT NULL,
	"bucket_8_15_paise" bigint DEFAULT 0 NOT NULL,
	"bucket_16_30_paise" bigint DEFAULT 0 NOT NULL,
	"bucket_31_60_paise" bigint DEFAULT 0 NOT NULL,
	"bucket_61_90_paise" bigint DEFAULT 0 NOT NULL,
	"bucket_90_plus_paise" bigint DEFAULT 0 NOT NULL,
	"as_of" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retailer_outstanding_summary_tenant_id_retailer_id_pk" PRIMARY KEY("tenant_id","retailer_id")
);
--> statement-breakpoint
ALTER TABLE "retailer_outstanding_summary" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "write_offs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"retailer_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"approved_by" text NOT NULL,
	"journal_entry_id" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "write_offs_amount_positive" CHECK (amount_paise > 0)
);
--> statement-breakpoint
ALTER TABLE "write_offs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "allocations" DROP CONSTRAINT "allocations_amount_positive";--> statement-breakpoint
ALTER TABLE "allocations" DROP CONSTRAINT "allocations_one_source";--> statement-breakpoint
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_amount_positive";--> statement-breakpoint
ALTER TABLE "ageing_snapshots" ADD COLUMN "bucket_61_90_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ageing_snapshots" ADD COLUMN "bucket_90_plus_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ageing_snapshots" ADD COLUMN "overdue_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ageing_snapshots" ADD COLUMN "unallocated_credit_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ageing_snapshots" ADD COLUMN "computed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "write_off_id" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "client_receipt_no" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "reverses_receipt_id" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "deposited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "deposit_ref" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "deposit_account_id" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "bounce_reason" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "bank_charges_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "retailer_outstanding_summary" ADD CONSTRAINT "retailer_outstanding_summary_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailer_outstanding_summary" ADD CONSTRAINT "retailer_outstanding_summary_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retailer_outstanding_overdue_idx" ON "retailer_outstanding_summary" USING btree ("tenant_id","overdue_paise");--> statement-breakpoint
CREATE INDEX "retailer_outstanding_amount_idx" ON "retailer_outstanding_summary" USING btree ("tenant_id","outstanding_paise");--> statement-breakpoint
CREATE UNIQUE INDEX "write_offs_idempotency_idx" ON "write_offs" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "write_offs_invoice_idx" ON "write_offs" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_write_off_id_write_offs_id_fk" FOREIGN KEY ("write_off_id") REFERENCES "public"."write_offs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_reverses_receipt_id_receipts_id_fk" FOREIGN KEY ("reverses_receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_deposit_account_id_accounts_id_fk" FOREIGN KEY ("deposit_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_write_off_idx" ON "allocations" USING btree ("tenant_id","write_off_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_device_client_no_idx" ON "receipts" USING btree ("tenant_id","device_id","client_receipt_no") WHERE client_receipt_no IS NOT NULL;--> statement-breakpoint
CREATE INDEX "receipts_status_idx" ON "receipts" USING btree ("tenant_id","status","received_at");--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_amount_nonzero" CHECK (amount_paise <> 0);--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_one_source" CHECK (((receipt_id IS NOT NULL)::int + (credit_note_id IS NOT NULL)::int + (write_off_id IS NOT NULL)::int) = 1);--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amount_nonzero" CHECK (amount_paise <> 0);--> statement-breakpoint
DROP POLICY "accounts_tenant" ON "accounts" CASCADE;--> statement-breakpoint
DROP POLICY "allocations_tenant" ON "allocations" CASCADE;--> statement-breakpoint
DROP POLICY "cash_discount_conditions_tenant" ON "cash_discount_conditions" CASCADE;--> statement-breakpoint
DROP POLICY "journal_entries_tenant" ON "journal_entries" CASCADE;--> statement-breakpoint
DROP POLICY "journal_lines_tenant" ON "journal_lines" CASCADE;--> statement-breakpoint
CREATE POLICY "accounts_read" ON "accounts" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "accounts_write_insert" ON "accounts" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "accounts_write_update" ON "accounts" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "accounts_write_delete" ON "accounts" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "allocations_read" ON "allocations" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = allocations.invoice_id)
      ));--> statement-breakpoint
CREATE POLICY "allocations_write_insert" ON "allocations" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "allocations_write_update" ON "allocations" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "allocations_write_delete" ON "allocations" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "cash_discount_conditions_read" ON "cash_discount_conditions" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = cash_discount_conditions.invoice_id)
      ));--> statement-breakpoint
CREATE POLICY "cash_discount_conditions_write_insert" ON "cash_discount_conditions" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "cash_discount_conditions_write_update" ON "cash_discount_conditions" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "cash_discount_conditions_write_delete" ON "cash_discount_conditions" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "journal_entries_read" ON "journal_entries" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "journal_entries_post" ON "journal_entries" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "journal_entries_amend" ON "journal_entries" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "journal_lines_read" ON "journal_lines" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "journal_lines_post" ON "journal_lines" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "journal_lines_amend" ON "journal_lines" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "retailer_outstanding_read" ON "retailer_outstanding_summary" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "retailer_outstanding_write_insert" ON "retailer_outstanding_summary" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "retailer_outstanding_write_update" ON "retailer_outstanding_summary" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "retailer_outstanding_write_delete" ON "retailer_outstanding_summary" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "write_offs_back_office" ON "write_offs" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));