import type { Db } from '@dos/db'
import { InventoryService } from '../inventory/index.js'
import { OrdersService } from '../orders/index.js'
import { QuoteService } from '../pricing/index.js'
import { ReceivablesService } from '../receivables/index.js'
import { CreditNotesService } from './credit-notes.service.js'
import { BillingService } from './invoices.service.js'
import { RegistersService } from './registers.service.js'

/**
 * The billing stack for a process WITHOUT Nest DI — the pg-boss worker (coordination §3.9: "anything
 * the worker calls is a plain exported function"; tsx emits no `design:paramtypes`, so a Nest
 * container there would inject `undefined`). The integrations commit run and the export renderers
 * need `BillingService.recordOpeningInvoice / importBrandDms / cancelImported` and
 * `RegistersService`, which are instance methods with constructor-injected collaborators; this
 * factory wires the same graph the `BillingModule` provider list describes, by hand and type-checked:
 * a changed constructor fails the build here rather than the worker at runtime.
 *
 * Every service here is stateless — a bag of transaction-scoped methods over the `Db` handed in
 * (used only by the procedure-level methods that open their own `withTenant`) — so one stack per
 * process is enough, and `currentTenant()` inside them reads whatever `tenantStorage.run` set.
 */
export interface BillingStack {
  receivables: ReceivablesService
  inventory: InventoryService
  orders: OrdersService
  billing: BillingService
  creditNotes: CreditNotesService
  registers: RegistersService
}

export function createBillingStack(db: Db | null): BillingStack {
  const receivables = new ReceivablesService(db)
  const inventory = new InventoryService()
  const orders = new OrdersService(db, new QuoteService(db), inventory)
  const billing = new BillingService(db, orders, inventory, receivables)
  const creditNotes = new CreditNotesService(db, orders, inventory, receivables)
  const registers = new RegistersService(db)
  return { receivables, inventory, orders, billing, creditNotes, registers }
}
