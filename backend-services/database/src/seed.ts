import { loadDotenv } from './env.js'

loadDotenv()
import { eq } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { createDb, createPool } from './client.js'
import { memberships, tenants, users } from './schema/index.js'
import { seedDemo } from './seed-demo.js'
import { bootstrapTenant } from './tenant-bootstrap.js'

/** Dev seed: one pilot tenant and one owner. The phone is a placeholder, never a real number. */
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

const pool = createPool(url)
const db = createDb(pool)
try {
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
    .values({ id: uuidv7(), phone: '+919000000001', name: 'Pilot Owner', locale: 'hi-IN' })
    .onConflictDoNothing()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'tarsun'))
  const [user] = await db.select().from(users).where(eq(users.phone, '+919000000001'))
  if (tenant && user) {
    await db
      .insert(memberships)
      .values({ id: uuidv7(), tenantId: tenant.id, userId: user.id, role: 'owner' })
      .onConflictDoNothing()
    await bootstrapTenant(db, tenant.id)
    if (process.env.SEED_DEMO !== 'false') {
      await seedDemo(db, tenant.id)
    }
  }
  console.warn(`seeded tenant ${tenant?.slug ?? 'tarsun'} with owner ${user?.name ?? '?'}`)
} finally {
  await pool.end()
}
