import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { ORPCModule, onError } from '@orpc/nest'
import type pg from 'pg'
import { HealthModule } from '../modules/health/index.js'
import { DbModule, loadEnv, PG_POOL } from '../platform/index.js'
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
  app.enableShutdownHooks()
  return app
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
