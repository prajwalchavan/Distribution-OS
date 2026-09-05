export { TenantCatalogModule } from './tenant-catalog.module.js'
export { TenantCatalogService } from './tenant-catalog.service.js'
export { CatalogOverlayService } from './overlay.service.js'
/**
 * The importer's transaction-scoped helpers (coordination §4: integrations → tenant-catalog). Plain
 * functions so the worker's commit run uses them without Nest DI; the service delegates to them.
 */
export {
  matchVariant,
  upsertListingFromImport,
  restoreListing,
  unlistListing,
  sellSidePackSizes,
  supplierLabels,
  tallyExportSourceByVariant,
  variantLabels,
  type ListingImportResult,
  type ListingImportValues,
  type ListingSnapshot,
  type VariantCandidate,
  type VariantMatch,
  type VariantProbe,
} from './import.js'
