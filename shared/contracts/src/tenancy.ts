import { z } from 'zod'
import {
  GstinSchema,
  IdSchema,
  LocaleSchema,
  MembershipRoleSchema,
  PhoneSchema,
  StateCodeSchema,
} from './common.js'

export const TenantSchema = z.object({
  id: IdSchema,
  slug: z.string().min(2).max(40),
  legalName: z.string().min(2).max(200),
  gstin: GstinSchema.nullable(),
  stateCode: StateCodeSchema,
  plan: z.enum(['pilot', 'starter', 'growth']),
  status: z.enum(['active', 'suspended', 'closed']),
})
export type Tenant = z.infer<typeof TenantSchema>

export const UserSchema = z.object({
  id: IdSchema,
  phone: PhoneSchema,
  name: z.string().min(1).max(120),
  locale: LocaleSchema,
})
export type User = z.infer<typeof UserSchema>

export const MembershipSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  userId: IdSchema,
  role: MembershipRoleSchema,
  status: z.enum(['invited', 'active', 'disabled']),
})
export type Membership = z.infer<typeof MembershipSchema>

export const MeOutputSchema = z.object({
  user: UserSchema,
  tenant: TenantSchema,
  membership: MembershipSchema,
})
export type MeOutput = z.infer<typeof MeOutputSchema>
