-- Generated (drizzle-kit): expand-only, one nullable column, no default on purpose. Prices lane, blind check 1
-- (M1), QA DOS-330 / ruling 1 of docs/22 §8 2026-09-28: a scheme is counted once per ORDER line. A day of
-- daily_owner_stats rolled before that rule may carry a scheme once per batch line of a bill split over batches,
-- and nothing rolls a past day again. Every existing row is NULL = "not yet recounted"; the worker's tenant rollup
-- recounts such a day's two scheme-spend figures from its own bills once and sets the column (the DOS-254 pattern of
-- 0069). Nothing is backfilled here and nothing else of a day changes. Grants are table-level; FORCE RLS is 0028's.
ALTER TABLE "daily_owner_stats" ADD COLUMN "scheme_spend_counted_once" boolean;
