import { Global, Module, type DynamicModule } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { SERVICE_INFO, type ServiceDefinition } from './define.js'
import { DocsController } from './docs.controller.js'
import { StorageController } from './storage.controller.js'
import { SupportAuditInterceptor } from './support-audit.interceptor.js'
import { SwaggerController } from './swagger.controller.js'

/** Makes the service definition injectable everywhere (TenantGuard reads the allowed roles; the docs controllers the contract subset). */
@Global()
@Module({})
export class ServiceModule {
  static forService(def: ServiceDefinition): DynamicModule {
    return {
      module: ServiceModule,
      providers: [
        { provide: SERVICE_INFO, useValue: def },
        // Global, and a no-op on every request that is not an approved support window (module 13):
        // `TenantGuard` is what decides there is one, and it only ever sets `supportAccess` when a
        // distributor's owner has already said yes.
        { provide: APP_INTERCEPTOR, useClass: SupportAuditInterceptor },
      ],
      controllers: [DocsController, SwaggerController, StorageController],
      exports: [SERVICE_INFO],
    }
  }
}
