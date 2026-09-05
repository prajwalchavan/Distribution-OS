import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import type {
  AuditList,
  AuditListInput,
  BrandingGet,
  FeatureFlagsList,
  FeatureFlagsSetIn,
  NumberingList,
  NumberingListInput,
  NumberingSeries,
  NumberingUpsertIn,
  SettingsGet,
  SettingsGetInput,
  SettingsSetIn,
  TenantUpdateIn,
  TenantUpdateOut,
} from '@dos/contracts'
import type { z } from 'zod'
import { financialYear } from '@dos/domain'
import {
  auditLog,
  DEFAULT_FLAGS,
  featureFlags,
  NUMBERING_SERIES,
  numberingSeries,
  tenants,
  tenantSettings,
  withTenant,
  type Db,
} from '@dos/db'
import {
  ANY_MEMBER,
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  isRestrictViolation,
  OWNER,
  pgMessage,
  requireDb,
  requireRole,
  STAFF,
  writeAudit,
} from '../../platform/index.js'
import { sellerBranding } from './branding.js'

type SettingsGetIn = z.infer<typeof SettingsGetInput>
type NumberingListIn = z.infer<typeof NumberingListInput>
type AuditListIn = z.infer<typeof AuditListInput>
type NumberingRow = typeof numberingSeries.$inferSelect

/** The window `audit.list` defaults to and the widest it accepts (docs/20 rule 3). */
const AUDIT_DEFAULT_DAYS = 30
const AUDIT_MAX_DAYS = 92

const istStart = (date: string): Date => new Date(`${date}T00:00:00.000+05:30`)
const istEnd = (date: string): Date => new Date(`${date}T23:59:59.999+05:30`)

/**
 * The distributor's configuration (docs/23 §8.13): the white-label block every app's chrome shows,
 * the `tenant_settings` rows the owner edits, the document number series (per-tenant configuration,
 * never code — docs/17 §D1), the feature flags every app hides a feature behind, the tenant's legal
 * identity, and the audit trail that records who changed which of them.
 *
 * Every write is the OWNER's alone (docs/22 2026-09-05: no settings for the accountant) and lands
 * in `audit_log`; RLS says the same thing at the database (`tenant_settings_owner`,
 * `feature_flags_write_*`, `tenants_owner_update`, the numbering guard trigger).
 */
