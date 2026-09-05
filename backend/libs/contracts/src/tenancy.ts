import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  GstinSchema,
  IdSchema,
  LocaleSchema,
  MembershipRoleSchema,
  MutationBase,
  PasswordSchema,
  PhoneSchema,
  StateCodeSchema,
  UsernameSchema,
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
  /** Null while the user has been invited but not given a sign-in name yet. */
  username: UsernameSchema.nullable(),
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

/**
 * Staff administration: the owner (and the manager) create the people who work in this distributor
 * and hand them a temporary password. A retailer is never staff — it arrives through
 * `retailers.linkIdentity` instead, so the role here excludes it.
 */
export const StaffRoleSchema = MembershipRoleSchema.exclude(['retailer'])
export type StaffRole = z.infer<typeof StaffRoleSchema>

export const StaffMemberSchema = z.object({
  userId: IdSchema,
  username: UsernameSchema.nullable(),
  name: z.string().min(1).max(120),
  phone: PhoneSchema,
  role: MembershipRoleSchema,
  status: z.enum(['invited', 'active', 'disabled']),
  lastLoginAt: z.iso.datetime().nullable(),
})
export type StaffMember = z.infer<typeof StaffMemberSchema>

export const StaffListOutput = z.object({ items: z.array(StaffMemberSchema) })
export type StaffList = z.infer<typeof StaffListOutput>

export const StaffCreateInput = MutationBase.extend({
  /** Client-generated UUIDv7 of the membership row. */
  id: IdSchema,
  /** Client-generated UUIDv7 of the user; reused when the same person already exists by phone. */
  userId: IdSchema,
  username: UsernameSchema,
  name: z.string().min(1).max(120),
  phone: PhoneSchema,
  role: StaffRoleSchema,
  locale: LocaleSchema.optional(),
  temporaryPassword: PasswordSchema,
})
export type StaffCreateIn = z.infer<typeof StaffCreateInput>

export const StaffCreateOutput = z.object({
  userId: IdSchema,
  membershipId: IdSchema,
  mustChangePassword: z.literal(true),
})
export type StaffCreateOut = z.infer<typeof StaffCreateOutput>

export const StaffSetPasswordInput = MutationBase.extend({
  userId: IdSchema,
  temporaryPassword: PasswordSchema,
})
export type StaffSetPasswordIn = z.infer<typeof StaffSetPasswordInput>

export const StaffSetStatusInput = MutationBase.extend({
  userId: IdSchema,
  status: z.enum(['active', 'disabled']),
})
export type StaffSetStatusIn = z.infer<typeof StaffSetStatusInput>

/** Staff mutations that succeed without a payload. */
export const StaffOkOutput = z.object({ ok: z.literal(true) })
export type StaffOk = z.infer<typeof StaffOkOutput>

export const staffContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/tenancy/staff',
      summary: 'People who work in this distributor',
    })
    .output(StaffListOutput),
  create: oc
    .route({
      method: 'POST',
      path: '/tenancy/staff',
      summary: 'Add a staff member with a temporary password',
    })
    .input(StaffCreateInput)
    .output(StaffCreateOutput),
  setPassword: oc
    .route({
      method: 'POST',
      path: '/tenancy/staff/set-password',
      summary: 'Reset a staff password; they must change it at next sign-in',
    })
    .input(StaffSetPasswordInput)
    .output(StaffOkOutput),
  setStatus: oc
    .route({
      method: 'POST',
      path: '/tenancy/staff/set-status',
      summary: 'Enable or disable a staff membership (disabling revokes their sessions)',
    })
    .input(StaffSetStatusInput)
    .output(StaffOkOutput),
}
