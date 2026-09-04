import { sql } from 'drizzle-orm'
import {
  date,
  index,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  id,
  paise,
  pieces,
  tenantRolePolicy,
  timestamps,
  tz,
  BACK_OFFICE_ROLES,
} from './columns.js'
import { tenantRef } from './platform.js'
import { appRw } from './roles.js'
import { users } from './tenancy.js'

/** Compute only, no payroll: targets per rep/brand/period, achievement rollups, and the computed payout. */

export const targetMetric = pgEnum('target_metric', [
  'value',
  'pieces',
  'lines',
  'outlets',
  'collections',
])

export const targets = pgTable(
  'targets',
  {
    id: id(),
    tenantId: tenantRef(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    brandId: text('brand_id'),
    metric: targetMetric('metric').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    targetValue: paise('target_value').notNull(),
    /** Slabs: [{fromPct, toPct, payoutBps | flatPaise}] */
    payoutRule: jsonb('payout_rule').notNull(),
    ...timestamps,
  },
  (t) => [
    index('targets_user_period_idx').on(t.tenantId, t.userId, t.periodFrom),
    pgPolicy('targets_read', {
      for: 'select',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR user_id = (SELECT current_setting('app.actor_id', true)))`,
    }),
    pgPolicy('targets_write', {
      for: 'all',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')`,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')`,
    }),
  ],
).enableRLS()

export const achievements = pgTable(
  'achievements',
  {
    id: id(),
    tenantId: tenantRef(),
    targetId: text('target_id')
      .notNull()
      .references(() => targets.id),
    achievedValue: paise('achieved_value').notNull().default(0),
    achievedPieces: pieces('achieved_pieces').notNull().default(0),
    achievedPct: paise('achieved_pct_bps').notNull().default(0),
    computedAt: tz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('achievements_target_idx').on(t.tenantId, t.targetId),
    pgPolicy('achievements_read', {
      for: 'select',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND ((SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system') OR EXISTS (SELECT 1 FROM targets tg WHERE tg.id = achievements.target_id AND tg.user_id = (SELECT current_setting('app.actor_id', true))))`,
    }),
    pgPolicy('achievements_write', {
      for: 'all',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'system'`,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'system'`,
    }),
  ],
).enableRLS()

export const computedPayouts = pgTable(
  'computed_payouts',
  {
    id: id(),
    tenantId: tenantRef(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    amountPaise: paise('amount_paise').notNull(),
    breakdown: jsonb('breakdown').notNull(),
    approvedBy: text('approved_by'),
    approvedAt: tz('approved_at'),
    computedAt: tz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('computed_payouts_idx').on(t.tenantId, t.userId, t.periodFrom, t.periodTo),
    tenantRolePolicy('computed_payouts_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()
