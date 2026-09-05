import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { ORPCModule, onError } from '@orpc/nest'
import type { FastifyCorsOptions } from '@fastify/cors'
import type pg from 'pg'
import { HealthModule } from '../modules/health/index.js'
import { DbModule, loadEnv, PG_POOL, type Env } from '../platform/index.js'
import { servicePort, type ServiceDefinition } from './define.js'
import { ServiceModule } from './service.module.js'

/** Root Nest module for a service: oRPC, database, service info + docs, health, then the business modules. */
export function serviceRootModule(def: ServiceDefinition) {
  @Module({
    imports: [
      ORPCModule.forRoot({ interceptors: [onError((error) => console.error(error))] }),
      DbModule,
      ServiceModule.forService(def),
      HealthModule,
      ...def.modules,
    ],
  })
  class ServiceRootModule {}
  return ServiceRootModule
}

export async function createServiceApp(
  def: ServiceDefinition,
  options: { logger?: boolean } = {},
): Promise<NestFastifyApplication> {
  const env = loadEnv()
  const app = await NestFactory.create<NestFastifyApplication>(
    serviceRootModule(def),
    new FastifyAdapter({ logger: options.logger ?? env.NODE_ENV !== 'test' }),
  )
  app.enableCors(corsOptions(env))
  app.enableShutdownHooks()
  return app
}

const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * Browsers enforce this, not us: an app on http://localhost:5173 calling auth-service on :3000 and its
 * own service on :3001 is cross-origin three ways. In development any localhost port is allowed so a new
 * app can be started without touching config; in production CORS_ORIGINS must list the real origins.
 * Native (Expo iOS/Android) requests carry no Origin header and are unaffected either way.
 */
export function corsOptions(env: Env): FastifyCorsOptions {
  const configured = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  const allowed = (origin: string | undefined): boolean => {
    if (!origin) return true // same-origin, curl, or a native app: no Origin header to honour
    if (configured.includes(origin)) return true
    return configured.length === 0 && env.NODE_ENV !== 'production' && LOCALHOST.test(origin)
  }
  return {
    // no CORS headers when it is not allowed: the browser blocks the call, the server logs nothing scary
    origin: (origin, cb) => cb(null, allowed(origin)),
    credentials: false, // tokens travel in the Authorization header, never in cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-idempotency-key'],
    exposedHeaders: ['x-request-id'],
    maxAge: 86_400,
  }
}

/** Entry point used by every service's main.ts. */
export async function runService(def: ServiceDefinition): Promise<void> {
  const app = await createServiceApp(def)
  const port = servicePort(def)
  await app.listen({ port, host: '0.0.0.0' })
  console.warn(
    `${def.name}-service on http://localhost:${port}  docs http://localhost:${port}/docs  roles ${def.roles.join(', ')}`,
  )
  const pool = app.get<pg.Pool | null>(PG_POOL, { strict: false })
  const stop = async (): Promise<void> => {
    await app.close()
    await pool?.end()
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
}
