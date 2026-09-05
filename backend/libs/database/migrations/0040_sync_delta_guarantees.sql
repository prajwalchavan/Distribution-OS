-- Hand-written companion to 0038_sync_delta_expand.sql: the guarantees drizzle-kit cannot express.
--
-- OUR OWN OFFLINE SYNC, the database half (founder decision 2026-09-05, docs/22 §8 and docs/26 §5:
-- PowerSync is NOT used; the device keeps SQLite tables filled by `GET /sync/pull` deltas and writes
-- back through `POST /sync/upload`, which never answers 4xx). The pull is one sentence — "every row of
-- this table whose `updated_at` is after the cursor I last received" — and that sentence is only true
-- if the database makes it true. Three things have to hold on every table a rep, a crew, a godown
-- phone or a shop holds:
--
--   (i)   `updated_at` MOVES on every write. A column with `DEFAULT now()` and nothing behind it is
--         stamped once at insert and then lies forever: the row changes, the device never hears of it.
--   (ii)  `updated_at` is the DATABASE's clock, not an app server's or a phone's. `sync.pull` hands the
--         device a cursor cut from `now()` on this server; a row stamped from a machine whose clock is
--         two minutes slow lands BEHIND a cursor already issued and is never pulled again.
--   (iii) a row that is GONE leaves a trace. There is no `updated_at` on a deleted row, so the delete
--         is recorded in `sync_tombstones` and the pull reports the ids.
--
-- 0012 gave five tables the `(tenant_id, updated_at)` index; 0038 gives it to the other thirty-two and
-- adds `sync_tombstones`, `delivery_challans.created_at/updated_at` and the four global catalog
-- indexes. This file installs what is left, and all of it is a trigger, a grant or an assertion:
--
--   1. FORCE ROW LEVEL SECURITY and the grants for `sync_tombstones`, which carries a SELECT policy and
--      DELIBERATELY NO WRITE POLICY OF ANY KIND. The triggers below are SECURITY DEFINER and are the
--      only author; app_rw gets SELECT alone. A tombstone tells a device to forget a row, so a token
--      that merely holds a row must never be able to write one — a blocked shop could otherwise tell
--      every phone in the distributorship to drop its price list.
--
--   2. `dos_touch_updated_at()` — ONE function, on BEFORE INSERT OR UPDATE of every pull-able table
--      (§(i) and §(ii) above). It sets `clock_timestamp()`, not `now()`: `now()` is the transaction's
--      START, so a transaction that runs eight seconds would stamp its rows eight seconds in the past
--      and slip behind a cursor the puller has already been handed — `sync.service.ts` only backs the
--      cursor off by `PULL_OVERLAP_MS` (5 s). It overwrites whatever the caller supplied, which is the
--      point: several services set `updatedAt: new Date()` from the Node process, and that clock is not
--      this one.
--
--   3. `dos_record_tombstone()` + `dos_sync_tombstone()` — one AFTER DELETE trigger per pull-able
--      table, writing `(tenant_id, table_name, row_id, deleted_at, reason='deleted')`. The key columns
--      come from the trigger's argument because two tables are not keyed by `id`
--      (`retailer_outstanding_summary` by `retailer_id`, `stock_balances` by `lot_id:location_id`), and
--      the second argument carries the sentinel `'*'` for the four GLOBAL curated tables, which have no
--      `tenant_id` and whose deletions every tenant must hear about. Re-deleting the same key upserts,
--      so a resurrected-and-deleted row has one tombstone with the latest time, never two.
--
--   4. `dos_sync_soft_hide()` — the deletions that are not deletions. A shop that moves off a beat, or
--      closes; a beat assignment that ends; a shop unlinked from the distributor. The row still exists,
--      so §(i) alone would leave it on the rep's phone forever. This is per-READER, not per-tenant (the
--      shop that left rep A's beat joined rep B's), so the tombstone means only "this row may have left
--      your set": `sync.pull` sends the tombstoned ids that are NOT in the caller's current read set,
--      and the device applies deletes BEFORE rows.
--
--   5. THE ASSERTION, the twin of 0011 §2, 0013 §6, 0015 §6, 0017 §3, 0019 §3, 0022 §3, 0025 §4,
--      0028 §3, 0030 §4, 0032 §6 and 0034 §6. It walks the same 37-table list `src/sync-tables.ts`
--      exports as `SYNC_PULL_TABLES` and refuses to finish unless each one has the column, the index,
--      both triggers — and NO column whose name matches cost / margin / landed / purchase / PTD. That
--      last check is never-list 1 (docs/22 §9) made structural: purchase cost is invisible to the
--      salesperson, the godown, the crew and the shop because it lives in `tenant_product_costs`,
--      `supplier_invoice_lines`, `grns` and `claim_lines` — tables no device syncs — and if a later
--      migration ever puts a cost column on `stock_lots` or `invoice_lines`, this migration fails
--      instead of the cost quietly riding out to every phone in the country.
--
-- Retention: `sync_tombstones` is swept at 180 days (`SYNC_TOMBSTONE_RETENTION_DAYS`), the same window
-- as `sync_ops` — a device away longer than that pulls from a null cursor, which rebuilds its tables
-- and needs no tombstone. The sweep runs in the worker as `app_worker` (BYPASSRLS), which is why that
-- role, and only that role, holds DELETE here.

