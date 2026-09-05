import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { ExportJobsService } from './export-jobs.service.js'
import { IntegrationsService } from './integrations.service.js'
import { TallyService } from './tally.service.js'

@Controller()
@UseGuards(TenantGuard)
export class IntegrationsController {
  constructor(
    private readonly imports: IntegrationsService,
    private readonly exports: ExportJobsService,
    private readonly tally: TallyService,
  ) {}

  // imports

  @Implement(contract.integrations.imports.create)
  createImport(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.imports.create).handler(({ input }) =>
      this.imports.create(input),
    )
  }

  @Implement(contract.integrations.imports.list)
  listImports(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.imports.list).handler(({ input }) =>
      this.imports.list(input),
    )
  }

  @Implement(contract.integrations.imports.get)
  getImport(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.imports.get).handler(({ input }) =>
      this.imports.get(input),
    )
  }

  @Implement(contract.integrations.imports.preview)
  previewImport(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.imports.preview).handler(({ input }) =>
      this.imports.preview(input),
    )
  }

  @Implement(contract.integrations.imports.setMapping)
  setMapping(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.imports.setMapping).handler(({ input }) =>
      this.imports.setMapping(input),
    )
  }

  @Implement(contract.integrations.imports.dryRun)
  dryRun(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.imports.dryRun).handler(({ input }) =>
      this.imports.dryRun(input),
    )
  }

  @Implement(contract.integrations.imports.rows.list)
  listRows(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.imports.rows.list).handler(({ input }) =>
      this.imports.listRows(input),
    )
  }

  @Implement(contract.integrations.imports.rows.review)
  reviewRow(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.imports.rows.review).handler(({ input }) =>
      this.imports.reviewRow(input),
    )
  }

  @Implement(contract.integrations.imports.commit)
  commitImport(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.imports.commit).handler(({ input }) =>
      this.imports.commit(input),
    )
  }

  @Implement(contract.integrations.imports.confirm)
  confirmImport(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.imports.confirm).handler(({ input }) =>
      this.imports.confirm(input),
    )
  }

  @Implement(contract.integrations.imports.rollback)
  rollbackImport(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.imports.rollback).handler(({ input }) =>
      this.imports.rollback(input),
    )
  }

  @Implement(contract.integrations.imports.cancel)
  cancelImport(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.imports.cancel).handler(({ input }) =>
      this.imports.cancel(input),
    )
  }

  // profiles

  @Implement(contract.integrations.profiles.list)
  listProfiles(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.profiles.list).handler(({ input }) =>
      this.imports.listProfiles(input),
    )
  }

  @Implement(contract.integrations.profiles.upsert)
  upsertProfile(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.profiles.upsert).handler(({ input }) =>
      this.imports.upsertProfile(input),
    )
  }

  // exports

  @Implement(contract.integrations.exports.request)
  requestExport(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.exports.request).handler(({ input }) =>
      this.exports.request(input),
    )
  }

  @Implement(contract.integrations.exports.list)
  listExports(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.exports.list).handler(({ input }) =>
      this.exports.list(input),
    )
  }

  @Implement(contract.integrations.exports.get)
  getExport(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.exports.get).handler(({ input }) =>
      this.exports.getOne(input),
    )
  }

  @Implement(contract.integrations.exports.downloadUrl)
  exportDownloadUrl(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.exports.downloadUrl).handler(({ input }) =>
      this.exports.downloadUrl(input),
    )
  }

  // tally

  @Implement(contract.integrations.tally.mappings.list)
  listTallyMappings(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.tally.mappings.list).handler(({ input }) =>
      this.tally.listMappings(input),
    )
  }

  @Implement(contract.integrations.tally.mappings.upsert)
  upsertTallyMapping(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.tally.mappings.upsert).handler(({ input }) =>
      this.tally.upsertMapping(input),
    )
  }

  @Implement(contract.integrations.tally.syncLedger.list)
  listTallySyncLedger(@OwnsReply() _reply: unknown) {
    return implement(contract.integrations.tally.syncLedger.list).handler(({ input }) =>
      this.tally.listSyncLedger(input),
    )
  }
}
