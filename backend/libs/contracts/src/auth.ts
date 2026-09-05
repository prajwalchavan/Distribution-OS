import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  IdSchema,
  LocaleSchema,
  MembershipRoleSchema,
  PasswordSchema,
  PlatformRoleSchema,
  UsernameSchema,
} from './common.js'

/**
 * Sign-in and session management, served by auth-service (:3000) alone.
 *
 * Username + password (the phone stays a profile field; OTP is a later enhancement). A successful
 * sign-in returns a short-lived EdDSA access token (a JWT every other service verifies with the
 * public key, no call back here) plus an opaque refresh token bound to one device. Refreshing
 * rotates the refresh token in place; presenting a token that was already rotated revokes the whole
 * session. Nothing in this file is tenant-scoped: the tenant is chosen at sign-in and encoded in
 * the access token as `tid`.
 *
 * SELF-SERVICE RESET (docs/23 §8.12). `forgotPassword` / `resetPassword` are the password-free path
 * for a shopkeeper who has no owner to call: the first always answers `{ ok: true }` (an attacker must
 * not learn which usernames exist) and, when the username is real, stores a hashed single-use token
 * that expires in 30 minutes and emits a `PasswordResetRequested` outbox event; the second exchanges
 * that token for a new password and revokes every session. The DELIVERY CHANNEL of the token (SMS /
 * WhatsApp) is the OTP layer docs/22 §7 defers to a later enhancement, so until the notifications
 * module lands the event is recorded and nothing is sent — the procedures are declared now so the six
 * apps' sign-in screens are built against the final surface. `auth.loginWithLink` (a one-time link in
 * a WhatsApp message) and `auth.stepUp` (the manager's PIN typed on the warehouse phone) are NOT
 * declared: the first is the same future layer, the second is superseded by the founder's decision of
 * 2026-09-05 that load-out is approved from the MANAGER app (`warehouse.loadSheets.approve`).
 *
 * PLATFORM STAFF (docs/22 §2 and the founder's decision of 2026-09-05: the platform console is in v1).
 * A `platform_admin` is staff of Distribution OS itself: it holds NO membership, so it has no tenant to
 * sign into and `LoginInput`'s tenant-picking machinery is meaningless for it. It therefore gets its own
 * three procedures — `platformLogin`, `platformRefresh`, `platformMe` — rather than a nullable `tenant`
 * on `TokenPairOutput`, which would have made "every signed-in session has a distributor" untrue for the
 * six apps that rely on it. The access token they mint carries `role: 'platform_admin'` and NO `tid`;
 * `TenantGuard` accepts such a token on **admin-service (:3007) only** and refuses it, before any
 * business logic, on all six tenant services. The same password rules, lockout, device-bound rotating
 * refresh token and `auth_events` trail apply — a platform session is not a privileged shortcut, and it
 * reads a distributor's rows only through an owner-approved `support_grants` window (tenancy.ts).
 *
 * WHITE-LABEL (docs/17 §D6): `AuthTenantSchema` and `MembershipSummarySchema` carry the distributor's
 * `displayName` and a pre-signed `logoUrl` so the sign-in landing and the retailer's distributor cards
 * show the distributor's own name and logo before any tenant-scoped call is possible. The auth service
 * reads `tenant_settings` for them as the service (it is not tenant-scoped); a tenant without a logo
 * answers `logoUrl: null` and `displayName` falls back to `legalName`.
 */

export const AuthPlatformSchema = z.enum(['web', 'android', 'ios'])
export type AuthPlatform = z.infer<typeof AuthPlatformSchema>

/** Presented at sign-in; the policy in PasswordSchema is enforced only where a password is SET. */
export const PasswordInputSchema = z.string().min(1).max(200)

/** Opaque, random, base64url; never a JWT and never stored in clear (auth_sessions keeps its sha256). */
export const RefreshTokenSchema = z.string().min(20).max(400)

/**
 * How a device identifies itself when a session is READ back. `auth_sessions.device_id` is plain text
 * (a seeded or imported row may not be a UUID), so reading is tolerant while sign-in below insists on a
 * client-generated UUIDv7 — strict in, tolerant out, so one odd row can never fail a whole listing.
 */
