import { Module } from '@nestjs/common'
import { ORPCModule, onError } from '@orpc/nest'
import { DbModule } from './platform/index.js'
import { HealthModule } from './modules/health/index.js'
import { TenancyModule } from './modules/tenancy/index.js'
import { CatalogModule } from './modules/catalog/index.js'
import { TenantCatalogModule } from './modules/tenant-catalog/index.js'

/**
 * The modular monolith. Each bounded context is one module under src/modules/<name>/ and exposes
 * only what its index.ts exports (eslint-plugin-boundaries enforces this). Modules integrate through
 * exported services or outbox events, never through another module's tables.
 */
@Module({
  imports: [
    ORPCModule.forRoot({
      interceptors: [
        onError((error) => {
          console.error(error)
        }),
      ],
    }),
    DbModule,
    HealthModule,
    TenancyModule,
    CatalogModule,
    TenantCatalogModule,
  ],
})
export class AppModule {}
