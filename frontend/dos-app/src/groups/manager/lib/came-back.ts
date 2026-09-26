/**
 * QA DOS-237 — what the desk is told after it records that a bill came back.
 *
 * `delivery.deliveries.cameBack` answers, per batch of the bill, how many pieces it needs on the dock, how
 * many it moved there from the godown (`stagedPcs`) and how many are still on a van whose check-in count will
 * put them there (`onVanPcs`). A batch the godown no longer holds free comes back SHORT, and the desk is told
 * in words what that means and what it can do — never a silent "done" over a bill the load-out will refuse.
 *
 * Pure: no React, no network.
 */
import type { Translator } from '@dos/ui'

export interface StagedLot {
  lotId: string
  description: string
  batchNo: string | null
  neededPcs: number
  stagedPcs: number
  onVanPcs: number
}

export interface StagedLine {
  key: string
  text: string
  /** The batch is not all on the dock or on its way there: the load-out will refuse the bill as it stands. */
  short: boolean
}

/** One sentence per batch: moved, still on the van, and — when the godown was short — what to do. */
export function stagedLines(staged: readonly StagedLot[], t: Translator): StagedLine[] {
  const lines: StagedLine[] = []
  for (const lot of staged) {
    const item = lot.batchNo === null ? lot.description : `${lot.description} (${lot.batchNo})`
    if (lot.stagedPcs > 0)
      lines.push({
        key: `${lot.lotId}:staged`,
        text: t('m7n.staged', { item, pieces: lot.stagedPcs }),
        short: false,
      })
    if (lot.onVanPcs > 0)
      lines.push({
        key: `${lot.lotId}:van`,
        text: t('m7n.onVan', { item, pieces: lot.onVanPcs }),
        short: false,
      })
    const covered = lot.stagedPcs + lot.onVanPcs
    if (covered < lot.neededPcs)
      lines.push({
        key: `${lot.lotId}:short`,
        text: t('m7n.short', { item, staged: covered, needed: lot.neededPcs }),
        short: true,
      })
  }
  return lines
}
