import { loadDotenv } from './env.js'

loadDotenv()
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createDb, createPool } from './client.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

const here = dirname(fileURLToPath(import.meta.url))
const pool = createPool(url)
try {
  await migrate(createDb(pool), { migrationsFolder: resolve(here, '../migrations') })
  console.warn('migrations applied')
} finally {
  await pool.end()
}