export const DeviceIdSchema = z.string().min(1).max(128)

export const AuthUserSchema = z.object({
  id: IdSchema,
  /** Null for a user created by invite who has not been given a username yet: they cannot sign in. */
  username: UsernameSchema.nullable(),
  name: z.string().min(1).max(120),
  locale: LocaleSchema,
  /** True after a temporary password was set by the owner/manager: the app must force a change. */
  mustChangePassword: z.boolean(),
})
export type AuthUser = z.infer<typeof AuthUserSchema>

/** Just enough of the tenant to title the app; the full record comes from tenancy.me. */
export const AuthTenantSchema = z.object({
  id: IdSchema,
  slug: z.string().min(2).max(40),
  legalName: z.string().min(2).max(200),
  /** `branding.display_name`, falling back to the legal name; what the app chrome shows (§D6). */
  displayName: z.string().min(1).max(200),
  /** Pre-signed, 24 h; null until the owner uploads a logo. */
  logoUrl: z.string().nullable(),
})
export type AuthTenant = z.infer<typeof AuthTenantSchema>

/** One row per distributor this user belongs to; the app shows a picker when there is more than one. */
export const MembershipSummarySchema = z.object({
  tenantId: IdSchema,
  tenantSlug: z.string().min(2).max(40),
  /** The legal name. */
  tenantName: z.string().min(2).max(200),
  /** The distributor's own display name and logo for the retailer's distributor cards (§D6). */
  displayName: z.string().min(1).max(200),
  logoUrl: z.string().nullable(),
  role: MembershipRoleSchema,
  status: z.enum(['invited', 'active', 'disabled']),
})
export type MembershipSummary = z.infer<typeof MembershipSummarySchema>

export const AuthSessionSchema = z.object({
  id: IdSchema,
  deviceId: DeviceIdSchema,
  deviceName: z.string().max(120).nullable(),
  platform: AuthPlatformSchema.nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
})
export type AuthSession = z.infer<typeof AuthSessionSchema>

/** What login, refresh and switch-tenant all return. */
export const TokenPairOutput = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  /** Lifetime of the access token in seconds (AUTH_ACCESS_TTL_SECONDS, 15 minutes by default). */
  accessExpiresIn: z.number().int().positive(),
  refreshToken: RefreshTokenSchema,
  refreshExpiresAt: z.iso.datetime(),
  user: AuthUserSchema,
  tenant: AuthTenantSchema,
  role: MembershipRoleSchema,
  memberships: z.array(MembershipSummarySchema),
})
export type TokenPair = z.infer<typeof TokenPairOutput>

export const LoginInput = z.object({
  username: UsernameSchema,
  password: PasswordInputSchema,
  /** Client-generated UUIDv7, stable for the life of the install: one session per device. */
  deviceId: IdSchema,
  deviceName: z.string().min(1).max(120).optional(),
  platform: AuthPlatformSchema.optional(),
  /**
   * OMIT THIS unless the person works for more than one distributor: leaving it out signs them into
   * their own (the only active membership, or the first). Sending a tenant they are not an active
   * member of is a 403 — including the sample value an API console pre-fills.
   */
  tenantId: IdSchema.optional().describe(
    'Optional. Omit to sign in to your own distributor. Only send a tenantId you are a member of (see `memberships` in the response).',
  ),
})
export type LoginIn = z.infer<typeof LoginInput>

export const RefreshInput = z.object({
  refreshToken: RefreshTokenSchema,
  deviceId: IdSchema,
})
export type RefreshIn = z.infer<typeof RefreshInput>

export const LogoutInput = z.object({ refreshToken: RefreshTokenSchema })
export type LogoutIn = z.infer<typeof LogoutInput>

export const SwitchTenantInput = z.object({
  refreshToken: RefreshTokenSchema,
  deviceId: IdSchema,
  tenantId: IdSchema,
})
export type SwitchTenantIn = z.infer<typeof SwitchTenantInput>

export const AuthMeOutput = z.object({
  user: AuthUserSchema,
  /** Null only in the transitional case of a token whose membership was disabled mid-session. */
  tenant: AuthTenantSchema.nullable(),
  role: MembershipRoleSchema.nullable(),
  memberships: z.array(MembershipSummarySchema),
  session: AuthSessionSchema,
})
export type AuthMe = z.infer<typeof AuthMeOutput>

