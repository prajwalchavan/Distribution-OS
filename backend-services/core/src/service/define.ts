import type { DynamicModule, Type } from '@nestjs/common'
import type { ActorRole } from '@dos/db'
import { contract, type AppContract } from '@dos/contracts'

export type ContractKey = keyof AppContract

/** Injection token for the running service's definition (provided by ServiceModule.forService). */
export const SERVICE_INFO = Symbol('SERVICE_INFO')

/**
 * One backend service = one process, one port, one subset of the contract, one set of roles that may call it.
 * The business modules come from this library; the service only composes them (docs/19).
 */
export interface ServiceDefinition {
  /** Short name used in logs and env vars, e.g. `owner` → `OWNER_SERVICE_PORT`. */
  name: string
  title: string
  /** Default listen port; `<NAME>_SERVICE_PORT` or `PORT` override it. */
  defaultPort: number
  /** Membership roles allowed through TenantGuard on this service. */
  roles: readonly ActorRole[]
  /** Nest modules this service mounts. */
  modules: (Type<unknown> | DynamicModule)[]
  /** Which parts of the shared contract this service serves (drives the OpenAPI document). */
  contractKeys: readonly ContractKey[]
}

export function defineService(def: ServiceDefinition): ServiceDefinition {
  return def
}

/** The subset of the contract a service exposes, for OpenAPI generation. */
export function pickContract(keys: readonly ContractKey[]): Partial<AppContract> {
  const subset: Record<string, unknown> = {}
  for (const key of keys) subset[key] = contract[key]
  return subset
}

export function servicePort(def: ServiceDefinition, env: NodeJS.ProcessEnv = process.env): number {
  const specific = env[`${def.name.toUpperCase()}_SERVICE_PORT`]
  const value = Number(specific ?? env.PORT ?? def.defaultPort)
  return Number.isInteger(value) && value > 0 ? value : def.defaultPort
}
