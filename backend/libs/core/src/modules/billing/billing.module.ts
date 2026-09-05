import { Module } from '@nestjs/common'
import { InventoryModule } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { ReceivablesModule } from '../receivables/index.js'
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
 * No sync handlers: an invoice is never drafted on a device. The delivery crew's offline path is the
 * ORDER and the RECEIPT, which `modules/orders` and `modules/receivables` already register; a van sale
 * becomes a bill only when the device is back online and `issueFromLocation` can take a real number
 * from the tenant's series (docs/17 §D5 removed device-allocated numbering).
 */
@Module({
  imports: [TenancyModule, OrdersModule, InventoryModule, ReceivablesModule],
  controllers: [BillingController],
  providers: [BillingService, CreditNotesService, RegistersService],
  exports: [BillingService, CreditNotesService, RegistersService],
})
export class BillingModule {}