@Injectable()
export class TenantConfigService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  // -------------------------------------------------------------------------------------------------------------
  // branding

  /**
   * Service-mediated on purpose: the retailer role reads `branding.%` keys only and never `upi_vpa`
   * or a threshold at the database, so the loader escalates for the named keys and the shop's app
   * still gets the one block it needs (docs/23 §6.5). Everyone else reads it straight.
   */
  async branding(): Promise<BrandingGet> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), (tx) => sellerBranding(tx))
  }

  // -------------------------------------------------------------------------------------------------------------
  // settings

  /** Staff read every non-secret key; the owner reads `secret.*` too. RLS enforces both halves. */
  async getSettings(input: SettingsGetIn): Promise<SettingsGet> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: SQL[] = [eq(tenantSettings.tenantId, ctx.tenantId)]
      if (input.keys && input.keys.length > 0) filters.push(inArray(tenantSettings.key, input.keys))
      const rows = await tx
        .select()
        .from(tenantSettings)
        .where(and(...filters))
        .orderBy(tenantSettings.key)
      return {
        items: rows
          .filter((r) => ctx.actorRole === 'owner' || !r.key.startsWith('secret.'))
          .map((r) => ({
            key: r.key,
            value: r.value as SettingsGet['items'][number]['value'],
            updatedAt: r.updatedAt?.toISOString() ?? null,
          })),
      }
    })
  }

  /** Owner only. One transaction, one `audit_log` row per key with before → after. */
  async setSettings(input: SettingsSetIn): Promise<SettingsGet> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const keys = input.items.map((i) => i.key)
        const before = new Map(
          (
            await tx
              .select({ key: tenantSettings.key, value: tenantSettings.value })
              .from(tenantSettings)
              .where(
                and(eq(tenantSettings.tenantId, ctx.tenantId), inArray(tenantSettings.key, keys)),
              )
          ).map((r) => [r.key, r.value]),
        )
        const now = new Date()
        for (const item of input.items) {
          await tx
            .insert(tenantSettings)
            .values({ tenantId: ctx.tenantId, key: item.key, value: item.value })
            .onConflictDoUpdate({
              target: [tenantSettings.tenantId, tenantSettings.key],
              set: { value: item.value, updatedAt: now },
            })
          await writeAudit(tx, {
            action: 'setting.set',
            entityType: 'tenant_setting',
            entityId: item.key,
            before: { value: before.get(item.key) ?? null },
            // A credential is never echoed into the trail; the trail says it changed, not to what.
            after: { value: item.key.startsWith('secret.') ? '[redacted]' : item.value },
          })
        }
        return this.readSettings(tx, keys)
      }),
    )
  }

  private async readSettings(tx: Db, keys: readonly string[]): Promise<SettingsGet> {
    const ctx = currentTenant()
    const rows = await tx
      .select()
      .from(tenantSettings)
      .where(and(eq(tenantSettings.tenantId, ctx.tenantId), inArray(tenantSettings.key, [...keys])))
      .orderBy(tenantSettings.key)
    return {
      items: rows.map((r) => ({
        key: r.key,
        value: r.value as SettingsGet['items'][number]['value'],
        updatedAt: r.updatedAt?.toISOString() ?? null,
      })),
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // numbering series — per-tenant configuration, never code (docs/17 §D1)

  async listNumbering(input: NumberingListIn): Promise<NumberingList> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const fy = input.fy ?? financialYear()
    return withTenant(db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(numberingSeries)
        .where(and(eq(numberingSeries.tenantId, ctx.tenantId), eq(numberingSeries.fy, fy)))
        .orderBy(numberingSeries.seriesCode)
      return { fy, items: rows.map(toSeries) }
    })
  }

  /**
   * Creates the row for a code the tenant has no series of yet (any code: a distributor may keep a
   * second B2C series) and edits prefix / start / mode until the first number is issued. The
   * database guard (`dos_numbering_series_guard`, 0013) refuses a locked series with
   * `restrict_violation`, which comes back as 409 `series_locked`; the owner-only rule is checked
   * here first so the message names the role rather than the trigger.
   */
  async upsertNumbering(input: NumberingUpsertIn): Promise<{ item: NumberingSeries }> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const fy = input.fy ?? financialYear()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [existing] = await tx
          .select()
          .from(numberingSeries)
          .where(
            and(
              eq(numberingSeries.tenantId, ctx.tenantId),
              eq(numberingSeries.seriesCode, input.seriesCode),
              eq(numberingSeries.fy, fy),
            ),
          )
          .for('update')
        const after = {
          prefix: input.prefix,
          startingNo: input.startingNo,
          allocationMode: input.allocationMode,
        }
        let row: NumberingRow | undefined
        if (!existing) {
          ;[row] = await tx
            .insert(numberingSeries)
            .values({ tenantId: ctx.tenantId, seriesCode: input.seriesCode, fy, ...after })
            .returning()
        } else {
          if (existing.nextNo > 1)
            throw new ORPCError('CONFLICT', {
              message: `series ${input.seriesCode}/${fy} has issued documents (next ${String(existing.nextNo)}); its prefix, starting number and allocation mode are locked — configure a new series instead`,
              data: { code: 'series_locked', seriesCode: input.seriesCode, fy },
            })
          try {
            ;[row] = await tx
              .update(numberingSeries)
              .set({ ...after, updatedAt: new Date() })
              .where(
                and(
                  eq(numberingSeries.tenantId, ctx.tenantId),
                  eq(numberingSeries.seriesCode, input.seriesCode),
                  eq(numberingSeries.fy, fy),
                ),
              )
              .returning()
          } catch (error) {
            if (isRestrictViolation(error))
              throw new ORPCError('CONFLICT', {
                message: pgMessage(error),
                data: { code: 'series_locked', seriesCode: input.seriesCode, fy },
              })
            throw error
          }
        }
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'series upsert returned nothing',
          })
        await writeAudit(tx, {
          action: 'numbering.upsert',
          entityType: 'numbering_series',
          entityId: `${input.seriesCode}/${fy}`,
          before: existing
            ? {
                prefix: existing.prefix,
                startingNo: existing.startingNo,
                allocationMode: existing.allocationMode,
              }
            : null,
          after,
        })
        return { item: toSeries(row) }
      }),
    )
  }

  // -------------------------------------------------------------------------------------------------------------
  // feature flags

  /** Every member: an app that hides a feature behind a flag has to know it. Unseeded flags read false. */
  async listFlags(): Promise<FeatureFlagsList> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) => this.readFlags(tx))
  }

  /** Owner only; one `audit_log` row per flag that actually changed. */
  async setFlags(input: FeatureFlagsSetIn): Promise<FeatureFlagsList> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const before = new Map((await this.readFlags(tx)).items.map((f) => [f.flag, f.enabled]))
        const now = new Date()
        for (const item of input.items) {
          await tx
            .insert(featureFlags)
            .values({ tenantId: ctx.tenantId, flag: item.flag, enabled: item.enabled })
            .onConflictDoUpdate({
              target: [featureFlags.tenantId, featureFlags.flag],
              set: { enabled: item.enabled, updatedAt: now },
            })
          if (before.get(item.flag) !== item.enabled)
            await writeAudit(tx, {
              action: 'feature_flag.set',
              entityType: 'feature_flag',
              entityId: item.flag,
              before: { enabled: before.get(item.flag) ?? false },
              after: { enabled: item.enabled },
            })
        }
        return this.readFlags(tx)
      }),
    )
  }

  private async readFlags(tx: Db): Promise<FeatureFlagsList> {
    const ctx = currentTenant()
    const rows = await tx
      .select({ flag: featureFlags.flag, enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(eq(featureFlags.tenantId, ctx.tenantId))
    const known = new Map<string, boolean>(DEFAULT_FLAGS.map((f) => [f.flag, false]))
    for (const row of rows) known.set(row.flag, row.enabled)
    return {
      items: DEFAULT_FLAGS.map((f) => ({ flag: f.flag, enabled: known.get(f.flag) ?? false })),
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // the tenant's legal identity

  async updateTenant(input: TenantUpdateIn): Promise<TenantUpdateOut> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [before] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId))
        if (!before) throw new ORPCError('NOT_FOUND', { message: 'tenant not found' })
        const after = {
          legalName: input.legalName,
          gstin: input.gstin === undefined ? before.gstin : input.gstin,
          stateCode: input.stateCode,
        }
        const [row] = await tx
          .update(tenants)
          .set({ ...after, updatedAt: new Date() })
          .where(eq(tenants.id, ctx.tenantId))
          .returning()
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'tenant update returned nothing',
          })
        await writeAudit(tx, {
          action: 'tenant.update',
          entityType: 'tenant',
          entityId: ctx.tenantId,
          before: { legalName: before.legalName, gstin: before.gstin, stateCode: before.stateCode },
          after,
        })
        return {
          item: {
            id: row.id,
            slug: row.slug,
            legalName: row.legalName,
            gstin: row.gstin,
            stateCode: row.stateCode,
            plan: row.plan,
            status: row.status,
          },
        }
      }),
    )
  }

  // -------------------------------------------------------------------------------------------------------------
  // audit trail

  /** Newest first, cursor on the (time-ordered) row id; the window defaults to 30 IST days, max 92. */
  async listAudit(input: AuditListIn): Promise<AuditList> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const today = new Date()
    const to = input.to ?? istDate(today)
    const from =
      input.from ??
      istDate(new Date(istStart(to).getTime() - (AUDIT_DEFAULT_DAYS - 1) * 86_400_000))
    if (istEnd(to).getTime() - istStart(from).getTime() > AUDIT_MAX_DAYS * 86_400_000)
      throw new ORPCError('BAD_REQUEST', {
        message: `the audit window is capped at ${String(AUDIT_MAX_DAYS)} days`,
        data: { code: 'window_too_wide' },
      })
    const cursor = decodeAuditCursor(input.cursor)
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(auditLog.tenantId, ctx.tenantId),
        gte(auditLog.occurredAt, istStart(from)),
        lte(auditLog.occurredAt, istEnd(to)),
        input.entityType ? eq(auditLog.entityType, input.entityType) : undefined,
        input.entityId ? eq(auditLog.entityId, input.entityId) : undefined,
        input.actorId ? eq(auditLog.actorId, input.actorId) : undefined,
        input.action ? eq(auditLog.action, input.action) : undefined,
        cursor
          ? sql`(${auditLog.occurredAt}, ${auditLog.id}) < (${cursor.at}, ${cursor.id})`
          : undefined,
      ]
      const rows = await tx
        .select()
        .from(auditLog)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const last = page[page.length - 1]
      return {
        items: page.map((r) => ({
          id: r.id,
          actorId: r.actorId,
          actorRole: r.actorRole,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          before: (r.before as Record<string, unknown> | null) ?? null,
          after: (r.after as Record<string, unknown> | null) ?? null,
          deviceId: r.deviceId,
          occurredAt: r.occurredAt.toISOString(),
        })),
        nextCursor:
          rows.length > input.limit && last ? `${last.occurredAt.toISOString()}|${last.id}` : null,
      }
    })
  }
}

/** `<occurredAt ISO>|<id>` — the keyset cursor of `audit.list` (rows are ordered by time, not by id). */
function decodeAuditCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null
  const i = cursor.indexOf('|')
  const at = new Date(cursor.slice(0, i))
  if (i <= 0 || Number.isNaN(at.getTime()))
    throw new ORPCError('BAD_REQUEST', { message: 'cursor is not one this endpoint issued' })
  return { at, id: cursor.slice(i + 1) }
}

function toSeries(row: NumberingRow): NumberingSeries {
  const locked = row.nextNo > 1
  return {
    seriesCode: row.seriesCode,
    fy: row.fy,
    prefix: row.prefix,
    startingNo: row.startingNo,
    nextNo: Math.max(row.nextNo, row.startingNo),
    allocationMode: row.allocationMode,
    lockedAfterFirstIssue: locked,
  }
}

/** `YYYY-MM-DD` of an instant in IST. */
function istDate(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10)
}

/** The seeded codes, so the owner app can offer them before a row exists. */
export const KNOWN_SERIES_CODES: readonly string[] = NUMBERING_SERIES.map((s) => s.seriesCode)
