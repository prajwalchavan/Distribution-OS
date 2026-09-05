import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { contract } from '@dos/contracts'
import { OwnsReply } from '../../platform/index.js'
import { TenantGuard } from '../tenancy/index.js'
import { ReceivablesService } from './receivables.service.js'

@Controller()
@UseGuards(TenantGuard)
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Implement(contract.receivables.receipts.create)
  createReceipt(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.receipts.create).handler(({ input }) =>
      this.receivables.createReceipt(input),
    )
  }

  @Implement(contract.receivables.receipts.list)
  listReceipts(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.receipts.list).handler(({ input }) =>
      this.receivables.listReceipts(input),
    )
  }

  @Implement(contract.receivables.receipts.get)
  getReceipt(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.receipts.get).handler(({ input }) =>
      this.receivables.getReceipt(input),
    )
  }

  @Implement(contract.receivables.receipts.document)
  receiptDocument(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.receipts.document).handler(({ input }) =>
      this.receivables.receiptDocument(input),
    )
  }

  @Implement(contract.receivables.receipts.reverse)
  reverseReceipt(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.receipts.reverse).handler(({ input }) =>
      this.receivables.reverseReceipt(input),
    )
  }

  @Implement(contract.receivables.receipts.deposit)
  depositReceipts(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.receipts.deposit).handler(({ input }) =>
      this.receivables.depositReceipts(input),
    )
  }

  @Implement(contract.receivables.receipts.bounce)
  bounceCheque(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.receipts.bounce).handler(({ input }) =>
      this.receivables.bounceCheque(input),
    )
  }

  @Implement(contract.receivables.payments.initiate)
  initiatePayment(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.payments.initiate).handler(({ input }) =>
      this.receivables.initiatePayment(input),
    )
  }

  @Implement(contract.receivables.allocations.create)
  createAllocations(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.allocations.create).handler(({ input }) =>
      this.receivables.createAllocations(input),
    )
  }

  @Implement(contract.receivables.allocations.remove)
  removeAllocation(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.allocations.remove).handler(({ input }) =>
      this.receivables.removeAllocation(input),
    )
  }

  @Implement(contract.receivables.outstanding.get)
  getOutstanding(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.outstanding.get).handler(({ input }) =>
      this.receivables.getOutstanding(input),
    )
  }

  @Implement(contract.receivables.outstanding.list)
  listOutstanding(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.outstanding.list).handler(({ input }) =>
      this.receivables.listOutstanding(input),
    )
  }

  @Implement(contract.receivables.creditCheck)
  creditCheck(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.creditCheck).handler(({ input }) =>
      this.receivables.creditCheck(input),
    )
  }

  @Implement(contract.receivables.ledger.get)
  getLedger(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.ledger.get).handler(({ input }) =>
      this.receivables.getLedger(input),
    )
  }

  @Implement(contract.receivables.statements.send)
  sendStatements(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.statements.send).handler(({ input }) =>
      this.receivables.sendStatements(input),
    )
  }

  @Implement(contract.receivables.writeOffs.create)
  createWriteOff(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.writeOffs.create).handler(({ input }) =>
      this.receivables.createWriteOff(input),
    )
  }

  @Implement(contract.receivables.cashDiscounts.list)
  listCashDiscounts(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.cashDiscounts.list).handler(({ input }) =>
      this.receivables.listCashDiscounts(input),
    )
  }

  @Implement(contract.receivables.accounts.list)
  listAccounts(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.accounts.list).handler(({ input }) =>
      this.receivables.listAccounts(input),
    )
  }

  @Implement(contract.receivables.journal.list)
  listJournal(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.journal.list).handler(({ input }) =>
      this.receivables.listJournal(input),
    )
  }

  @Implement(contract.receivables.ageing.rebuild)
  rebuildAgeing(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.ageing.rebuild).handler(({ input }) =>
      this.receivables.rebuildAgeing(input),
    )
  }

  @Implement(contract.receivables.ageing.history)
  ageingHistory(@OwnsReply() _reply: unknown) {
    return implement(contract.receivables.ageing.history).handler(({ input }) =>
      this.receivables.ageingHistory(input),
    )
  }
}
