import 'dotenv/config'
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import type pg from 'pg'
import { AppModule } from './app.module.js'
import { loadEnv, PG_POOL } from './platform/index.js'

const env = loadEnv()
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ logger: env.NODE_ENV !== 'test' }),
)
app.enableShutdownHooks()
await app.listen({ port: env.PORT, host: '0.0.0.0' })
console.warn(`api listening on http://0.0.0.0:${env.PORT} (${env.NODE_ENV})`)

const pool = app.get<pg.Pool | null>(PG_POOL, { strict: false })
const stop = async (): Promise<void> => {
  await app.close()
  await pool?.end()
  process.exit(0)
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
