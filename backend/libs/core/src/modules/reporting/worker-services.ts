import type { Db } from '@dos/db'
import { createBillingStack } from '../billing/index.js'
import { InventoryService } from '../inventory/index.js'
import { SchemesService } from '../pricing/index.js'
import { TenantCatalogService } from '../tenant-catalog/index.js'
import { ReportingRegistersService } from './registers.service.js'
import { ReportingService } from './reporting.service.js'

/**
 * The reporting stack for a process WITHOUT Nest DI — the pg-boss worker's rollup jobs and the
 * `report_*` export renderers (coordination §3.9: tsx emits no `design:paramtypes`, so a Nest
 * container there injects `undefined`). Same graph the `ReportingModule` provider list describes,
 * wired by hand and type-checked: a changed constructor fails the build here, not the worker at 3 a.m.
 *
 * The replica is deliberately the SAME client as the primary here: a rollup writes, and a renderer
 * should read exactly what the rollup just wrote (docs/20 rule 10 — writes never go to a replica, and
 * neither does a read that must see them).
 */
export interface ReportingStack {
  /** The primary client, for the one register whose CSV is receivables' own read (`outstanding`). */
  db: Db | null
  reporting: ReportingService
  registers: ReportingRegistersService
}

export function createReportingStack(db: Db | null): ReportingStack {
  const billing = createBillingStack(db)
  const tenantCatalog = new TenantCatalogService(db)
  const inventory = new InventoryService()
  const schemes = new SchemesService(db)
  return {
    db,
    reporting: new ReportingService(db, db),
    registers: new ReportingRegistersService(
      db,
      db,
      billing.registers,
      tenantCatalog,
      inventory,
      schemes,
    ),
  }
}
