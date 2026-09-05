CREATE TABLE "broadcasts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"beat_id" text,
	"channel" "notification_channel" NOT NULL,
	"template_key" text NOT NULL,
	"locale" text,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"total_recipients" integer NOT NULL,
	"queued_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcasts_channel_for_shops" CHECK (channel IN ('whatsapp', 'sms', 'in_app')),
	CONSTRAINT "broadcasts_counts_nonnegative" CHECK (total_recipients >= 0 AND queued_count >= 0 AND sent_count >= 0 AND delivered_count >= 0 AND failed_count >= 0),
	CONSTRAINT "broadcasts_counts_within_total" CHECK (queued_count + sent_count + delivered_count + failed_count <= total_recipients)
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "locale" SET DEFAULT 'en-IN';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_beat_id_beats_id_fk" FOREIGN KEY ("beat_id") REFERENCES "public"."beats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcasts_created_idx" ON "broadcasts" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "broadcasts_beat_idx" ON "broadcasts" USING btree ("tenant_id","beat_id","created_at") WHERE beat_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_dispatch_idx" ON "messages" USING btree ("tenant_id","status","next_attempt_at") WHERE status IN ('queued', 'failed');--> statement-breakpoint
CREATE INDEX "messages_recipient_retailer_idx" ON "messages" USING btree ("tenant_id","recipient_retailer_id","created_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_attempts_nonnegative" CHECK (attempts >= 0);--> statement-breakpoint
DROP POLICY "inbound_messages_tenant" ON "inbound_messages" CASCADE;--> statement-breakpoint
DROP POLICY "messages_tenant" ON "messages" CASCADE;--> statement-breakpoint
DROP POLICY "push_tokens_tenant" ON "push_tokens" CASCADE;--> statement-breakpoint
DROP POLICY "whatsapp_windows_tenant" ON "whatsapp_windows" CASCADE;--> statement-breakpoint
CREATE POLICY "inbound_messages_staff" ON "inbound_messages" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "messages_read" ON "messages" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR recipient_retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )
      ));--> statement-breakpoint
CREATE POLICY "messages_write_insert" ON "messages" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "messages_write_update" ON "messages" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer') WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "messages_write_delete" ON "messages" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "messages_retailer_read_receipt" ON "messages" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))
        AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND channel IN ('in_app', 'push')
        AND recipient_retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true))
        AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND channel IN ('in_app', 'push')
        AND recipient_retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        ));--> statement-breakpoint
CREATE POLICY "push_tokens_read" ON "push_tokens" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) <> 'retailer');--> statement-breakpoint
CREATE POLICY "push_tokens_own_insert" ON "push_tokens" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true))
        AND (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        AND (
          user_id = (SELECT current_setting('app.actor_id', true))
          OR (SELECT current_setting('app.actor_role', true)) = 'system'
        ));--> statement-breakpoint
CREATE POLICY "push_tokens_own_update" ON "push_tokens" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))
        AND (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        AND (
          user_id = (SELECT current_setting('app.actor_id', true))
          OR (SELECT current_setting('app.actor_role', true)) = 'system'
        )) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true))
        AND (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        AND (
          user_id = (SELECT current_setting('app.actor_id', true))
          OR (SELECT current_setting('app.actor_role', true)) = 'system'
        ));--> statement-breakpoint
CREATE POLICY "push_tokens_own_delete" ON "push_tokens" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true))
        AND (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        AND (
          user_id = (SELECT current_setting('app.actor_id', true))
          OR (SELECT current_setting('app.actor_role', true)) = 'system'
        ));--> statement-breakpoint
CREATE POLICY "whatsapp_windows_staff" ON "whatsapp_windows" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'delivery', 'accountant', 'warehouse', 'system'));--> statement-breakpoint
CREATE POLICY "broadcasts_read" ON "broadcasts" AS PERMISSIVE FOR SELECT TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));--> statement-breakpoint
CREATE POLICY "broadcasts_write_insert" ON "broadcasts" AS PERMISSIVE FOR INSERT TO "app_rw" WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "broadcasts_write_update" ON "broadcasts" AS PERMISSIVE FOR UPDATE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));--> statement-breakpoint
CREATE POLICY "broadcasts_write_delete" ON "broadcasts" AS PERMISSIVE FOR DELETE TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'));