ALTER TABLE "inbound_messages" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "ref_type" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "ref_id" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_messages_retailer_idx" ON "inbound_messages" USING btree ("tenant_id","retailer_id","received_at");--> statement-breakpoint
DROP POLICY "inbound_messages_staff" ON "inbound_messages" CASCADE;--> statement-breakpoint
CREATE POLICY "inbound_messages_read" ON "inbound_messages" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "inbound_messages_write_insert" ON "inbound_messages" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "inbound_messages_write_update" ON "inbound_messages" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "inbound_messages_write_delete" ON "inbound_messages" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "inbound_messages_shop_insert" ON "inbound_messages" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true))
        AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND channel = 'in_app'
        AND created_by = (SELECT current_setting('app.actor_id', true))
        AND retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        ));