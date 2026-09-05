ALTER TYPE "public"."target_metric" ADD VALUE 'visits';--> statement-breakpoint
ALTER TABLE "targets" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "targets" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "targets_tenant_period_idx" ON "targets" USING btree ("tenant_id","period_from","period_to");--> statement-breakpoint
DROP POLICY "computed_payouts_back_office" ON "computed_payouts" CASCADE;--> statement-breakpoint
CREATE POLICY "computed_payouts_read" ON "computed_payouts" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')
        OR user_id = (SELECT current_setting('app.actor_id', true))
      ));--> statement-breakpoint
CREATE POLICY "computed_payouts_write_insert" ON "computed_payouts" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "computed_payouts_write_update" ON "computed_payouts" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "computed_payouts_write_delete" ON "computed_payouts" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));