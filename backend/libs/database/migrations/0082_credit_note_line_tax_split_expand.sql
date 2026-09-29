-- Generated (drizzle-kit): expand-only, four nullable columns. Prices lane, blind check 1 (B1), ruling 10 of
-- docs/22 §8 2026-09-28: a credit note's tax is the one rule on the ORDER line, cumulative over the notes, so a
-- note line's CGST / SGST / IGST / cess can no longer be recomputed from its own taxable. The note now writes its
-- split per line and the GST summary reads it. Lines written before stay NULL (nothing is backfilled): their split
-- was each line's own halves, which the register still recomputes for them exactly as they were written.
-- Grants are table-level (0001, 0003) and credit_note_lines already carries FORCE RLS: nothing else is needed.
ALTER TABLE "credit_note_lines" ADD COLUMN "cgst_paise" bigint;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD COLUMN "sgst_paise" bigint;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD COLUMN "igst_paise" bigint;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD COLUMN "cess_paise" bigint;
