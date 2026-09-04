import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://dos:dos@localhost:5432/dos' },
  // Roles and RLS policies are managed as code (see src/schema/roles.ts).
  entities: { roles: { provider: '', include: ['app_rw'] } },
  strict: true,
  verbose: true,
})
