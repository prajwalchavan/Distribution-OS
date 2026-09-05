import type {
  Statement,
  StatementBreakdownRow,
  StatementDetail,
  Target,
  TargetAchievement,
  TargetDetail,
  TargetMetric,
  TargetSummary,
} from '@dos/contracts'
import {
  payoutRuleOf,
  type AchievementRow,
  type StatementRow,
  type TargetRow,
} from './incentives.internals.js'

/**
 * Rows to wire shapes. Every date on a target is already an IST business date (`date` columns are
 * `mode: 'string'`), every timestamp becomes an ISO instant, and every money field stays integer
 * paise — a `value` or `collections` target's `targetValue`, and every `payoutPaise`.
 *
 * `userName` / `brandName` come from the join the reads already need (`targets → users`, `→ brands`),
 * so a list row reads as a person and a brand rather than two uuids (docs/23 O20, M21, S9).
 */

const iso = (at: Date | string | null): string | null =>
  at === null ? null : at instanceof Date ? at.toISOString() : at

const isoOf = (at: Date | string): string => iso(at) as string

/** What the joined reads add to a target row. */
export interface TargetNames {
  userName: string
  brandName: string | null
}

export function toTargetAchievement(row: AchievementRow | null): TargetAchievement | null {
  if (!row) return null
  return {
    achievedValue: row.achievedValue,
    achievedPieces: row.achievedPieces,
    achievedPct: row.achievedPct,
    computedAt: isoOf(row.computedAt),
  }
}

export function toTarget(row: TargetRow, names: TargetNames): Target {
  return {
    id: row.id,
    userId: row.userId,
    userName: names.userName,
    brandId: row.brandId,
    brandName: names.brandName,
    metric: row.metric,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    targetValue: row.targetValue,
    name: row.name,
    payoutRule: payoutRuleOf(row.payoutRule),
    createdBy: row.createdBy,
    createdAt: isoOf(row.createdAt),
  }
}

export function toTargetDetail(
  row: TargetRow,
  names: TargetNames,
  achievement: AchievementRow | null,
): TargetDetail {
  return { ...toTarget(row, names), achievement: toTargetAchievement(achievement) }
}

/**
 * The lean list row: no slab table, and the achievement flattened to the two numbers a progress bar
 * needs. A target the sweep has not reached yet reads 0 / 0, never null — "not started" and "no row
 * yet" look the same on a bar, and a nullable number would only push the decision onto every screen.
 */
export function toTargetSummary(
  row: TargetRow,
  names: TargetNames,
  achievement: { achievedValue: number; achievedPct: number } | null,
): TargetSummary {
  return {
    id: row.id,
    userId: row.userId,
    userName: names.userName,
    brandId: row.brandId,
    brandName: names.brandName,
    metric: row.metric,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    targetValue: row.targetValue,
    name: row.name,
    achievedValue: achievement?.achievedValue ?? 0,
    achievedPct: achievement?.achievedPct ?? 0,
  }
}

/**
 * A statement's `breakdown` is a SNAPSHOT taken at compute time, stored as `jsonb`: the target's
 * name, metric, brand and figures as they stood when the number was struck. That is deliberate — a
 * target renamed or removed afterwards must not rewrite a statement the owner already looked at.
 * Rows written before a field existed read as null rather than crashing the screen.
 */
export function breakdownOf(value: unknown): StatementBreakdownRow[] {
  if (!Array.isArray(value)) return []
  const out: StatementBreakdownRow[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    if (typeof row.targetId !== 'string') continue
    out.push({
      targetId: row.targetId,
      metric: row.metric as TargetMetric,
      brandId: typeof row.brandId === 'string' ? row.brandId : null,
      name: typeof row.name === 'string' ? row.name : null,
      targetValue: Number(row.targetValue ?? 0),
      achievedValue: Number(row.achievedValue ?? 0),
      achievedPct: Number(row.achievedPct ?? 0),
      payoutPaise: Number(row.payoutPaise ?? 0),
    })
  }
  return out
}

export function toStatement(row: StatementRow, userName: string): Statement {
  return {
    id: row.id,
    userId: row.userId,
    userName,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    amountPaise: row.amountPaise,
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    computedAt: isoOf(row.computedAt),
  }
}

export function toStatementDetail(row: StatementRow, userName: string): StatementDetail {
  return { ...toStatement(row, userName), breakdown: breakdownOf(row.breakdown) }
}
