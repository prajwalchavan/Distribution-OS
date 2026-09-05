import { oc } from '@orpc/contract'
import {
  CatalogSearchInput,
  CatalogSearchOutput,
  CostsListInput,
  CostsListOutput,
  ManufacturersListOutput,
  ProposeProductInput,
  ProposeProductOutput,
  SuppliersListOutput,
  TenantCatalogListInput,
  TenantCatalogListOutput,
  UpsertCostInput,
  UpsertCostOutput,
  UpsertListingInput,
  UpsertListingOutput,
  UpsertSupplierInput,
  UpsertSupplierOutput,
} from './catalog.js'
import { authContract } from './auth.js'
import { HealthOutputSchema } from './health.js'
import { syncContract } from './sync.js'
import { inventoryContract } from './inventory.js'
import { procurementContract } from './procurement.js'
import { MeOutputSchema, staffContract } from './tenancy.js'
import { retailersContract } from './retailers.js'
import { pricingContract } from './pricing.js'
import { ordersContract } from './orders.js'
import { receivablesContract } from './receivables.js'
import { billingContract } from './billing.js'
import { warehouseContract } from './warehouse.js'

/**
 * The API contract. The NestJS API implements it (backend/apps/api), the apps call it through
 * @dos/api-client, and CI publishes the generated OpenAPI document for importers/integrations.
 * Routes are explicit so URLs stay stable when procedures move between routers.
 */
export const contract = {
  health: {
    ping: oc
      .route({ method: 'GET', path: '/health/ping', summary: 'Liveness + database reachability' })
      .output(HealthOutputSchema),
  },
  auth: authContract,
  tenancy: {
    me: oc
      .route({ method: 'GET', path: '/tenancy/me', summary: 'Current user, tenant and membership' })
      .output(MeOutputSchema),
    staff: staffContract,
  },
  catalog: {
    search: oc
      .route({
        method: 'GET',
        path: '/catalog/variants',
        summary: 'Search the global product master',
      })
      .input(CatalogSearchInput)
      .output(CatalogSearchOutput),
    manufacturers: oc
      .route({
        method: 'GET',
        path: '/catalog/manufacturers',
        summary: 'Manufacturers with their brands',
      })
      .output(ManufacturersListOutput),
    propose: oc
      .route({
        method: 'POST',
        path: '/catalog/proposals',
        summary: 'Propose a missing product; usable immediately',
      })
      .input(ProposeProductInput)
      .output(ProposeProductOutput),
  },
  tenantCatalog: {
    list: oc
      .route({
        method: 'GET',
        path: '/tenant-catalog/products',
        summary: 'What this distributor sells (no cost)',
      })
      .input(TenantCatalogListInput)
      .output(TenantCatalogListOutput),
    upsertListing: oc
      .route({
        method: 'POST',
        path: '/tenant-catalog/products',
        summary: 'List/unlist a variant and set order rules',
      })
      .input(UpsertListingInput)
      .output(UpsertListingOutput),
    suppliers: oc
      .route({
        method: 'GET',
        path: '/tenant-catalog/suppliers',
        summary: 'Suppliers of this distributor',
      })
      .output(SuppliersListOutput),
    upsertSupplier: oc
      .route({
        method: 'POST',
        path: '/tenant-catalog/suppliers',
        summary: 'Create or update a supplier',
      })
      .input(UpsertSupplierInput)
      .output(UpsertSupplierOutput),
    costs: oc
      .route({
        method: 'GET',
        path: '/tenant-catalog/costs',
        summary: 'Purchase costs (owner/manager/accountant only)',
      })
      .input(CostsListInput)
      .output(CostsListOutput),
    upsertCost: oc
      .route({
        method: 'POST',
        path: '/tenant-catalog/costs',
        summary: 'Set purchase cost (owner/manager/accountant only)',
      })
      .input(UpsertCostInput)
      .output(UpsertCostOutput),
  },
  retailers: retailersContract,
  sync: syncContract,
  pricing: pricingContract,
  inventory: inventoryContract,
  procurement: procurementContract,
  orders: ordersContract,
  receivables: receivablesContract,
  billing: billingContract,
  warehouse: warehouseContract,
}

export type AppContract = typeof contract
