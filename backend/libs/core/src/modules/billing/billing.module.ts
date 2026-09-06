import { Inject, Module, Optional, type OnModuleInit } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { creditNoteLines, creditNotes, invoiceLines, invoices } from '@dos/db'
import { InventoryModule } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { SyncRegistry, tablePull } from '../sync/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { BillingController } from './billing.controller.js'
import { CreditNotesService } from './credit-notes.service.js'
import { BillingService } from './invoices.service.js'
import { RegistersService } from './registers.service.js'

/**
 * Billing: the tax invoice, the credit note and the registers. It owns `invoices`, `invoice_lines`,
 * `credit_notes` and `credit_note_lines`, and reaches everything else through a module's `index.ts`:
 * `OrdersService` for the aggregate, `InventoryService` for every piece, `ReceivablesService` for every
 * rupee (coordination §4 — billing → receivables is the ONLY edge between the two; receivables writes
 * the derived `invoices.state` directly under §3.2, so there is no import back).
 *
 * No UPLOAD handlers: an invoice is never drafted on a device. The delivery crew's offline path is the
 * ORDER and the RECEIPT, which `modules/orders` and `modules/receivables` already register; a van sale
 * becomes a bill only when the device is back online and `issueFromLocation` can take a real number
 * from the tenant's series (docs/17 §D5 removed device-allocated numbering). Every one of the four
 * tables is therefore `writable: false` in the manifest — download-only, like prices and the catalogue.
 *
 * The PULL side is the opposite: the crew must be able to show the bill at a door with no signal, the
 * rep must see what a shop already owes, and the shop's own app is offline-capable for its own bills.
 * So all four travel, scoped three ways at once — the module's predicate (a field device carries 90
 * days, a rep only the shops of its own beats), RLS (`tenantOrOwnRetailerPolicy` narrows a shopkeeper
 * to its own rows before this code runs), and the columns themselves: an invoice line carries the
 * SELLING rate and the tax, never a buying price, which is a database guarantee (migration 0040's
 * assertion refuses any pull-able table a cost column) and not a promise made here.
 */
@Module({
  imports: [TenancyModule, OrdersModule, InventoryModule, ReceivablesModule],
  controllers: [BillingController],
  providers: [BillingService, CreditNotesService, RegistersService],
  exports: [BillingService, CreditNotesService, RegistersService],
})
export class BillingModule implements OnModuleInit {
  constructor(@Optional() @Inject(SyncRegistry) private readonly registry: SyncRegistry | null) {}

  onModuleInit(): void {
    if (!this.registry) return
    // Bounded by date for the field roles (docs/20: bounded work per request); the desk pulls the lot.
    const recent = sql`created_at > now() - interval '90 days'`
    const ownBeatShops = (r: { ctx: { tenantId: string; actorId: string } }) =>
      sql`retailer_id in (
        select x.id from retailers x
         where x.tenant_id = ${r.ctx.tenantId}
           and x.beat_id in (select a.beat_id from beat_assignments a
                              where a.tenant_id = ${r.ctx.tenantId} and a.user_id = ${r.ctx.actorId}
                                and a.valid_from <= current_date
                                and (a.valid_to is null or a.valid_to >= current_date)))`
    const headerScope = (r: { ctx: { tenantId: string; actorId: string; actorRole: string } }) =>
      r.ctx.actorRole === 'salesperson'
        ? sql`${recent} and ${ownBeatShops(r)}`
        : r.ctx.actorRole === 'delivery' || r.ctx.actorRole === 'retailer'
          ? recent
          : undefined
    // A line follows its header exactly: same predicate, evaluated against the header row inside the
    // subquery (an unqualified `retailer_id` there is the HEADER's). Without this a rep would read
    // the lines of a shop it may not see — RLS on `invoice_lines` scopes to readable invoices, and
    // every tenant invoice is readable by staff.
    const linesOf = (
      header: string,
      column: string,
      r: { ctx: { tenantId: string; actorId: string; actorRole: string } },
    ) => {
      const scope = headerScope(r)
      return scope
        ? sql`${sql.identifier(column)} in (select h.id from ${sql.identifier(header)} h
             where h.tenant_id = ${r.ctx.tenantId} and (${scope}))`
        : undefined
    }
    this.registry.registerPull('invoices', tablePull(invoices, { extra: headerScope }))
    this.registry.registerPull(
      'invoice_lines',
      tablePull(invoiceLines, { extra: (r) => linesOf('invoices', 'invoice_id', r) }),
    )
    this.registry.registerPull('credit_notes', tablePull(creditNotes, { extra: headerScope }))
    this.registry.registerPull(
      'credit_note_lines',
      tablePull(creditNoteLines, { extra: (r) => linesOf('credit_notes', 'credit_note_id', r) }),
    )
  }
}
