import { Module } from '@nestjs/common'
import { InventoryModule } from '../inventory/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { GrnService } from './grn.service.js'
import { ProcurementController } from './procurement.controller.js'
import { SupplierInvoiceService } from './supplier-invoice.service.js'

/**
 * Supplier invoices (reviewed extractions or typed), GRN gate counts and posting, purchase orders.
 * Stock moves only through InventoryService; purchase cost is written to tenant_product_costs (back-office RLS).
 */
@Module({
  imports: [TenancyModule, InventoryModule],
  controllers: [ProcurementController],
  providers: [SupplierInvoiceService, GrnService],
  exports: [SupplierInvoiceService, GrnService],
})
export class ProcurementModule {}