-- 1. FORCE RLS and the grants. SELECT for the app; the sweep's DELETE for the worker; nothing else.
ALTER TABLE "sync_tombstones" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "sync_tombstones" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sync_tombstones" TO app_worker;--> statement-breakpoint

-- 2. One shared touch function for every pull-able table (never a per-table copy).
CREATE OR REPLACE FUNCTION dos_touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  -- clock_timestamp(), not now(): see §2 of the header.
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- 3. The tombstone writer, and the DELETE trigger that calls it.
CREATE OR REPLACE FUNCTION dos_record_tombstone(p_tenant text, p_table text, p_row text, p_reason text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_tenant IS NULL OR p_tenant = '' OR p_row IS NULL OR p_row = '' THEN
    RETURN;  -- nothing a device could match this to
  END IF;
  INSERT INTO sync_tombstones (tenant_id, table_name, row_id, deleted_at, reason)
  VALUES (p_tenant, p_table, p_row, clock_timestamp(), p_reason)
  ON CONFLICT (tenant_id, table_name, row_id)
  DO UPDATE SET deleted_at = EXCLUDED.deleted_at, reason = EXCLUDED.reason;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION dos_sync_tombstone() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  row_json jsonb := to_jsonb(OLD);
  key_cols text[] := string_to_array(COALESCE(NULLIF(TG_ARGV[0], ''), 'id'), ',');
  parts text[] := ARRAY[]::text[];
  col text;
  v_tenant text;
BEGIN
  -- TG_ARGV[1] is the sentinel for the global curated catalog, which carries no tenant_id.
  v_tenant := COALESCE(row_json ->> 'tenant_id', NULLIF(TG_ARGV[1], ''));
  FOREACH col IN ARRAY key_cols LOOP
    parts := parts || COALESCE(row_json ->> col, '');
  END LOOP;
  PERFORM dos_record_tombstone(v_tenant, TG_TABLE_NAME, array_to_string(parts, ':'), 'deleted');
  RETURN OLD;
END;
$$;--> statement-breakpoint

-- 3b. Arm both triggers on every pull-able table. The list is `SYNC_PULL_TABLES` in
--     src/sync-tables.ts; the assertion in §5 walks the same one, so the two cannot drift apart
--     without the migration failing.
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('retailers',                    'id',                 ''),
      ('retailer_links',               'id',                 ''),
      ('beats',                        'id',                 ''),
      ('beat_assignments',             'id',                 ''),
      ('pjp',                          'id',                 ''),
      ('visits',                       'id',                 ''),
      ('sales_orders',                 'id',                 ''),
      ('sales_order_lines',            'id',                 ''),
      ('price_lists',                  'id',                 ''),
      ('price_list_items',             'id',                 ''),
      ('retailer_price_overrides',     'id',                 ''),
      ('schemes',                      'id',                 ''),
      ('bargain_requests',             'id',                 ''),
      ('invoices',                     'id',                 ''),
      ('invoice_lines',                'id',                 ''),
      ('credit_notes',                 'id',                 ''),
      ('credit_note_lines',            'id',                 ''),
      ('receipts',                     'id',                 ''),
      ('retailer_outstanding_summary', 'retailer_id',        ''),
      ('trips',                        'id',                 ''),
      ('trip_stops',                   'id',                 ''),
      ('deliveries',                   'id',                 ''),
      ('delivery_lines',               'id',                 ''),
      ('vehicles',                     'id',                 ''),
      ('load_sheets',                  'id',                 ''),
      ('delivery_challans',            'id',                 ''),
      ('picklists',                    'id',                 ''),
      ('pick_lines',                   'id',                 ''),
      ('pack_confirmations',           'id',                 ''),
      ('locations',                    'id',                 ''),
      ('stock_lots',                   'id',                 ''),
      ('stock_balances',               'lot_id,location_id', ''),
      ('tenant_products',              'id',                 ''),
      ('products',                     'id',                 '*'),
      ('product_variants',             'id',                 '*'),
      ('manufacturers',                'id',                 '*'),
      ('brands',                       'id',                 '*')
    ) AS t(table_name, key_cols, tenant_sentinel)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', spec.table_name || '_touch_updated_at', spec.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION dos_touch_updated_at()',
      spec.table_name || '_touch_updated_at', spec.table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', spec.table_name || '_tombstone', spec.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dos_sync_tombstone(%L, %L)',
      spec.table_name || '_tombstone', spec.table_name, spec.key_cols, spec.tenant_sentinel);
  END LOOP;
