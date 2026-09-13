ALTER TABLE "receipts" ADD COLUMN "series_code" text DEFAULT 'RCPT' NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "fy" text;