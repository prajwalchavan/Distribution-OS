import { Controller, Get, Header, Inject } from '@nestjs/common'
import { SERVICE_INFO, servicePort, type ServiceDefinition } from './define.js'

const SWAGGER_UI = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.29.0'
const AUTH_PORT = 3000

/**
 * `GET /swagger` — the same OpenAPI document as `/docs`, rendered in Swagger UI rather than Scalar.
 * Both read `/docs/openapi.json`, so neither can drift from the contract. The founder asked for
 * Swagger by name; Scalar stays because it renders the role annotations more compactly.
 */
@Controller('swagger')
export class SwaggerController {
  constructor(@Inject(SERVICE_INFO) private readonly service: ServiceDefinition) {}

  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  page(): string {
    const port = servicePort(this.service)
    const isAuth = this.service.name === 'auth'
    const hint = isAuth
      ? 'Start with POST /auth/login (username + password). The response carries the access token.'
      : `Get a token from POST http://localhost:${AUTH_PORT}/auth/login, then press Authorize and paste it.`
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(this.service.title)} — Swagger UI</title>
    <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .dos-bar { font: 14px/1.5 system-ui, sans-serif; padding: 10px 16px; background: #1b1b1f; color: #f4f4f5; }
      .dos-bar b { color: #fff; }
      .dos-bar a { color: #8ab4f8; }
    </style>
  </head>
  <body>
    <div class="dos-bar">
      <b>${escapeHtml(this.service.title)}</b> · port ${port} · roles ${escapeHtml(this.service.roles.join(', '))}
      · ${escapeHtml(hint)}
      · <a href="/docs">Scalar view</a> · <a href="/docs/openapi.json">openapi.json</a>
    </div>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI}/swagger-ui-bundle.js" crossorigin></script>
    <script src="${SWAGGER_UI}/swagger-ui-standalone-preset.js" crossorigin></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        persistAuthorization: true,
        displayRequestDuration: true,
        tryItOutEnabled: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
      })
    </script>
  </body>
</html>`
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] satisfies
        string | undefined as string,
  )
}