END;
$$;--> statement-breakpoint

-- 4. The soft hides: a row that stays in the database but leaves a field device's read set.
CREATE OR REPLACE FUNCTION dos_sync_soft_hide() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM dos_record_tombstone(NEW.tenant_id, TG_TABLE_NAME, NEW.id, COALESCE(TG_ARGV[0], 'unlinked'));
  RETURN NULL;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS retailers_beat_tombstone ON "retailers";--> statement-breakpoint
CREATE TRIGGER retailers_beat_tombstone
  AFTER UPDATE ON "retailers"
  FOR EACH ROW WHEN (NEW.beat_id IS DISTINCT FROM OLD.beat_id)
  EXECUTE FUNCTION dos_sync_soft_hide('beat_changed');--> statement-breakpoint
DROP TRIGGER IF EXISTS retailers_inactive_tombstone ON "retailers";--> statement-breakpoint
CREATE TRIGGER retailers_inactive_tombstone
  AFTER UPDATE ON "retailers"
  FOR EACH ROW WHEN (OLD.active AND NOT NEW.active)
  EXECUTE FUNCTION dos_sync_soft_hide('deactivated');--> statement-breakpoint
DROP TRIGGER IF EXISTS beat_assignments_ended_tombstone ON "beat_assignments";--> statement-breakpoint
CREATE TRIGGER beat_assignments_ended_tombstone
  AFTER UPDATE ON "beat_assignments"
  FOR EACH ROW WHEN (NEW.valid_to IS NOT NULL AND NEW.valid_to IS DISTINCT FROM OLD.valid_to)
  EXECUTE FUNCTION dos_sync_soft_hide('assignment_ended');--> statement-breakpoint
DROP TRIGGER IF EXISTS retailer_links_unlinked_tombstone ON "retailer_links";--> statement-breakpoint
CREATE TRIGGER retailer_links_unlinked_tombstone
  AFTER UPDATE ON "retailer_links"
  FOR EACH ROW WHEN (OLD.status = 'active' AND NEW.status <> 'active')
  EXECUTE FUNCTION dos_sync_soft_hide('unlinked');--> statement-breakpoint

-- 5. THE ASSERTION (see the header).
DO $$
DECLARE
  spec record;
  n int;
  forced boolean;
  bad text;
