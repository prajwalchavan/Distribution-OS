import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { DocumentsService } from './documents.service.js'
import { ExtractionsService } from './extractions.service.js'
import { MatchesService } from './matches.service.js'
import { QueueService } from './queue.service.js'
import { ReviewService } from './review.service.js'

@Controller()
@UseGuards(TenantGuard)
export class DocintController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly extractions: ExtractionsService,
    private readonly matches: MatchesService,
    private readonly review: ReviewService,
    private readonly queue: QueueService,
  ) {}

  // documents (CAP + the desk decisions)

  @Implement(contract.docint.documents.create)
  createDocument(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.documents.create).handler(({ input }) =>
      this.documents.create(input),
    )
  }

  @Implement(contract.docint.documents.pageUploadUrl)
  pageUploadUrl(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.documents.pageUploadUrl).handler(({ input }) =>
      this.documents.pageUploadUrl(input),
    )
  }

  @Implement(contract.docint.documents.addPage)
  addPage(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.documents.addPage).handler(({ input }) =>
      this.documents.addPage(input),
    )
  }

  @Implement(contract.docint.documents.verifyQr)
  verifyQr(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.documents.verifyQr).handler(({ input }) =>
      this.documents.verifyQr(input),
    )
  }

  @Implement(contract.docint.documents.submit)
  submitDocument(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.documents.submit).handler(({ input }) =>
      this.documents.submit(input),
    )
  }

  @Implement(contract.docint.documents.list)
  listDocuments(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.documents.list).handler(({ input }) =>
      this.documents.list(input),
    )
  }

  @Implement(contract.docint.documents.get)
  getDocument(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.documents.get).handler(({ input }) =>
      this.documents.get(input),
    )
  }

  @Implement(contract.docint.documents.status)
  documentStatus(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.documents.status).handler(({ input }) =>
      this.documents.status(input),
    )
  }

  @Implement(contract.docint.documents.pageUrl)
  pageUrl(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.documents.pageUrl).handler(({ input }) =>
      this.documents.pageUrl(input),
    )
  }

  @Implement(contract.docint.documents.reject)
  rejectDocument(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.documents.reject).handler(({ input }) =>
      this.documents.reject(input),
    )
  }

  @Implement(contract.docint.documents.approve)
  approveDocument(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.documents.approve).handler(({ input }) =>
      this.documents.approve(input),
    )
  }

  // extractions

  @Implement(contract.docint.extractions.run)
  runExtraction(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.extractions.run).handler(({ input }) =>
      this.extractions.run(input),
    )
  }

  @Implement(contract.docint.extractions.list)
  listExtractions(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.extractions.list).handler(({ input }) =>
      this.extractions.list(input),
    )
  }

  @Implement(contract.docint.extractions.get)
  getExtraction(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.extractions.get).handler(({ input }) =>
      this.extractions.get(input),
    )
  }

  // matches

  @Implement(contract.docint.matches.list)
  listMatches(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.matches.list).handler(({ input }) => this.matches.list(input))
  }

  @Implement(contract.docint.matches.accept)
  acceptMatch(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.matches.accept).handler(({ input }) =>
      this.matches.accept(input),
    )
  }

  @Implement(contract.docint.matches.reject)
  rejectMatch(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.matches.reject).handler(({ input }) =>
      this.matches.reject(input),
    )
  }

  @Implement(contract.docint.matches.choose)
  chooseMatch(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.matches.choose).handler(({ input }) =>
      this.matches.choose(input),
    )
  }

  @Implement(contract.docint.matches.rerun)
  rerunMatches(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.matches.rerun).handler(({ input }) =>
      this.matches.rerun(input),
    )
  }

  // review

  @Implement(contract.docint.review.start)
  startReview(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.review.start).handler(({ input }) => this.review.start(input))
  }

  @Implement(contract.docint.review.heartbeat)
  heartbeatReview(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.review.heartbeat).handler(({ input }) =>
      this.review.heartbeat(input),
    )
  }

  @Implement(contract.docint.review.save)
  saveReview(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.review.save).handler(({ input }) => this.review.save(input))
  }

  @Implement(contract.docint.review.release)
  releaseReview(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.review.release).handler(({ input }) =>
      this.review.release(input),
    )
  }

  @Implement(contract.docint.review.submit)
  submitReview(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.review.submit).handler(({ input }) =>
      this.review.submit(input),
    )
  }

  // queue + stats

  @Implement(contract.docint.queue.list)
  listQueue(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.queue.list).handler(({ input }) => this.queue.list(input))
  }

  @Implement(contract.docint.stats.summary)
  statsSummary(@OwnsReply() _reply: unknown) {
    return implement(contract.docint.stats.summary).handler(({ input }) =>
      this.queue.summary(input),
    )
  }
}
