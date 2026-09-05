import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, gt, ilike, lt, or, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  TallyMapping,
  TallyMappingsListInput,
  TallyMappingsListOutput,
  TallySyncLedgerListInput,
  TallySyncLedgerListOutput,
  UpsertTallyMappingInput,
  UpsertTallyMappingOutput,
} from '@dos/contracts'
import { tallyMappings, tallySyncLedger, withTenant, type Db } from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  MONEY_DESK,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { InventoryService } from '../inventory/index.js'
import { RetailersService } from '../retailers/index.js'
import { TenantCatalogService } from '../tenant-catalog/index.js'
import { toSyncEntry, toTallyMapping } from './integrations.mappers.js'

type MappingsIn = z.infer<typeof TallyMappingsListInput>
type MappingsOut = z.infer<typeof TallyMappingsListOutput>
type UpsertIn = z.infer<typeof UpsertTallyMappingInput>
type UpsertOut = z.infer<typeof UpsertTallyMappingOutput>
type LedgerIn = z.infer<typeof TallySyncLedgerListInput>
type LedgerOut = z.infer<typeof TallySyncLedgerListOutput>

type MappingRecord = typeof tallyMappings.$inferSelect

/** The voucher-type keys the export looks up; the value is the CA's name for it. */
const VOUCHER_TYPE_LABELS: Record<string, string> = {
  sales: 'Sales vouchers',
  receipts: 'Receipt vouchers',
  purchases: 'Purchase vouchers',
  credit_note: 'Credit-note vouchers',
}

/**
 * How our entities are named in the CA's TallyPrime (`tally_mappings`) and which documents an export
 * already pushed (`tally_sync_ledger`). `entityLabel` is resolved per entity type through the owning
 * module's service so the CA never reads a bare id: a variant's name, a location's name, the unit code,
 * the voucher-type key, a party's name.
 */
@Injectable()
export class TallyService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly retailers: RetailersService,
    private readonly tenantCatalog: TenantCatalogService,
    private readonly inventory: InventoryService,
  ) {}

  async listMappings(input: MappingsIn): Promise<MappingsOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(tallyMappings.tenantId, ctx.tenantId),
        input.entityType ? eq(tallyMappings.entityType, input.entityType) : undefined,
        input.q
          ? or(
              ilike(tallyMappings.tallyName, `%${input.q.replace(/[%_]/g, '')}%`),
              ilike(tallyMappings.entityId, `%${input.q.replace(/[%_]/g, '')}%`),
            )
          : undefined,
        input.cursor ? gt(tallyMappings.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(tallyMappings)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(tallyMappings.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const labels = await this.labels(tx, page)
      const items = page.map((r) => toTallyMapping(r, labels.get(r.id) ?? r.entityId))
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async upsertMapping(input: UpsertIn): Promise<UpsertOut> {
    requireRole(MONEY_DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [existing] = await tx
          .select()
          .from(tallyMappings)
          .where(
            and(
              eq(tallyMappings.tenantId, ctx.tenantId),
              eq(tallyMappings.entityType, input.entityType),
              eq(tallyMappings.entityId, input.entityId),
            ),
          )
          .limit(1)
        if (!existing) {
          const [clash] = await tx
            .select({ entityType: tallyMappings.entityType, entityId: tallyMappings.entityId })
            .from(tallyMappings)
            .where(and(eq(tallyMappings.tenantId, ctx.tenantId), eq(tallyMappings.id, input.id)))
            .limit(1)
          if (clash)
            throw new ORPCError('CONFLICT', {
              message: `id ${input.id} already names the mapping of ${clash.entityType} ${clash.entityId}; use a new id`,
            })
        }
        const [row] = existing
          ? await tx
              .update(tallyMappings)
              .set({
                tallyName: input.tallyName,
                tallyParent: input.tallyParent ?? null,
                updatedAt: new Date(),
              })
              .where(eq(tallyMappings.id, existing.id))
              .returning()
          : await tx
              .insert(tallyMappings)
              .values({
                id: input.id,
                tenantId: ctx.tenantId,
                entityType: input.entityType,
                entityId: input.entityId,
                tallyName: input.tallyName,
                tallyParent: input.tallyParent ?? null,
              })
              .returning()
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'tally mapping upsert failed' })
        const labels = await this.labels(tx, [row])
        return { item: toTallyMapping(row, labels.get(row.id) ?? row.entityId) }
      }),
    )
  }

  async listSyncLedger(input: LedgerIn): Promise<LedgerOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(tallySyncLedger.tenantId, ctx.tenantId),
        input.docType ? eq(tallySyncLedger.docType, input.docType) : undefined,
        input.exportJobId ? eq(tallySyncLedger.exportJobId, input.exportJobId) : undefined,
        input.from ? sql`${tallySyncLedger.exportedAt} >= ${istStart(input.from)}` : undefined,
        input.to ? sql`${tallySyncLedger.exportedAt} < ${istStart(input.to, 1)}` : undefined,
        input.cursor ? lt(tallySyncLedger.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(tallySyncLedger)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(tallySyncLedger.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toSyncEntry)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  /** One query per entity type present on the page: never one per row. */
  private async labels(tx: Db, rows: readonly MappingRecord[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const by = (type: string): MappingRecord[] => rows.filter((r) => r.entityType === type)
    const variants = by('stock_item')
    if (variants.length > 0) {
      const names = await this.tenantCatalog.variantLabels(
        tx,
        variants.map((r) => r.entityId),
      )
      for (const r of variants) out.set(r.id, names.get(r.entityId) ?? r.entityId)
    }
    const godowns = by('godown')
    if (godowns.length > 0) {
      const names = await this.inventory.locationNames(
        tx,
        godowns.map((r) => r.entityId),
      )
      for (const r of godowns) out.set(r.id, names.get(r.entityId) ?? r.entityId)
    }
    const parties = by('party')
    if (parties.length > 0) {
      const names = await this.retailers.labels(
        tx,
        parties.map((r) => r.entityId),
      )
      const suppliers = await this.tenantCatalog.supplierLabels(
        tx,
        parties.filter((r) => !names.has(r.entityId)).map((r) => r.entityId),
      )
      for (const r of parties)
        out.set(r.id, names.get(r.entityId)?.name ?? suppliers.get(r.entityId)?.name ?? r.entityId)
    }
    for (const r of by('voucher_type')) out.set(r.id, VOUCHER_TYPE_LABELS[r.entityId] ?? r.entityId)
    for (const r of by('unit')) out.set(r.id, r.entityId)
    for (const r of by('ledger')) out.set(r.id, r.entityId)
    return out
  }
}

export type { TallyMapping }

function istStart(isoDate: string, plusDays = 0): Date {
  const at = Date.parse(`${isoDate}T00:00:00.000+05:30`)
  return new Date(at + plusDays * 86_400_000)
}
