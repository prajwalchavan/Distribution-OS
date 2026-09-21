export { TenantCatalogModule } from './tenant-catalog.module.js'
export {
  TenantCatalogService,
  type ReturnPolicyRow,
  type UpsertReturnPolicyInput,
  type VariantCostRow,
} from './tenant-catalog.service.js'
export { CatalogOverlayService } from './overlay.service.js'
/**
 * DOS-104: the listed variant ids, for `pricing.rates` (pricing is downstream of tenant-catalog, so
 * the import is legal). A plain function on the caller's transaction, no Nest DI.
 */
export { listedVariantIds } from './tenant-catalog.service.js'
/**
 * The importer's transaction-scoped helpers (coordination §4: integrations → tenant-catalog). Plain
 * functions so the worker's commit run uses them without Nest DI; the service delegates to them.
 */
export {
  brandLabels,
  matchVariant,
  upsertListingFromImport,
  restoreListing,
  unlistListing,
  sellSidePackSizes,
  supplierLabels,
  tallyExportSourceByVariant,
  variantBrands,
  variantLabels,
  variantNames,
  type ListingImportResult,
  type ListingImportValues,
  type ListingSnapshot,
  type VariantCandidate,
  type VariantMatch,
  type VariantProbe,
} from './import.js'
