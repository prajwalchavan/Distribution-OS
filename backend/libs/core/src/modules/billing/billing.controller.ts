import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { CreditNotesService } from './credit-notes.service.js'
import { BillingService } from './invoices.service.js'
import { RegistersService } from './registers.service.js'

/**
 * Contract-first oRPC (docs/16 §3). Every method takes `@OwnsReply() _reply: unknown`: oRPC writes the
 * Fastify reply itself, and without the parameter Nest replies a second time.
 */
@Controller()
@UseGuards(TenantGuard)
export class BillingController {
  constructor(
    private readonly invoices: BillingService,
    private readonly creditNotes: CreditNotesService,
    private readonly registers: RegistersService,
  ) {}

  @Implement(contract.billing.invoices.queue)
  queue(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.invoices.queue).handler(({ input }) =>
      this.invoices.queue(input),
    )
  }

  /** TEMPORARY: removed when `warehouse.packs.confirm` takes issuing over (coordination §4 step 3). */
  @Implement(contract.billing.invoices.issue)
  issue(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.invoices.issue).handler(({ input }) =>
      this.invoices.issue(input),
    )
  }

  @Implement(contract.billing.invoices.issueVanSale)
  issueVanSale(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.invoices.issueVanSale).handler(({ input }) =>
      this.invoices.issueVanSale(input),
    )
  }

  @Implement(contract.billing.invoices.importBrandDms)
  importBrandDms(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.invoices.importBrandDms).handler(({ input }) =>
      this.invoices.importBrandDmsInvoice(input),
    )
  }

  @Implement(contract.billing.invoices.cancel)
  cancelInvoice(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.invoices.cancel).handler(({ input }) =>
      this.invoices.cancel(input),
    )
  }

  @Implement(contract.billing.invoices.get)
  getInvoice(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.invoices.get).handler(({ input }) => this.invoices.get(input))
  }

  @Implement(contract.billing.invoices.list)
  listInvoices(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.invoices.list).handler(({ input }) =>
      this.invoices.list(input),
    )
  }

  @Implement(contract.billing.invoices.upiQr)
  upiQr(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.invoices.upiQr).handler(({ input }) =>
      this.invoices.upiQr(input),
    )
  }

  @Implement(contract.billing.invoices.pdf)
  invoicePdf(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.invoices.pdf).handler(({ input }) => this.invoices.pdf(input))
  }

  @Implement(contract.billing.invoices.setEwayBill)
  setEwayBill(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.invoices.setEwayBill).handler(({ input }) =>
      this.invoices.setEwayBill(input),
    )
  }

  @Implement(contract.billing.invoices.requestIrn)
  requestIrn(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.invoices.requestIrn).handler(({ input }) =>
      this.invoices.requestIrn(input),
    )
  }

  @Implement(contract.billing.creditNotes.create)
  createCreditNote(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.creditNotes.create).handler(({ input }) =>
      this.creditNotes.create(input),
    )
  }

  @Implement(contract.billing.creditNotes.issue)
  issueCreditNote(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.creditNotes.issue).handler(({ input }) =>
      this.creditNotes.issue(input),
    )
  }

  @Implement(contract.billing.creditNotes.cancel)
  cancelCreditNote(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.creditNotes.cancel).handler(({ input }) =>
      this.creditNotes.cancel(input),
    )
  }

  @Implement(contract.billing.creditNotes.get)
  getCreditNote(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.creditNotes.get).handler(({ input }) =>
      this.creditNotes.get(input),
    )
  }

  @Implement(contract.billing.creditNotes.list)
  listCreditNotes(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.creditNotes.list).handler(({ input }) =>
      this.creditNotes.list(input),
    )
  }

  @Implement(contract.billing.registers.gstSummary)
  gstSummary(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.registers.gstSummary).handler(({ input }) =>
      this.registers.gstSummary(input),
    )
  }

  @Implement(contract.billing.registers.salesRegister)
  salesRegister(@OwnsReply() _reply: unknown) {
    return implement(contract.billing.registers.salesRegister).handler(({ input }) =>
      this.registers.salesRegister(input),
    )
  }
}
