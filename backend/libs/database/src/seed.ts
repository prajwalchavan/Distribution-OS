import { loadDotenv } from './env.js'

loadDotenv()
import { eq, sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { hashPassword } from './auth/password.js'
import { createDb, createPool } from './client.js'
import { memberships, tenants, users } from './schema/index.js'
import { DEMO_PASSWORD, seedDemo } from './seed-demo.js'
import { bootstrapTenant } from './tenant-bootstrap.js'

/** Dev seed: one pilot tenant and one owner. The phone is a placeholder, never a real number. */
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
      legalName: 'Tarsun Enterprises',
      gstin: null,
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
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'tarsun'))
  const [user] = await db.select().from(users).where(eq(users.phone, PILOT_OWNER_PHONE))
  if (tenant && user) {
    await db
      .insert(memberships)
      .values({ id: uuidv7(), tenantId: tenant.id, userId: user.id, role: 'owner' })
      .onConflictDoNothing()
    await bootstrapTenant(db, tenant.id)
    if (process.env.SEED_DEMO !== 'false') {
      await seedDemo(db, tenant.id, { passwordHash })
    }
  }
  console.warn(`seeded tenant ${tenant?.slug ?? 'tarsun'} with owner ${user?.name ?? '?'}`)
  console.warn(
    `pilot owner   ${PILOT_OWNER_USERNAME}  ${DEMO_PASSWORD}  tenant ${tenant?.id ?? '?'}  user ${user?.id ?? '?'}`,
  )
} finally {
  await pool.end()
}
