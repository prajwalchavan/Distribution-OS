import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { ActorRole } from '@dos/db'
import { tenantStorage } from '../../platform/index.js'
import { SERVICE_INFO, type ServiceDefinition } from '../../service/define.js'

const ROLES: ReadonlySet<string> = new Set([
  'owner',
  'manager',
  'salesperson',
  'delivery',
  'accountant',
  'retailer',
])

/**
 * Placeholder until identity (Better Auth) lands: reads x-tenant-id / x-actor-id / x-actor-role headers.
 * The real guard verifies the session token, loads the membership and refuses disabled members.
 * Applied per controller with @UseGuards, never globally, so /health stays open to load balancers.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  /** Present when running inside a service (docs/19): only that service's roles may pass. Absent in module specs. */
  constructor(
    @Optional() @Inject(SERVICE_INFO) private readonly service: ServiceDefinition | null,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>()
    const tenantId = header(req, 'x-tenant-id')
    const actorId = header(req, 'x-actor-id')
    const role = header(req, 'x-actor-role') ?? ''
    if (!tenantId || !actorId || !ROLES.has(role))
      throw new UnauthorizedException('tenant context missing')
    if (this.service && !this.service.roles.includes(role as ActorRole))
      throw new ForbiddenException(`${this.service.name}-service does not serve the ${role} role`)
    tenantStorage.enterWith({ tenantId, actorId, actorRole: role as ActorRole })
    return true
  }
}

function header(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}
