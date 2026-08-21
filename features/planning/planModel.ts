// The planning page's per-row derivations (#603).
//
// The desktop table and the mobile card stack each carried their own copy of
// these: the month-name tables, the by-goal progress bar, an allocation line's
// sublabel (byte-identical in both row files), and the skipped/overridden/amount
// arithmetic for a fixed expense and an insurance member. Same rules, written
// twice, and three of them had already drifted — see the tests.
//
// Deliberately NOT shared: the table rows and the card rows themselves. A phone
// has no room for the Relationship and Default columns, so the two layouts
// genuinely differ; what they must agree on is the *state* each row is in, not
// the markup that shows it.

import type { GoalItem, GoalRow } from '@/lib/planning'
import type { FixedExpense, InsuranceMember } from './contracts'

// ─── Month labels ────────────────────────────────────────────────────────────

const SHORT_MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const SHORT_MONTHS_VI = ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12']
const LONG_MONTHS_EN  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const LONG_MONTHS_VI  = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']

/**
 * The month a plan is for, as the user reads it. `short` is the compact form
 * the month pickers use.
 */
export function monthLabel(month: number, year: number, isVI: boolean, opts?: { short?: boolean }): string {
  const names = opts?.short
    ? (isVI ? SHORT_MONTHS_VI : SHORT_MONTHS_EN)
    : (isVI ? LONG_MONTHS_VI : LONG_MONTHS_EN)
  return `${names[month - 1]} ${year}`
}

// ─── By-goal rows ────────────────────────────────────────────────────────────

/** The line under an allocation: what happened to it this month, or what it is. */
export function goalItemSublabel(item: GoalItem, isVI: boolean): string {
  if (item.skipped) return isVI ? 'Bỏ qua tháng này' : 'Skipped this month'
  if (item.overridden) return isVI ? 'Đã ghi đè tháng này' : 'Overridden this month'
  if (item.recorded) {
    return item.type === 'bank'
      ? (isVI ? 'Đã gửi tháng này' : 'Deposited this month')
      : (isVI ? 'Đã mua' : 'Recorded')
  }
  if (item.type === 'fund') return 'Fund'
  return item.isRecurring
    ? (isVI ? 'Tiết kiệm định kỳ' : 'Recurring saving')
    : (isVI ? 'Tiết kiệm' : 'Direct saving')
}

/**
 * A goal's progress bar: how much of what was planned has actually been logged.
 * The bar caps at 100%, and a goal with nothing planned but money in reads as
 * full — there is no shortfall to show — without being "met", since it had no
 * target to meet.
 */
export function goalProgress(entry: Pick<GoalRow, 'totalAllocated' | 'contributed'>): { pct: number; met: boolean } {
  const { totalAllocated, contributed } = entry
  if (totalAllocated > 0) {
    return {
      pct: Math.min(100, Math.round((contributed / totalAllocated) * 100)),
      met: contributed >= totalAllocated,
    }
  }
  return { pct: contributed > 0 ? 100 : 0, met: false }
}

// ─── Fixed expense / insurance rows ──────────────────────────────────────────

interface PlanLineState {
  /** An override is stored *and* it changes the amount, so it's worth announcing. */
  overridden: boolean
  /** An override row exists at all — what "Restore default" is offered for. */
  hasStoredOverride: boolean
  /** What this month costs. */
  amount: number
  /** What the override input opens on. */
  overrideDefault: number
}

/** A fixed expense line. A skip is stored as `override === 0`. */
export interface FixedExpenseLine extends PlanLineState {
  skipped: boolean
}

/** An insurance line. A skip is stored as its own exclusion row. */
export interface InsuranceLine extends PlanLineState {
  excluded: boolean
  /** The annual premium's monthly share — shown even when overridden. */
  defaultMonthly: number
}

/**
 * A fixed expense this month. `override === 0` is how a skip is stored; any
 * other override wins over the base amount.
 *
 * `overrideDefault` is deliberately never 0: opening "Override amount" on a
 * skipped expense used to offer 0 on desktop, which the sheet refuses to save.
 */
export function fixedExpenseRow(expense: FixedExpense): FixedExpenseLine {
  const { override, amount_vnd } = expense
  const skipped = override === 0
  const hasStoredOverride = override != null
  const amount = skipped ? 0 : (override ?? amount_vnd)
  return {
    skipped,
    overridden: !skipped && hasStoredOverride && override !== amount_vnd,
    hasStoredOverride,
    amount,
    overrideDefault: skipped ? amount_vnd : (override ?? amount_vnd),
  }
}

/**
 * An insurance member this month. The plan spreads the annual premium over
 * twelve months; `excluded` skips the member, and an override replaces the
 * monthly share.
 */
export function insuranceRow(member: InsuranceMember): InsuranceLine {
  const { excluded, monthlyOverride, annual_payment_vnd } = member
  const defaultMonthly = Math.round(annual_payment_vnd / 12)
  const hasStoredOverride = monthlyOverride != null
  return {
    excluded: !!excluded,
    overridden: !excluded && hasStoredOverride && monthlyOverride !== defaultMonthly,
    hasStoredOverride,
    defaultMonthly,
    amount: excluded ? 0 : (monthlyOverride ?? defaultMonthly),
    overrideDefault: monthlyOverride ?? defaultMonthly,
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

/**
 * The share of income the month plans to save. Null when there is no income to
 * divide by — the views show a dash rather than a misleading 0%.
 */
export function savedPercent(totalGoals: number, salaryVnd: number): number | null {
  if (salaryVnd <= 0) return null
  return Math.round((totalGoals / salaryVnd) * 100)
}
