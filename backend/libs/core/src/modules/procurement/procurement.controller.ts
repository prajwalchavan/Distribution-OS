import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { GrnService } from './grn.service.js'
import { SupplierInvoiceService } from './supplier-invoice.service.js'

@Controller()
@UseGuards(TenantGuard)
export class ProcurementController {
  constructor(
    private readonly invoices: SupplierInvoiceService,
    private readonly grn: GrnService,
  ) {}

  @Implement(contract.procurement.supplierInvoices.create)
  createInvoice(@OwnsReply() _reply: unknown) {
    return implement(contract.procurement.supplierInvoices.create).handler(({ input }) =>
      this.invoices.create(input),
    )
  }

  @Implement(contract.procurement.supplierInvoices.list)
  listInvoices(@OwnsReply() _reply: unknown) {
    return implement(contract.procurement.supplierInvoices.list).handler(({ input }) =>
      this.invoices.list(input),
    )
  }

  @Implement(contract.procurement.supplierInvoices.get)
  getInvoice(@OwnsReply() _reply: unknown) {
    return implement(contract.procurement.supplierInvoices.get).handler(({ input }) =>
      this.invoices.get(input),
    )
  }

  @Implement(contract.procurement.supplierInvoices.matchLine)
  matchLine(@OwnsReply() _reply: unknown) {
    return implement(contract.procurement.supplierInvoices.matchLine).handler(({ input }) =>
      this.invoices.matchLine(input),
    )
  }

  @Implement(contract.procurement.grns.open)
  openGrn(@OwnsReply() _reply: unknown) {
    return implement(contract.procurement.grns.open).handler(({ input }) => this.grn.open(input))
  }

  @Implement(contract.procurement.grns.count)
  countGrn(@OwnsReply() _reply: unknown) {
    return implement(contract.procurement.grns.count).handler(({ input }) => this.grn.count(input))
  }

  @Implement(contract.procurement.grns.post)
  postGrn(@OwnsReply() _reply: unknown) {
    return implement(contract.procurement.grns.post).handler(({ input }) => this.grn.post(input))
  }

  @Implement(contract.procurement.grns.list)
  listGrns(@OwnsReply() _reply: unknown) {
    return implement(contract.procurement.grns.list).handler(({ input }) => this.grn.list(input))
  }

  @Implement(contract.procurement.grns.get)
  getGrn(@OwnsReply() _reply: unknown) {
    return implement(contract.procurement.grns.get).handler(({ input }) => this.grn.get(input))
  }

  @Implement(contract.procurement.discrepancies.list)
  listDiscrepancies(@OwnsReply() _reply: unknown) {
    return implement(contract.procurement.discrepancies.list).handler(({ input }) =>
      this.grn.discrepancies(input),
    )
  }

  @Implement(contract.procurement.purchaseOrders.upsert)
  upsertPurchaseOrder(@OwnsReply() _reply: unknown) {
    return implement(contract.procurement.purchaseOrders.upsert).handler(({ input }) =>
      this.invoices.upsertPurchaseOrder(input),
    )
  }

  @Implement(contract.procurement.purchaseOrders.list)
  listPurchaseOrders(@OwnsReply() _reply: unknown) {
    return implement(contract.procurement.purchaseOrders.list).handler(({ input }) =>
      this.invoices.listPurchaseOrders(input),
    )
  }
}
