import { Controller, Get, Header, Inject } from '@nestjs/common'
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { pickContract, SERVICE_INFO, servicePort, type ServiceDefinition } from './define.js'

/**
 * `GET /docs` — interactive API reference (Scalar) for THIS service's endpoints; `GET /docs/openapi.json` — the spec.
 * Generated from the shared contract subset, so the docs cannot drift from what the controllers implement.
 */
@Controller('docs')
export class DocsController {
  private spec: Promise<unknown> | null = null

  constructor(@Inject(SERVICE_INFO) private readonly service: ServiceDefinition) {}

  @Get('openapi.json')
  openapi(): Promise<unknown> {
    this.spec ??= new OpenAPIGenerator({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }).generate(pickContract(this.service.contractKeys), {
      info: {
        title: `${this.service.title} — Distribution OS`,
        version: process.env.APP_VERSION ?? '0.0.0',
        description: `Roles allowed: ${this.service.roles.join(', ')}. Until phone-OTP login lands, send x-tenant-id, x-actor-id and x-actor-role headers (demo ids: docs/18-build-log.md).`,
      },
      servers: [{ url: `http://localhost:${servicePort(this.service)}` }],
    })
    return this.spec
  }

  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  page(): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${this.service.title} API</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0"><script id="api-reference" data-url="/docs/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0"></script></body></html>`
  }
}
