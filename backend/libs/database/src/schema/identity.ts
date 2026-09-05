import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { actorIs, id, timestamps, tz } from './columns.js'
import { appRw } from './roles.js'
import { membershipRole, users } from './tenancy.js'

/**
 * Identity. Sign-in is username + password against `users`, issued by auth-service (:3000): an EdDSA
 * access token plus one opaque rotating refresh token per device, held in `auth_sessions`.
 * These tables are global (keyed by user), not tenant tables.
 */

export const devicePlatform = pgEnum('device_platform', ['ios', 'android', 'web'])

/** A phone/browser a user signs in from; device_id is what sync_ops and GPS points are keyed by. */
export const devices = pgTable(
  'devices',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    platform: devicePlatform('platform').notNull(),
    model: text('model'),
    osVersion: text('os_version'),
    appVersion: text('app_version'),
    /** PowerSync client id for staff devices. */
    syncClientId: text('sync_client_id'),
    lastSeenAt: tz('last_seen_at').notNull().defaultNow(),
    revokedAt: tz('revoked_at'),
    ...timestamps,
  },
  (t) => [
    index('devices_user_idx').on(t.userId),
    pgPolicy('devices_own', {
      for: 'all',
      to: appRw,
      using: sql`user_id = (SELECT current_setting('app.actor_id', true)) OR (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')`,
      withCheck: sql`user_id = (SELECT current_setting('app.actor_id', true)) OR (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')`,
    }),
  ],
).enableRLS()

/** DPDP: explicit, versioned consent for trip-scoped location tracking, per user per tenant. */
export const locationConsents = pgTable(
  'location_consents',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    tenantId: text('tenant_id').notNull(),
    policyVersion: text('policy_version').notNull(),
    locale: text('locale').notNull(),
    granted: boolean('granted').notNull(),
    grantedAt: tz('granted_at').notNull().defaultNow(),
    withdrawnAt: tz('withdrawn_at'),
    evidence: jsonb('evidence'),
  },
  (t) => [
    index('location_consents_user_idx').on(t.userId, t.tenantId),
    pgPolicy('location_consents_rw', {
      for: 'all',
      to: appRw,
      using: sql`user_id = (SELECT current_setting('app.actor_id', true)) OR (tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system'))`,
      withCheck: sql`user_id = (SELECT current_setting('app.actor_id', true)) OR (SELECT current_setting('app.actor_role', true)) = 'system'`,
    }),
  ],
).enableRLS()

/** OTP abuse control per phone and per IP; written only by the identity service (system role). */
export const otpRateLimits = pgTable(
  'otp_rate_limits',
  {
    key: text('key').notNull(),
    windowStart: tz('window_start').notNull(),
    attempts: integer('attempts').notNull().default(0),
    blockedUntil: tz('blocked_until'),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    uniqueIndex('otp_rate_limits_key_idx').on(t.key, t.windowStart),
    pgPolicy('otp_rate_limits_system', {
      for: 'all',
      to: appRw,
      using: sql`(SELECT current_setting('app.actor_role', true)) = 'system'`,
      withCheck: sql`(SELECT current_setting('app.actor_role', true)) = 'system'`,
    }),
  ],
).enableRLS()

/**
 * One row per signed-in device. The access token (JWT) is stateless; the refresh token is opaque, stored
 * only as sha256 hex, and rotates on every refresh: the new hash replaces `refresh_token_hash` and the old
 * one moves to `previous_refresh_token_hash`. Presenting an already-rotated token means the token leaked,
 * so the whole session is revoked (auth_events kind `refresh_reuse_detected`).
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** The tenant this session is signed in to; the access token's `tid`. */
    tenantId: text('tenant_id'),
    /** Membership role in that tenant at sign-in; the access token's `role`. */
    role: membershipRole('role'),
    deviceId: text('device_id').notNull(),
    deviceName: text('device_name'),
    platform: devicePlatform('platform'),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    previousRefreshTokenHash: text('previous_refresh_token_hash'),
    refreshExpiresAt: tz('refresh_expires_at').notNull(),
    lastUsedAt: tz('last_used_at').notNull().defaultNow(),
    revokedAt: tz('revoked_at'),
    revokedReason: text('revoked_reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_sessions_refresh_hash_idx').on(t.refreshTokenHash),
    index('auth_sessions_user_idx').on(t.userId),
    // A user manages its own sessions (list devices, sign out elsewhere).
    pgPolicy('auth_sessions_own', {
      for: 'all',
      to: appRw,
      using: actorIs('user_id'),
      withCheck: actorIs('user_id'),
    }),
    // The owner of the session's tenant may look at them (revoking from the owner app comes later).
    pgPolicy('auth_sessions_admin_read', {
      for: 'select',
      to: appRw,
      using: sql`(SELECT current_setting('app.actor_role', true)) = 'system'
        OR ((SELECT current_setting('app.actor_role', true)) = 'owner'
            AND tenant_id = (SELECT current_setting('app.tenant_id', true)))`,
    }),
  ],
).enableRLS()

export const authEventKind = pgEnum('auth_event_kind', [
  'login_ok',
  'login_failed',
  'locked',
  'refresh',
  'refresh_reuse_detected',
  'logout',
  'password_changed',
  'password_set_by_admin',
  'tenant_switched',
  'session_revoked',
])

/**
 * Append-only sign-in audit trail (trigger in migration 0005). `user_id` is null when the username did
 * not resolve — `username_attempted` keeps what was typed so lockout and abuse are explainable without
 * ever revealing to the caller whether the username exists.
 */
export const authEvents = pgTable(
  'auth_events',
  {
    id: id(),
    userId: text('user_id').references(() => users.id),
    usernameAttempted: text('username_attempted'),
    tenantId: text('tenant_id'),
    kind: authEventKind('kind').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('auth_events_user_idx').on(t.userId, t.createdAt),
    index('auth_events_username_idx').on(t.usernameAttempted, t.createdAt),
    pgPolicy('auth_events_own_read', {
      for: 'select',
      to: appRw,
      using: sql`user_id = (SELECT current_setting('app.actor_id', true))
        OR (SELECT current_setting('app.actor_role', true)) = 'system'`,
    }),
    // Anyone may append (a failed login has no authenticated actor yet); nothing may update or delete.
    pgPolicy('auth_events_insert', { for: 'insert', to: appRw, withCheck: sql`true` }),
  ],
).enableRLS()
