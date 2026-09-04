import { Res } from '@nestjs/common'

/**
 * Marks an `@Implement(...)` controller method as owning its HTTP reply.
 *
 * `@orpc/nest` writes the Fastify reply itself inside its interceptor. Without this marker Nest's
 * router calls `reply.send()` a second time after the method returns, which Fastify logs as
 * `FST_ERR_REP_ALREADY_SENT` on every oRPC request. Injecting `@Res()` is the documented Nest
 * way to say "the framework must not send"; the injected reply is intentionally unused.
 *
 * Usage:
 *   @Implement(contract.x.y)
 *   y(@OwnsReply() _reply: unknown) { return implement(contract.x.y).handler(...) }
 */
export const OwnsReply = (): ParameterDecorator => Res()
