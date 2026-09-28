-- Generated (drizzle-kit): expand-only, one index. QA DOS-313 (architect ruling 4, 2026-09-28).
-- The credit check now counts a shop's confirmed orders that carry no bill yet (confirmed, picking, packed)
-- on every order submit and every credit approval. A partial index on exactly those states keeps that
-- lookup to the handful of orders in flight for the shop, however long its history. On a database that
-- already has data it only builds the index: no row is read differently and nothing is rewritten.
CREATE INDEX "sales_orders_credit_open_idx" ON "sales_orders" USING btree ("tenant_id","retailer_id") WHERE "sales_orders"."state" in ('confirmed', 'picking', 'packed');