import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ConsentGetInput,
  ConsentGetOutput,
  GrantConsentInput,
  GrantConsentOutput,
  UpsertVehicleInput,
  UpsertVehicleOutput,
  VehiclePositionsInput,
  VehiclePositionsOutput,
  VehiclesListInput,
  VehiclesListOutput,
} from '@dos/contracts'
import {
  locationConsents,
  trips,
  tripStops,
  vehiclePositions,
  vehicles,
  withTenant,
  type Db,
} from '@dos/db'
import {
  currentTenant,
  DB,
  idempotent,
  requireDb,
  requireRole,
  writeAudit,
} from '../../platform/index.js'
import { InventoryService } from '../inventory/index.js'
import { DOORSTEP, isUniqueViolation, PIN_HOLDERS, STOCK_VIEWERS } from './delivery.internals.js'
import { toConsent, toVehicle } from './delivery.mappers.js'

type ListIn = z.infer<typeof VehiclesListInput>
type ListOut = z.infer<typeof VehiclesListOutput>
type UpsertIn = z.infer<typeof UpsertVehicleInput>
type UpsertOut = z.infer<typeof UpsertVehicleOutput>
type PositionsIn = z.infer<typeof VehiclePositionsInput>
type PositionsOut = z.infer<typeof VehiclePositionsOutput>
type GrantIn = z.infer<typeof GrantConsentInput>
type GrantOut = z.infer<typeof GrantConsentOutput>
type ConsentIn = z.infer<typeof ConsentGetInput>
type ConsentOut = z.infer<typeof ConsentGetOutput>

/**
 * The fleet and the crew's location consent.
 *
 * A vehicle IS a stock location (ADR 0013): creating one creates its `locations` row through
 * `InventoryService.ensureVehicleLocation`, and NO numbering series — a van sale bills from the
 * tenant's normal series (docs/17 §D5). The live map (`positions`) is a DPDP-audited read: one
 * `audit_log` row per call, owner/manager only (docs/17 A12).
 */