// ---------------------------------------------------------------------------------------------------------------
// platform staff: a session with a role and no tenant (admin-service :3007)

/**
 * Sign-in for Distribution OS staff. No `tenantId`: a platform admin belongs to no distributor, and
 * sending one would be meaningless rather than merely ignored. Everything else — the device-bound
 * session, the lockout after five failures, the identical 401 for an unknown username and a wrong
 * password — is exactly `LoginInput`'s behaviour.
 */
export const PlatformLoginInput = z.object({
  username: UsernameSchema,
  password: PasswordInputSchema,
  /** Client-generated UUIDv7, stable for the life of the install: one session per device. */
  deviceId: IdSchema,
  deviceName: z.string().min(1).max(120).optional(),
  platform: AuthPlatformSchema.optional(),
})
export type PlatformLoginIn = z.infer<typeof PlatformLoginInput>

/**
 * What `platformLogin` and `platformRefresh` return. The differences from `TokenPairOutput` are the
 * point of the separate procedure: there is no `tenant`, no `memberships` and no membership `role` —
 * the access token behind it carries `role: 'platform_admin'` and no `tid`, and every one of the six
 * tenant services refuses it at the guard.
 */
export const PlatformTokenPairOutput = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  accessExpiresIn: z.number().int().positive(),
  refreshToken: RefreshTokenSchema,
  refreshExpiresAt: z.iso.datetime(),
  user: AuthUserSchema,
  role: PlatformRoleSchema,
})
export type PlatformTokenPair = z.infer<typeof PlatformTokenPairOutput>

/** The signed-in platform user and this device's session. No tenant, by construction. */
export const PlatformMeOutput = z.object({
  user: AuthUserSchema,
  role: PlatformRoleSchema,
  session: AuthSessionSchema,
})
export type PlatformMe = z.infer<typeof PlatformMeOutput>

export const SessionsListOutput = z.object({
  items: z.array(AuthSessionSchema.extend({ current: z.boolean() })),
})
export type SessionsList = z.infer<typeof SessionsListOutput>

export const RevokeSessionInput = z.object({ sessionId: IdSchema })
export type RevokeSessionIn = z.infer<typeof RevokeSessionInput>

export const ChangePasswordInput = z.object({
  currentPassword: PasswordInputSchema,
  newPassword: PasswordSchema,
})
export type ChangePasswordIn = z.infer<typeof ChangePasswordInput>

/** Always answers ok; whether a token was issued is never revealed on the wire. */
export const ForgotPasswordInput = z.object({ username: UsernameSchema })
export type ForgotPasswordIn = z.infer<typeof ForgotPasswordInput>

/** Opaque single-use token from the reset message; 30-minute lifetime, hashed at rest. */
export const PasswordResetTokenSchema = z.string().min(20).max(400)

export const ResetPasswordInput = z.object({
  token: PasswordResetTokenSchema,
  newPassword: PasswordSchema,
})
export type ResetPasswordIn = z.infer<typeof ResetPasswordInput>

/** Every auth procedure that succeeds without a payload answers with this. */
export const AuthOkOutput = z.object({ ok: z.literal(true) })
export type AuthOk = z.infer<typeof AuthOkOutput>

/** The public half of the signing keys, so any service (or an integrator) can verify an access token. */
export const JwksOutput = z.object({ keys: z.array(z.record(z.string(), z.unknown())) })
export type Jwks = z.infer<typeof JwksOutput>

/**
 * Declared so the generated OpenAPI shows them. An unknown username and a wrong password return the
 * SAME 401 (an attacker must not learn which usernames exist); five consecutive failures lock the
 * account for fifteen minutes and answer 423.
 */
const SIGN_IN_ERRORS = {
  UNAUTHORIZED: { message: 'Invalid username or password' },
  FORBIDDEN: { message: 'This account is disabled or has no active membership' },
  LOCKED: { status: 423, message: 'Too many failed attempts. Try again in a few minutes.' },
}

