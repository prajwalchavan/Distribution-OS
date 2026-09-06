import { loadDotenv } from './env.js'

loadDotenv()
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { hashPassword } from './auth/password.js'
import { createDb, createPool } from './client.js'
import { memberships, tenants, users } from './schema/index.js'
import {
  DEMO_PASSWORD,
  DEMO_PLATFORM_ADMIN_USERNAME,
  seedDemo,
  seedExtraTenants,
  seedPlatformConsole,
} from './seed-demo.js'
import { PILOT_BRANDING } from './seed-demo/branding.js'
import { bootstrapTenant } from './tenant-bootstrap.js'

/**
 * Dev seed. Writes THREE distributors (founder requirement, docs/22 §8 2026-09-04):
 *
 * 1. **Tarsun Enterprise** (M/s. Tarsun Enterprise, Kalyan West) — the pilot, every module's demo data, unscoped ids.
 * 2. **Sai Distributors** and **Kalyan Agencies** — their own owners, managers, accountants,
 *    warehouse hands, reps and drivers, their own smaller shelf, price lists, schemes, beats and a
 *    month of orders, invoices, receipts, trips and deliveries (`seed-demo/tenants.ts`).
 *
 * Ten of Sai's shops are the SAME shops Tarsun sells to — one `retailer_identities` row, a
 * `retailers` row and a `retailer_links` row per tenant — and five of those are on Kalyan Agencies'
 * books too. `ramesh.gupta` is one shopkeeper user with a membership in all three, so the retailer
 * app's switch-distributor flow has something to switch between.
 *
 * The whole thing is idempotent: run it twice and nothing is added.
 * The phone on the pilot-owner account is a placeholder, never a real number.
 */
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

const PILOT_OWNER_PHONE = '+919000000001'
const PILOT_OWNER_USERNAME = 'pilot.owner'

const pool = createPool(url)
const db = createDb(pool)
try {
  // argon2 is deliberately slow, so hash the shared demo password exactly once and reuse the hash.
  const passwordHash = await hashPassword(DEMO_PASSWORD)
  await db
    .insert(tenants)
    .values({
      id: uuidv7(),
      slug: 'tarsun',
      legalName: PILOT_BRANDING.legalName,
      gstin: PILOT_BRANDING.gstin,
      stateCode: '27',
      plan: 'pilot',
    })
    .onConflictDoNothing()
  await db
    .insert(users)
    .values({
      id: uuidv7(),
      phone: PILOT_OWNER_PHONE,
      name: 'Pilot Owner',
      locale: 'hi-IN',
      username: PILOT_OWNER_USERNAME,
      passwordHash,
      passwordChangedAt: new Date(),
    })
    .onConflictDoNothing()
  // The insert above does nothing on a database seeded before usernames existed; fill the gap in.
  await db
    .update(users)
    .set({ username: PILOT_OWNER_USERNAME, passwordHash, passwordChangedAt: new Date() })
    .where(sql`${users.phone} = ${PILOT_OWNER_PHONE} AND ${users.username} IS NULL`)
  // A database seeded before the letterhead arrived carries the placeholder name and no GSTIN.
  await db
    .update(tenants)
    .set({ legalName: PILOT_BRANDING.legalName, gstin: PILOT_BRANDING.gstin })
    .where(eq(tenants.slug, 'tarsun'))
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'tarsun'))
  const [user] = await db.select().from(users).where(eq(users.phone, PILOT_OWNER_PHONE))
  if (tenant && user) {
    await db
      .insert(memberships)
      .values({ id: uuidv7(), tenantId: tenant.id, userId: user.id, role: 'owner' })
      .onConflictDoNothing()
    await bootstrapTenant(db, tenant.id)
    if (process.env.SEED_DEMO !== 'false') {
      await seedDemo(db, tenant.id, { passwordHash, label: 'Tarsun Enterprise' })
      // The other two distributors share ten of Tarsun's shops, so they seed after it.
      await seedExtraTenants(db, { passwordHash })
      // Module 13's console (founder decision 2026-09-05): the `dos.admin` super account, one
      // subscription per distributor and two decided support windows. Last, because it writes a row
      // for EVERY tenant and needs the pilot's owner to exist to approve a grant as.
      await seedPlatformConsole(db, passwordHash)
    }
  }
  console.warn(`seeded tenant ${tenant?.slug ?? 'tarsun'} with owner ${user?.name ?? '?'}`)
  console.warn(
    `pilot owner   ${PILOT_OWNER_USERNAME}  ${DEMO_PASSWORD}  tenant ${tenant?.id ?? '?'}  user ${user?.id ?? '?'}`,
  )
  console.warn(
    `platform console  ${DEMO_PLATFORM_ADMIN_USERNAME}  ${DEMO_PASSWORD}  admin-service :3007  (sign in at POST /auth/platform/login — no tenant)`,
  )
} finally {
  await pool.end()
}