@Injectable()
export class VehiclesService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly inventory: InventoryService,
  ) {}

  async list(input: ListIn): Promise<ListOut> {
    requireRole(STOCK_VIEWERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const rows = await tx
        .select()
        .from(vehicles)
        .where(
          and(
            input.activeOnly ? eq(vehicles.active, true) : undefined,
            input.kind ? eq(vehicles.kind, input.kind) : undefined,
          ),
        )
        .orderBy(asc(vehicles.regNo))
      return { items: rows.map(toVehicle) }
    })
  }

  async upsert(input: UpsertIn): Promise<UpsertOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [existing] = await tx
          .select()
          .from(vehicles)
          .where(eq(vehicles.id, input.id))
          .for('update')
        if (existing) {
          const [updated] = await tx
            .update(vehicles)
            .set({
              regNo: input.regNo,
              name: input.name ?? existing.name,
              kind: input.kind,
              capacityCases: input.capacityCases ?? existing.capacityCases,
              active: input.active,
              updatedAt: new Date(),
            })
            .where(eq(vehicles.id, existing.id))
            .returning()
            .catch((err: unknown) => {
              if (isUniqueViolation(err)) throw regNoTaken(input.regNo)
              throw err
            })
          return { item: toVehicle(updated ?? existing), created: false }
        }
        const [plate] = await tx
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(eq(vehicles.regNo, input.regNo))
          .limit(1)
        if (plate) throw regNoTaken(input.regNo)
        const location = await this.inventory.ensureVehicleLocation(tx, {
          vehicleId: input.id,
          name: `Vehicle ${input.regNo}`,
        })
        try {
          // savepoint: a plate already on the fleet is the caller's mistake, never a server fault,
          // and must not abort the surrounding transaction.
          const [row] = await tx.transaction((sp) =>
            sp
              .insert(vehicles)
              .values({
                id: input.id,
                tenantId: ctx.tenantId,
                regNo: input.regNo,
                name: input.name ?? null,
                kind: input.kind,
                capacityCases: input.capacityCases ?? null,
                locationId: location.id,
                active: input.active,
              })
              .returning(),
          )
          if (!row)
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: 'vehicle insert returned nothing',
            })
          return { item: toVehicle(row), created: true }
        } catch (err) {
          if (isUniqueViolation(err)) throw regNoTaken(input.regNo)
          throw err
        }
      }),
    )
  }

  /** The owner's live map. Every call is audited (`gps.live_map_read`, docs/17 A12). */
  async positions(input: PositionsIn): Promise<PositionsOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const rows = await tx
        .select({
          vehicleId: vehiclePositions.vehicleId,
          regNo: vehicles.regNo,
          tripId: vehiclePositions.tripId,
          lat: vehiclePositions.lat,
          lng: vehiclePositions.lng,
          recordedAt: vehiclePositions.recordedAt,
          updatedAt: vehiclePositions.updatedAt,
        })
        .from(vehiclePositions)
        .innerJoin(vehicles, eq(vehicles.id, vehiclePositions.vehicleId))
        .where(input.vehicleId ? eq(vehiclePositions.vehicleId, input.vehicleId) : undefined)
        .orderBy(asc(vehicles.regNo))
      const tripIds = rows.map((r) => r.tripId).filter((id): id is string => id !== null)
      const tripRows =
        tripIds.length === 0
          ? []
          : await tx
              .select({
                id: trips.id,
                tripNo: trips.tripNo,
                state: trips.state,
                driverId: trips.driverId,
                plannedStops: trips.plannedStops,
              })
              .from(trips)
              .where(inArray(trips.id, tripIds))
      const tripById = new Map(tripRows.map((t) => [t.id, t]))
      const doneRows =
        tripIds.length === 0
          ? []
          : await tx
              .select({
                tripId: tripStops.tripId,
                done: sql<number>`count(*) filter (where ${tripStops.state} in ('delivered', 'partial', 'failed', 'skipped'))`,
                planned: sql<number>`count(*)`,
              })
              .from(tripStops)
              .where(inArray(tripStops.tripId, tripIds))
              .groupBy(tripStops.tripId)
      const doneByTrip = new Map(
        doneRows.map((r) => [r.tripId, { done: Number(r.done), planned: Number(r.planned) }]),
      )
      const staleBefore = Date.now() - input.staleAfterMinutes * 60_000
      await writeAudit(tx, {
        action: 'gps.live_map_read',
        entityType: 'vehicle_positions',
        entityId: input.vehicleId ?? ctx.tenantId,
        after: { vehicles: rows.length, staleAfterMinutes: input.staleAfterMinutes },
      })
      return {
        items: rows.map((r) => {
          const trip = r.tripId ? tripById.get(r.tripId) : undefined
          const counts = r.tripId ? doneByTrip.get(r.tripId) : undefined
          return {
            vehicleId: r.vehicleId,
            regNo: r.regNo,
            tripId: trip?.id ?? null,
            tripNo: trip?.tripNo ?? null,
            tripState: trip?.state ?? null,
            driverId: trip?.driverId ?? null,
            lat: r.lat,
            lng: r.lng,
            recordedAt: r.recordedAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
            stale: r.recordedAt.getTime() < staleBefore,
            stopsDone: counts?.done ?? 0,
            stopsPlanned: counts?.planned ?? trip?.plannedStops ?? 0,
          }
        }),
      }
    })
  }

  // -------------------------------------------------------------------------------------------------------------
  // consents (DPDP)

  /** Always the CALLER's own row: nobody consents on someone else's behalf. `granted: false` records a refusal. */
  async grantConsent(input: GrantIn): Promise<GrantOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [existing] = await tx
          .select()
          .from(locationConsents)
          .where(eq(locationConsents.id, input.id))
          .limit(1)
        if (existing) return { item: toConsent(existing) }
        const now = new Date()
        // An earlier answer of the same person is closed, so "current consent" is always one row.
        await tx
          .update(locationConsents)
          .set({ withdrawnAt: now })
          .where(
            and(
              eq(locationConsents.tenantId, ctx.tenantId),
              eq(locationConsents.userId, ctx.actorId),
              sql`${locationConsents.withdrawnAt} is null`,
            ),
          )
        const [row] = await tx
          .insert(locationConsents)
          .values({
            id: input.id,
            userId: ctx.actorId,
            tenantId: ctx.tenantId,
            policyVersion: input.noticeVersion,
            locale: input.locale,
            granted: input.granted,
            grantedAt: now,
            evidence: { deviceId: input.deviceId ?? null, app: 'delivery' },
          })
          .returning()
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'consent insert returned nothing',
          })
        return { item: toConsent(row) }
      }),
    )
  }

  /** The caller's own current answer, or a driver's for the desk planning a trip (RLS: owner/manager). */
  async getConsent(input: ConsentIn): Promise<ConsentOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const userId = input.userId ?? ctx.actorId
    if (userId !== ctx.actorId && ctx.actorRole === 'delivery')
      throw new ORPCError('FORBIDDEN', { message: 'a crew member reads only its own consent' })
    return withTenant(db, ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(locationConsents)
        .where(
          and(eq(locationConsents.tenantId, ctx.tenantId), eq(locationConsents.userId, userId)),
        )
        .orderBy(desc(locationConsents.grantedAt), desc(locationConsents.id))
        .limit(1)
      return { item: row ? toConsent(row) : null }
    })
  }
}

function regNoTaken(regNo: string): ORPCError<'CONFLICT', undefined> {
  return new ORPCError('CONFLICT', {
    message: `a vehicle with registration ${regNo} already exists`,
  })
}
