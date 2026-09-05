import { loadDotenv } from '@dos/db'

loadDotenv()

// Spec files run in parallel and each boots its own pool. Keep it small so the seven running dev
// services keep their share of Postgres's 100 connections. See libs/core/src/testing/setup.ts.
process.env.DATABASE_POOL_MAX ??= '3'
process.env.NODE_ENV ??= 'test'