/** Refresh/switch: the token is unknown, expired, or was already rotated (reuse revokes the session). */
const SESSION_ERRORS = {
  UNAUTHORIZED: { message: 'Session expired. Sign in again.' },
  FORBIDDEN: { message: 'This account is disabled or has no active membership' },
}

const TOKEN_ERRORS = {
  UNAUTHORIZED: { message: 'Sign in to continue' },
}

/** Reset: the token is unknown, expired or already used. */
const RESET_ERRORS = {
  UNAUTHORIZED: { message: 'This reset link is invalid or has expired. Ask for a new one.' },
}

export const authContract = {
  login: oc
    .route({ method: 'POST', path: '/auth/login', summary: 'Sign in with username and password' })
    .input(LoginInput)
    .output(TokenPairOutput)
    .errors(SIGN_IN_ERRORS),
  refresh: oc
    .route({
      method: 'POST',
      path: '/auth/refresh',
      summary: 'Exchange a refresh token for a new pair (rotates the refresh token)',
    })
    .input(RefreshInput)
    .output(TokenPairOutput)
    .errors(SESSION_ERRORS),
  logout: oc
    .route({ method: 'POST', path: '/auth/logout', summary: 'Revoke this device session' })
    .input(LogoutInput)
    .output(AuthOkOutput),
  switchTenant: oc
    .route({
      method: 'POST',
      path: '/auth/switch-tenant',
      summary: 'Open a session on another membership of the same user',
    })
    .input(SwitchTenantInput)
    .output(TokenPairOutput)
    .errors(SESSION_ERRORS),
  me: oc
    .route({
      method: 'GET',
      path: '/auth/me',
      summary: 'The signed-in user, the active membership and this session',
    })
    .output(AuthMeOutput)
    .errors(TOKEN_ERRORS),
  // Distribution OS staff: a session with a role and no tenant, accepted by admin-service alone.
  platformLogin: oc
    .route({
      method: 'POST',
      path: '/auth/platform/login',
      summary: 'Sign in as Distribution OS platform staff (no distributor)',
    })
    .input(PlatformLoginInput)
    .output(PlatformTokenPairOutput)
    .errors(SIGN_IN_ERRORS),
  platformRefresh: oc
    .route({
      method: 'POST',
      path: '/auth/platform/refresh',
      summary: 'Exchange a platform refresh token for a new pair (rotates the refresh token)',
    })
    .input(RefreshInput)
    .output(PlatformTokenPairOutput)
    .errors(SESSION_ERRORS),
  platformMe: oc
    .route({
      method: 'GET',
      path: '/auth/platform/me',
      summary: 'The signed-in platform user and this session',
    })
    .output(PlatformMeOutput)
    .errors(TOKEN_ERRORS),
  sessions: oc
    .route({ method: 'GET', path: '/auth/sessions', summary: 'Devices signed in as this user' })
    .output(SessionsListOutput)
    .errors(TOKEN_ERRORS),
  revokeSession: oc
    .route({
      method: 'POST',
      path: '/auth/sessions/revoke',
      summary: 'Sign one of your devices out',
    })
    .input(RevokeSessionInput)
    .output(AuthOkOutput)
    .errors(TOKEN_ERRORS),
  changePassword: oc
    .route({
      method: 'POST',
      path: '/auth/change-password',
      summary: 'Change your password; every other session is revoked',
    })
    .input(ChangePasswordInput)
    .output(AuthOkOutput)
    .errors(TOKEN_ERRORS),
  forgotPassword: oc
    .route({
      method: 'POST',
      path: '/auth/forgot-password',
      summary: 'Ask for a password reset; always answers ok, the token travels by a later channel',
    })
    .input(ForgotPasswordInput)
    .output(AuthOkOutput),
  resetPassword: oc
    .route({
      method: 'POST',
      path: '/auth/reset-password',
      summary: 'Set a new password with a single-use reset token; every session is revoked',
    })
    .input(ResetPasswordInput)
    .output(AuthOkOutput)
    .errors(RESET_ERRORS),
  jwks: oc
    .route({
      method: 'GET',
      path: '/.well-known/jwks.json',
      summary: 'Public keys that verify access tokens',
    })
    .output(JwksOutput),
}
