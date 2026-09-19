import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { expect } from 'vitest'
import { uuidv7 } from '@dos/domain'
import { call, type Actor } from './app.js'

/** Who counts the load out: the godown that builds and confirms the sheet, and the desk that approves it. */
export interface LoadOutCrew {
  /** A warehouse, manager or owner actor: it builds the sheet and confirms the count. */
  godown: Actor
  /** An owner or manager who approves the sheet first. Leave it out when `godown` is itself the desk. */
  approver?: Actor
}

export interface LoadOutInput {
  tripId: string
  /** Packed orders whose bills ride on the trip; kept in the order given, as the app sends them. */
  orderIds: readonly string[]
  /** Free van stock for van sales, counted as sent. */
  vanStock?: readonly { lotId: string; qtyPcs: number }[]
  /** Twelve digits, for a load that reaches the e-way bill threshold. */
  ewbNo?: string
  /** Unique within the spec's tenant: it names the three idempotency keys. */
  tag: string
}

export interface LoadOutResult {
  sheetId: string
  /** The sheet's status after the count: `confirmed`, the only status that lets its bills leave. */
  status: string
  challanNo: string | null
  /** The orders the confirm moved `packed → dispatched`. */
  dispatched: string[]
}

/**
 * THE LOAD-OUT EVERY SPEC USES BEFORE A TRIP CARRYING A BILL DEPARTS (QA DOS-172): a bill leaves the godown
 * only through a confirmed load sheet, and `delivery.trips.depart` refuses 409 `bill_not_loaded` otherwise.
 *
 * Exactly what the apps do: the trip's vehicle location is read from the trip (as the approver, or the
 * godown when nobody approves), W7 builds the sheet for the trip with its orders, the manager approves it
 * from the manager app when the godown is the warehouse role (an owner or manager confirming directly IS the
 * approval), and W7 confirms with the blind count equal to the expected packages and the van stock as
 * counted. Every step must answer 200; the reply body is in the failure message.
 */
export async function loadOut(
  app: NestFastifyApplication,
  { godown, approver }: LoadOutCrew,
  { tripId, orderIds, vanStock = [], ewbNo, tag }: LoadOutInput,
): Promise<LoadOutResult> {
  const trip = await call<{ item: { vehicleLocationId: string } }>(
    app,
    approver ?? godown,
    'GET',
    `/delivery/trips/${tripId}`,
  )
  expect(trip.status, `load-out ${tag}: read the trip ${JSON.stringify(trip.body)}`).toBe(200)

  const sheetId = uuidv7()
  const created = await call<{ item: { expectedPackages: number } }>(
    app,
    godown,
    'POST',
    '/warehouse/load-sheets',
    {
      idempotencyKey: `load-out-create-${tag}`,
      id: sheetId,
      toLocationId: trip.body.item.vehicleLocationId,
      tripId,
      orderIds: [...orderIds],
      vanStock: vanStock.map((v) => ({ lotId: v.lotId, qtyPcs: v.qtyPcs })),
    },
  )
  expect(created.status, `load-out ${tag}: build the sheet ${JSON.stringify(created.body)}`).toBe(
    200,
  )

  if (approver) {
    const approved = await call(
      app,
      approver,
      'POST',
      `/warehouse/load-sheets/${sheetId}/approve`,
      {
        idempotencyKey: `load-out-approve-${tag}`,
      },
    )
    expect(
      approved.status,
      `load-out ${tag}: approve the sheet ${JSON.stringify(approved.body)}`,
    ).toBe(200)
  }

  const confirmed = await call<{
    item: { challanNo: string | null; status: string }
    dispatched: string[]
  }>(app, godown, 'POST', `/warehouse/load-sheets/${sheetId}/confirm`, {
    idempotencyKey: `load-out-confirm-${tag}`,
    countedPackages: created.body.item.expectedPackages,
    countedVanStock: vanStock.map((v) => ({ lotId: v.lotId, qtyPcs: v.qtyPcs })),
    challanId: uuidv7(),
    ...(ewbNo === undefined ? {} : { ewbNo }),
  })
  expect(
    confirmed.status,
    `load-out ${tag}: confirm the count ${JSON.stringify(confirmed.body)}`,
  ).toBe(200)
  return {
    sheetId,
    status: confirmed.body.item.status,
    challanNo: confirmed.body.item.challanNo,
    dispatched: confirmed.body.dispatched,
  }
}