BEGIN
  -- (a) the tombstone table is closed to every writer but the triggers
  SELECT c.relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'sync_tombstones';
  IF forced IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'sync_tombstones does not FORCE row level security; one tenant would read another''s deletions'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'sync_tombstones' AND p.polcmd = 'r';
  IF n <> 1 THEN
    RAISE EXCEPTION 'sync_tombstones must carry exactly one SELECT policy (0038); it has %', n
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT count(*) INTO n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'sync_tombstones' AND p.polcmd <> 'r';
  IF n > 0 THEN
    RAISE EXCEPTION 'sync_tombstones has a write policy; a tombstone is written by the triggers alone, or a token that merely holds a row could tell every device in the distributorship to forget it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (b)-(d) every pull-able table: the column, the index, both triggers, and no cost column
  FOR spec IN
    SELECT * FROM (VALUES
      ('retailers', 'tenant'), ('retailer_links', 'tenant'), ('beats', 'tenant'),
      ('beat_assignments', 'tenant'), ('pjp', 'tenant'), ('visits', 'tenant'),
      ('sales_orders', 'tenant'), ('sales_order_lines', 'tenant'), ('price_lists', 'tenant'),
      ('price_list_items', 'tenant'), ('retailer_price_overrides', 'tenant'), ('schemes', 'tenant'),
      ('bargain_requests', 'tenant'), ('invoices', 'tenant'), ('invoice_lines', 'tenant'),
      ('credit_notes', 'tenant'), ('credit_note_lines', 'tenant'), ('receipts', 'tenant'),
      ('retailer_outstanding_summary', 'tenant'), ('trips', 'tenant'), ('trip_stops', 'tenant'),
      ('deliveries', 'tenant'), ('delivery_lines', 'tenant'), ('vehicles', 'tenant'),
      ('load_sheets', 'tenant'), ('delivery_challans', 'tenant'), ('picklists', 'tenant'),
      ('pick_lines', 'tenant'), ('pack_confirmations', 'tenant'), ('locations', 'tenant'),
      ('stock_lots', 'tenant'), ('stock_balances', 'tenant'), ('tenant_products', 'tenant'),
      ('products', 'global'), ('product_variants', 'global'), ('manufacturers', 'global'),
      ('brands', 'global')
    ) AS t(table_name, scope)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = spec.table_name AND column_name = 'updated_at'
    ) THEN
      RAISE EXCEPTION '% has no updated_at; the delta pull has nothing to order or filter on', spec.table_name
        USING ERRCODE = 'undefined_column';
    END IF;

    IF spec.scope = 'tenant' THEN
      SELECT count(*) INTO n FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = spec.table_name
          AND indexdef LIKE '%(tenant_id, updated_at)%';
      IF n = 0 THEN
        RAISE EXCEPTION '% has no (tenant_id, updated_at) index; every pull would scan the whole table (docs/20)', spec.table_name
          USING ERRCODE = 'undefined_object';
      END IF;
    ELSE
      SELECT count(*) INTO n FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = spec.table_name
          AND indexdef LIKE '%(updated_at)%';
      IF n = 0 THEN
        RAISE EXCEPTION '% (global catalog) has no (updated_at) index; every pull would scan the master', spec.table_name
          USING ERRCODE = 'undefined_object';
      END IF;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      WHERE NOT tg.tgisinternal AND c.relname = spec.table_name
        AND tg.tgname = spec.table_name || '_touch_updated_at'
    ) THEN
      RAISE EXCEPTION '% has no touch trigger; its updated_at would be stamped once at insert and lie for the life of the row', spec.table_name
        USING ERRCODE = 'undefined_object';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      WHERE NOT tg.tgisinternal AND c.relname = spec.table_name
        AND tg.tgname = spec.table_name || '_tombstone'
    ) THEN
      RAISE EXCEPTION '% has no tombstone trigger; a deleted row would stay on every device that holds it', spec.table_name
        USING ERRCODE = 'undefined_object';
    END IF;

    SELECT string_agg(column_name, ', ') INTO bad
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = spec.table_name
        AND column_name ~* '(cost|margin|landed|purchase|ptd)';
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION '% is pulled to field devices and now carries %; purchase cost, landed cost and margin are never readable by a salesperson, a godown, a crew or a shop (docs/22 section 9, never-list 1)', spec.table_name, bad
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- (e) the soft hides are armed: a shop that moves off a beat or closes, an assignment that ends,
  --     a shop unlinked from the distributor
  FOREACH bad IN ARRAY ARRAY[
    'retailers_beat_tombstone', 'retailers_inactive_tombstone',
    'beat_assignments_ended_tombstone', 'retailer_links_unlinked_tombstone'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = bad AND NOT tg.tgisinternal) THEN
      RAISE EXCEPTION 'trigger % is missing; a shop that left the rep''s beat would sit on their phone until they reinstalled the app', bad
        USING ERRCODE = 'undefined_object';
    END IF;
  END LOOP;
END;
$$;
