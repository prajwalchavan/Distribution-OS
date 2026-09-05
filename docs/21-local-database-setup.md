# 21 · Local database: view it in DBeaver / pgAdmin, or run it on your own Postgres

The project database already runs on the founder's Mac as the Homebrew service `postgresql@17`, port 5439. Nothing
has to be moved to look at the data: connect a client to it.

## A. Connect DBeaver (or pgAdmin) to the running database

| Field    | Value       |
| -------- | ----------- |
| Host     | 127.0.0.1   |
| Port     | 5439        |
| Database | dos         |
| Username | dos         |
| Password | dos         |

DBeaver: Database → New Database Connection → PostgreSQL → fill the table → Test Connection → Finish. Tables are under
`dos → Schemas → public → Tables`. pgAdmin: Object → Register → Server → General: name "Distribution OS"; Connection: the
same values → Save.

Logged in as `dos` you are the database owner (BYPASSRLS): you see every distributor's rows. The services connect as
`app_rw`, for which row-level security hides other tenants; to see what a service sees, run in the SQL editor:

```sql
SET ROLE app_rw;
SELECT set_config('app.tenant_id', '<tenant id from pnpm db:seed>', false),
       set_config('app.actor_id',  '<user id>', false),
       set_config('app.actor_role', 'salesperson', false);
SELECT * FROM tenant_product_costs;   -- empty for a salesperson, rows for an owner
RESET ROLE;
```

If the service is down: `brew services start postgresql@17`. Log: `/opt/homebrew/var/log/postgresql@17.log`.

## B. Run the schema on a Postgres you installed yourself

The schema needs Postgres 15 or newer (security-invoker views; 17 is what CI uses). The Postgres 14 on port 5432 is too old.

1. Create the role and database once (as a superuser, e.g. in psql or DBeaver):

   ```sql
   CREATE ROLE dos LOGIN PASSWORD 'dos' CREATEDB CREATEROLE BYPASSRLS;
   CREATE DATABASE dos OWNER dos;
   ```

2. Point the backend at it: in `backend/.env` set `DATABASE_URL=postgres://dos:dos@127.0.0.1:<port>/dos`.
3. Apply migrations and load the demo data (from `backend/`):

   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

   `db:migrate` creates the runtime roles `app_rw` and `app_worker`, all tables, policies, triggers and views;
   `db:seed` creates the demo distributor(s), staff, shops, products, prices, stock, orders, invoices and prints the
   sign-in username and password per role. Both are safe to re-run.

4. Start a service and open its API page, e.g. `pnpm --filter @dos/owner-service dev` → http://localhost:3001/docs.

## C. Reset

To start over on the Homebrew instance (destroys local data only):

```bash
/opt/homebrew/opt/postgresql@17/bin/psql postgres://dos:dos@127.0.0.1:5439/postgres -c 'DROP DATABASE dos WITH (FORCE)' -c 'CREATE DATABASE dos OWNER dos'
cd backend && pnpm db:migrate && pnpm db:seed
```
