import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { ReportExportsService } from './exports.service.js'
import { ReportingRegistersService } from './registers.service.js'
import { ReportingService } from './reporting.service.js'

/** Every reporting procedure, one line each: role and window checks live in the services. */
@Controller()
@UseGuards(TenantGuard)
export class ReportingController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly registers: ReportingRegistersService,
    private readonly exports: ReportExportsService,
  ) {}

  @Implement(contract.reporting.dashboard.owner)
  dashboardOwner(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.dashboard.owner).handler(() =>
      this.reporting.dashboardOwner(),
    )
  }

  @Implement(contract.reporting.dashboard.rep)
  dashboardRep(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.dashboard.rep).handler(({ input }) =>
      this.reporting.dashboardRep(input),
    )
  }

  @Implement(contract.reporting.series.get)
  seriesGet(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.get).handler(({ input }) =>
      this.reporting.seriesGet(input),
    )
  }

  @Implement(contract.reporting.series.sales)
  seriesSales(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.sales).handler(({ input }) =>
      this.reporting.seriesSales(input),
    )
  }

  @Implement(contract.reporting.series.collections)
  seriesCollections(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.collections).handler(({ input }) =>
      this.reporting.seriesCollections(input),
    )
  }

  @Implement(contract.reporting.series.outstanding)
  seriesOutstanding(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.outstanding).handler(({ input }) =>
      this.reporting.seriesOutstanding(input),
    )
  }

  @Implement(contract.reporting.series.ageing)
  seriesAgeing(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.ageing).handler(({ input }) =>
      this.reporting.seriesAgeing(input),
    )
  }

  @Implement(contract.reporting.series.growth)
  seriesGrowth(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.growth).handler(({ input }) =>
      this.reporting.seriesGrowth(input),
    )
  }

  @Implement(contract.reporting.series.brandMix)
  seriesBrandMix(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.brandMix).handler(({ input }) =>
      this.reporting.seriesBrandMix(input),
    )
  }

  @Implement(contract.reporting.series.categoryMix)
  seriesCategoryMix(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.categoryMix).handler(({ input }) =>
      this.reporting.seriesCategoryMix(input),
    )
  }

  @Implement(contract.reporting.series.topShops)
  seriesTopShops(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.topShops).handler(({ input }) =>
      this.reporting.seriesTopShops(input),
    )
  }

  @Implement(contract.reporting.series.topBeats)
  seriesTopBeats(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.topBeats).handler(({ input }) =>
      this.reporting.seriesTopBeats(input),
    )
  }

  @Implement(contract.reporting.series.productivity)
  seriesProductivity(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.productivity).handler(({ input }) =>
      this.reporting.seriesProductivity(input),
    )
  }

  @Implement(contract.reporting.series.fillRate)
  seriesFillRate(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.fillRate).handler(({ input }) =>
      this.reporting.seriesFillRate(input),
    )
  }

  @Implement(contract.reporting.series.deliveryPerformance)
  seriesDeliveryPerformance(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.deliveryPerformance).handler(({ input }) =>
      this.reporting.seriesDeliveryPerformance(input),
    )
  }

  @Implement(contract.reporting.series.stock)
  seriesStock(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.stock).handler(({ input }) =>
      this.reporting.seriesStock(input),
    )
  }

  @Implement(contract.reporting.series.grossMargin)
  seriesGrossMargin(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.grossMargin).handler(({ input }) =>
      this.reporting.seriesGrossMargin(input),
    )
  }

  @Implement(contract.reporting.series.schemeSpend)
  seriesSchemeSpend(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.series.schemeSpend).handler(({ input }) =>
      this.reporting.seriesSchemeSpend(input),
    )
  }

  @Implement(contract.reporting.dailyStats.tenant)
  dailyStatsTenant(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.dailyStats.tenant).handler(({ input }) =>
      this.reporting.dailyStatsTenant(input),
    )
  }

  @Implement(contract.reporting.dailyStats.rep)
  dailyStatsRep(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.dailyStats.rep).handler(({ input }) =>
      this.reporting.dailyStatsRep(input),
    )
  }

  @Implement(contract.reporting.retailers.behaviour)
  retailerBehaviour(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.retailers.behaviour).handler(({ input }) =>
      this.reporting.retailerBehaviour(input),
    )
  }

  @Implement(contract.reporting.retailers.series)
  retailerSeries(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.retailers.series).handler(({ input }) =>
      this.reporting.retailerSeries(input),
    )
  }

  @Implement(contract.reporting.retailers.lapsed)
  retailersLapsed(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.retailers.lapsed).handler(({ input }) =>
      this.reporting.retailersLapsed(input),
    )
  }

  @Implement(contract.reporting.registers.repProductivity)
  repProductivity(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.registers.repProductivity).handler(({ input }) =>
      this.registers.repProductivity(input),
    )
  }

  @Implement(contract.reporting.registers.schemeSpend)
  schemeSpend(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.registers.schemeSpend).handler(({ input }) =>
      this.registers.schemeSpend(input),
    )
  }

  @Implement(contract.reporting.registers.stockValue)
  stockValue(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.registers.stockValue).handler(({ input }) =>
      this.registers.stockValue(input),
    )
  }

  @Implement(contract.reporting.registers.fillRate)
  fillRate(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.registers.fillRate).handler(({ input }) =>
      this.registers.fillRate(input),
    )
  }

  @Implement(contract.reporting.registers.deliveryPerformance)
  deliveryPerformance(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.registers.deliveryPerformance).handler(({ input }) =>
      this.registers.deliveryPerformance(input),
    )
  }

  @Implement(contract.reporting.registers.collections)
  collections(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.registers.collections).handler(({ input }) =>
      this.registers.collections(input),
    )
  }

  @Implement(contract.reporting.registers.gstSalesRegister)
  gstSalesRegister(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.registers.gstSalesRegister).handler(({ input }) =>
      this.registers.gstSalesRegister(input),
    )
  }

  @Implement(contract.reporting.registers.gstPurchaseRegister)
  gstPurchaseRegister(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.registers.gstPurchaseRegister).handler(({ input }) =>
      this.registers.gstPurchaseRegister(input),
    )
  }

  @Implement(contract.reporting.exports.request)
  requestExport(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.exports.request).handler(({ input }) =>
      this.exports.request(input),
    )
  }

  @Implement(contract.reporting.exports.get)
  getExport(@OwnsReply() _reply: unknown) {
    return implement(contract.reporting.exports.get).handler(({ input }) => this.exports.get(input))
  }
}
