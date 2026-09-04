import { Global, Module, type DynamicModule } from '@nestjs/common'
import { SERVICE_INFO, type ServiceDefinition } from './define.js'
import { DocsController } from './docs.controller.js'

/** Makes the service definition injectable everywhere (TenantGuard reads the allowed roles; DocsController the contract subset). */
@Global()
@Module({})
export class ServiceModule {
  static forService(def: ServiceDefinition): DynamicModule {
    return {
      module: ServiceModule,
      providers: [{ provide: SERVICE_INFO, useValue: def }],
      controllers: [DocsController],
      exports: [SERVICE_INFO],
    }
  }
}
