import { loadDotenv } from '@dos/db'
import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  APP_VERSION: z.string().default('0.0.0'),
  /**
   * Comma-separated origins allowed to call this service from a browser. Every app is served from its
   * own origin and talks to two services (auth + its own), so cross-origin is the normal case.
   * Empty in development means "any localhost/127.0.0.1 port"; in production it must be set explicitly.
   */
  CORS_ORIGINS: z.string().optional(),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env) loadDotenv()
  return EnvSchema.parse(source)
}
