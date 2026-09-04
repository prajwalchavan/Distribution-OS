import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { ActorRole } from '@dos/db'
import { tenantStorage } from '../../platform/index.js'

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
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>()
    const tenantId = header(req, 'x-tenant-id')
    const actorId = header(req, 'x-actor-id')
    const role = header(req, 'x-actor-role') ?? ''
    if (!tenantId || !actorId || !ROLES.has(role))
      throw new UnauthorizedException('tenant context missing')
    tenantStorage.enterWith({ tenantId, actorId, actorRole: role as ActorRole })
    return true
  }
}

function header(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}
