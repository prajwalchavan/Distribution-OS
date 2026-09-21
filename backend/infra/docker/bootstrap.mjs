/**
 * Create ONE distributor and its owner on a freshly migrated production database.
 *
 *   docker run --rm --env-file .env.prod ghcr.io/<owner>/dos:<tag> bootstrap
 *
 * This is the production counterpart of `pnpm db:seed`, and it is deliberately NOT that script.
 * `pnpm db:seed` writes three demo distributors, ~30 demo staff and retailers on one shared password,
 * a demo catalogue, a month of demo orders and a `dos.admin` console account (docs/23 §10: the seed
 * and `pnpm smoke` leave demo rows behind). None of that may exist on a database a real distributor
 * signs into. What a real tenant needs is exactly what `bootstrapTenant()` writes — the chart of
 * accounts, the three locations, the numbering series for the current financial year, the feature
 * flags and the white-label settings — plus the tenant row, one owner user and one membership.
 *
 * Idempotent: every write is `onConflictDoNothing` on a unique key, so a second run changes nothing
 * and a half-finished first run completes. It never prints the password.
 *
 * Required environment (see infra/.env.prod.example):
 *   DATABASE_URL, TENANT_SLUG, TENANT_LEGAL_NAME, TENANT_STATE_CODE,
 *   OWNER_NAME, OWNER_USERNAME, OWNER_PHONE, OWNER_PASSWORD
 * Optional: TENANT_GSTIN, TENANT_PLAN (pilot|starter|growth|standard|pro), OWNER_LOCALE.
 */
import { bootstrapTenant, createDb, createPool, hashPassword, loadDotenv, schema } from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { eq, sql } from 'drizzle-orm'

loadDotenv()

const PLANS = ['pilot', 'starter', 'growth', 'standard', 'pro']

function required(name) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(
      `bootstrap: ${name} is required. Fill it in .env.prod (infra/.env.prod.example lists every variable) and re-run.`,
    )
  }
  return value.trim()
}

const url = required('DATABASE_URL')
const slug = required('TENANT_SLUG')
const legalName = required('TENANT_LEGAL_NAME')
const stateCode = required('TENANT_STATE_CODE')
const ownerName = required('OWNER_NAME')
const ownerUsername = required('OWNER_USERNAME').toLowerCase()
const ownerPhone = required('OWNER_PHONE')
const ownerPassword = required('OWNER_PASSWORD')
const gstin = process.env.TENANT_GSTIN?.trim() || null
const locale = process.env.OWNER_LOCALE?.trim() || 'hi-IN'
const plan = process.env.TENANT_PLAN?.trim() || 'pilot'

if (!PLANS.includes(plan)) throw new Error(`bootstrap: TENANT_PLAN must be one of ${PLANS.join(', ')}`)
if (!/^[a-z0-9._]{3,32}$/.test(ownerUsername)) {
  throw new Error('bootstrap: OWNER_USERNAME must be 3-32 characters of a-z, 0-9, dot or underscore')
}
if (!/^\+91[6-9]\d{9}$/.test(ownerPhone)) {
  throw new Error('bootstrap: OWNER_PHONE must be an Indian mobile in E.164, e.g. +919876543210')
}
if (ownerPassword.length < 12) {
  throw new Error('bootstrap: OWNER_PASSWORD must be at least 12 characters. gen-secrets.sh writes one.')
}

const { memberships, tenants, users } = schema

const pool = createPool(url, 2)
const db = createDb(pool)
try {
  const migrated = await db.execute(
    sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenants'`,
  )
  if (migrated.rows[0]?.n !== 1) {
    throw new Error('bootstrap: the database has no `tenants` table. Run the `migrate` verb first.')
  }

  const passwordHash = await hashPassword(ownerPassword)
  await db
    .insert(tenants)
    .values({ id: uuidv7(), slug, legalName, gstin, stateCode, plan })
    .onConflictDoNothing()
  await db
    .insert(users)
    .values({
      id: uuidv7(),
      phone: ownerPhone,
      name: ownerName,
      locale,
      username: ownerUsername,
      passwordHash,
      passwordChangedAt: new Date(),
    })
    .onConflictDoNothing()

  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const [owner] = await db.select().from(users).where(eq(users.phone, ownerPhone))
  if (!tenant || !owner) throw new Error('bootstrap: the tenant or owner row did not land; nothing was changed')

  await db
    .insert(memberships)
    .values({ id: uuidv7(), tenantId: tenant.id, userId: owner.id, role: 'owner' })
    .onConflictDoNothing()
  await bootstrapTenant(db, tenant.id)

  // The password is never echoed: these logs go to `docker logs`, which is not a secret store.
  console.warn(`bootstrapped tenant ${tenant.slug} (${tenant.id})`)
  console.warn(`owner ${owner.name} signs in as ${ownerUsername} with the password from .env.prod`)
} finally {
  await pool.end()
}
