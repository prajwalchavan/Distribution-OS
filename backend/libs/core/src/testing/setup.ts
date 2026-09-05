import { loadDotenv } from '@dos/db'

// Runs before every spec file: the repo-root .env supplies DATABASE_URL so `describeDb` suites run locally.
loadDotenv()

// Vitest runs spec files in parallel, and each one boots its own DbModule and therefore its own pool.
// At the default of 10 that is 13+ files x 10 connections from this package alone, on top of the seven
// dev services already holding 70 of Postgres's 100 — so specs starved and timed out rather than failed.
// A spec needs two or three connections; take them, and leave the ceiling for the running services.
process.env.DATABASE_POOL_MAX ??= '3'
process.env.NODE_ENV ??= 'test'
