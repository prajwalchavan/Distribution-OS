import { z } from 'zod'

/** Client-generated UUIDv7. */
export const IdSchema = z.uuid()

/** Integer paise. Never a float, never a string with a decimal point. */
export const PaiseSchema = z.number().int().safe()

/** Integer pieces (base unit). Cases are derived using the product's case size. */
export const PiecesSchema = z.number().int().nonnegative()

/** Basis points: 8.33% = 833. */
export const BpsSchema = z.number().int().min(0).max(10_000)

/**
 * Every mutation carries one. The client generates it once per user intent (a tap), stores it with
 * the pending op, and re-sends the same key on retry so the server can return the stored result.
 */
export const IdempotencyKeySchema = z.string().min(8).max(128)

export const PhoneSchema = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Indian mobile in E.164, e.g. +919876543210')

export const GstinSchema = z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)

export const StateCodeSchema = z.string().regex(/^\d{2}$/)

export const LocaleSchema = z.enum(['en-IN', 'hi-IN', 'mr-IN'])

export const MembershipRoleSchema = z.enum([
  'owner',
  'manager',
  'salesperson',
  'delivery',
  'accountant',
  'retailer',
])
export type MembershipRole = z.infer<typeof MembershipRoleSchema>

export const MutationBase = z.object({ idempotencyKey: IdempotencyKeySchema })

/** GET inputs arrive as query strings; these accept both the typed value and its string form. */
export const QueryBoolSchema = z.union([z.boolean(), z.stringbool()])
export const QueryIntSchema = z.coerce.number().int()
