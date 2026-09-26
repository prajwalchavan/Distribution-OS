import { Module } from '@nestjs/common'
import { InventoryModule } from '../inventory/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { GrnService } from './grn.service.js'
import { ProcurementController } from './procurement.controller.js'
import { SupplierInvoiceService } from './supplier-invoice.service.js'

/**
 * Supplier invoices (reviewed extractions or typed), GRN gate counts and posting, purchase orders.
 * Stock moves only through InventoryService; purchase cost is written to tenant_product_costs (back-office RLS);
 * the purchase journal (AP, Purchases, input tax) goes through ReceivablesService, the only writer of the
 * book (QA DOS-221).
 */
@Module({
  imports: [TenancyModule, InventoryModule, ReceivablesModule],
  controllers: [ProcurementController],
  providers: [SupplierInvoiceService, GrnService],
  exports: [SupplierInvoiceService, GrnService],
})
export class ProcurementModule {}
