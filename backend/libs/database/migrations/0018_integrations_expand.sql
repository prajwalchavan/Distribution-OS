ALTER TYPE "public"."job_status" ADD VALUE 'staged';--> statement-breakpoint
CREATE TABLE "import_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transforms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"has_header_row" boolean DEFAULT true NOT NULL,
	"sheet_name" text,
	"source_columns" jsonb,
	"builtin" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "source_file_name" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "profile_id" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "has_header_row" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "sheet_name" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "source_columns" jsonb;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_profiles_name_idx" ON "import_profiles" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "import_profiles_target_idx" ON "import_profiles" USING btree ("tenant_id","target","kind");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_profile_id_import_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."import_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_jobs_profile_idx" ON "import_jobs" USING btree ("tenant_id","profile_id");--> statement-breakpoint
CREATE INDEX "tally_sync_ledger_export_idx" ON "tally_sync_ledger" USING btree ("tenant_id","export_job_id");--> statement-breakpoint
CREATE POLICY "import_profiles_back_office" ON "import_profiles" AS PERMISSIVE FOR ALL TO "app_rw" USING (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')) WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system'));