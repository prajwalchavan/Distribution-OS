ALTER TABLE "write_offs" DROP CONSTRAINT "write_offs_amount_positive";--> statement-breakpoint
ALTER TABLE "write_offs" ADD COLUMN "reverses_write_off_id" text;--> statement-breakpoint
ALTER TABLE "write_offs" ADD COLUMN "receipt_id" text;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_reverses_write_off_id_write_offs_id_fk" FOREIGN KEY ("reverses_write_off_id") REFERENCES "public"."write_offs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "write_offs_reverses_idx" ON "write_offs" USING btree ("tenant_id","reverses_write_off_id");--> statement-breakpoint
CREATE INDEX "write_offs_receipt_idx" ON "write_offs" USING btree ("tenant_id","receipt_id");--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_amount_nonzero" CHECK (amount_paise <> 0);--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_recovery_shape" CHECK ((reverses_write_off_id IS NULL AND receipt_id IS NULL AND amount_paise > 0) OR (reverses_write_off_id IS NOT NULL AND receipt_id IS NOT NULL));