-- QA batch 2 — DOS-166 step 08: the receipts INSERT policy as app_rw, in ONE session, inside BEGIN ... ROLLBACK (dos_qa).
-- Tenant tarsun 01a09a5b-3c58-71c1-a34d-b93c569b0099; retailer Prerna Super Market R-0031 8ddf5b3f-0540-7deb-a8c9-bc311b31b4a8.
-- Salesperson attempt id b3da98de-ca87-4714-bfd9-ff0b5e755e78 (actor rahul.deshmukh 8760e17e-4830-7395-a946-1e02fffa1ad7);
-- delivery attempt id 2e9d5def-fed6-416e-8779-20d9efa235c3 (actor ganesh.more 7b2db500-02d5-7aa7-a1dc-005a3e89ff63).
\set VERBOSITY verbose
\echo == before: rows with either id (as dos)
select count(*) as rows_with_probe_ids from receipts where id in ('b3da98de-ca87-4714-bfd9-ff0b5e755e78', '2e9d5def-fed6-416e-8779-20d9efa235c3');
BEGIN;
SET LOCAL ROLE app_rw;
select set_config('app.tenant_id', '01a09a5b-3c58-71c1-a34d-b93c569b0099', true) as tenant,
       set_config('app.actor_id', '8760e17e-4830-7395-a946-1e02fffa1ad7', true) as actor,
       set_config('app.actor_role', 'salesperson', true) as role;
select current_user, current_setting('app.actor_role') as actor_role;
SAVEPOINT before_salesperson;
\echo == 1. INSERT as actor_role salesperson: expect ERROR 42501
insert into receipts (id, tenant_id, retailer_id, mode, amount_paise, received_at, received_by, idempotency_key, note, fy)
values ('b3da98de-ca87-4714-bfd9-ff0b5e755e78', '01a09a5b-3c58-71c1-a34d-b93c569b0099', '8ddf5b3f-0540-7deb-a8c9-bc311b31b4a8', 'cash', 100, now(),
        '8760e17e-4830-7395-a946-1e02fffa1ad7', 'qa-b2-dos166-rls-08-salesperson-b3da98de-ca87-4714-bfd9-ff0b5e755e78', 'QA batch2 DOS-166 RLS probe 08 salesperson (rolled back)', '2026-27')
returning id;
\echo LAST_ERROR_SQLSTATE = :LAST_ERROR_SQLSTATE
\echo LAST_ERROR_MESSAGE = :LAST_ERROR_MESSAGE
ROLLBACK TO SAVEPOINT before_salesperson;
select set_config('app.actor_id', '7b2db500-02d5-7aa7-a1dc-005a3e89ff63', true) as actor,
       set_config('app.actor_role', 'delivery', true) as role;
select current_user, current_setting('app.actor_role') as actor_role;
\echo == 2. INSERT as actor_role delivery: expect the row
insert into receipts (id, tenant_id, retailer_id, mode, amount_paise, received_at, received_by, idempotency_key, note, fy)
values ('2e9d5def-fed6-416e-8779-20d9efa235c3', '01a09a5b-3c58-71c1-a34d-b93c569b0099', '8ddf5b3f-0540-7deb-a8c9-bc311b31b4a8', 'cash', 100, now(),
        '7b2db500-02d5-7aa7-a1dc-005a3e89ff63', 'qa-b2-dos166-rls-08-delivery-2e9d5def-fed6-416e-8779-20d9efa235c3', 'QA batch2 DOS-166 RLS probe 08 delivery (rolled back)', '2026-27')
returning id, tenant_id, received_by, amount_paise, series_code, fy;
\echo == 3. inside the transaction: rows with either id (expect 1: the delivery row)
select id, received_by from receipts where id in ('b3da98de-ca87-4714-bfd9-ff0b5e755e78', '2e9d5def-fed6-416e-8779-20d9efa235c3');
ROLLBACK;
\echo == 4. after ROLLBACK, back as dos (BYPASSRLS): rows with either id (expect 0)
select current_user;
select count(*) as rows_with_probe_ids from receipts where id in ('b3da98de-ca87-4714-bfd9-ff0b5e755e78', '2e9d5def-fed6-416e-8779-20d9efa235c3');
