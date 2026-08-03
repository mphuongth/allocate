import { describe, it, expect } from 'vitest'
import {
  monthLabel,
  goalItemSublabel,
  goalProgress,
  fixedExpenseRow,
  insuranceRow,
  savedPercent,
} from '../planModel'
import type { FixedExpense, InsuranceMember } from '../contracts'
import type { GoalItem, GoalRow } from '@/lib/planning'

const goalRow = (over: Partial<GoalRow> = {}): GoalRow => ({
  goalId: 'g1', goalName: 'Emergency', totalAllocated: 0, contributed: 0,
  isUnallocated: false, items: [], ...over,
})

const item = (over: Partial<GoalItem> = {}): GoalItem => ({
  name: 'VESAF', type: 'fund', amount: 1_000_000, ...over,
})

const expense = (over: Partial<FixedExpense> = {}): FixedExpense => ({
  expense_id: 'fe1', expense_name: 'Rent', amount_vnd: 5_000_000, ...over,
})

const member = (over: Partial<InsuranceMember> = {}): InsuranceMember => ({
  member_id: 'm1', member_name: 'Minh', relationship: 'self',
  annual_payment_vnd: 12_000_000, payment_date: null, ...over,
})

describe('monthLabel', () => {
  it('renders the long month in each locale', () => {
    expect(monthLabel(6, 2026, false)).toBe('June 2026')
    expect(monthLabel(6, 2026, true)).toBe('Tháng 6 2026')
  })

  it('renders the short month in each locale', () => {
    expect(monthLabel(6, 2026, false, { short: true })).toBe('Jun 2026')
    expect(monthLabel(6, 2026, true, { short: true })).toBe('Th6 2026')
  })

  // The mobile view carried an English-only copy of the month names, so a
  // Vietnamese user saw "January 2026" in the delete-plan sheet and the empty
  // state while the desktop said "Tháng 1 2026". One table, both surfaces.
  it('covers all twelve months in both locales', () => {
    for (let m = 1; m <= 12; m++) {
      expect(monthLabel(m, 2026, false)).not.toMatch(/undefined/)
      expect(monthLabel(m, 2026, true)).toMatch(/^Tháng \d{1,2} 2026$/)
      expect(monthLabel(m, 2026, true, { short: true })).toMatch(/^Th\d{1,2} 2026$/)
    }
  })
})

describe('goalItemSublabel', () => {
  it('reports a skipped item before anything else', () => {
    const skipped = item({ skipped: true, overridden: true, recorded: true })
    expect(goalItemSublabel(skipped, false)).toBe('Skipped this month')
    expect(goalItemSublabel(skipped, true)).toBe('Bỏ qua tháng này')
  })

  it('reports an override ahead of a recorded contribution', () => {
    const overridden = item({ overridden: true, recorded: true })
    expect(goalItemSublabel(overridden, false)).toBe('Overridden this month')
    expect(goalItemSublabel(overridden, true)).toBe('Đã ghi đè tháng này')
  })

  it('distinguishes a recorded deposit from a recorded buy', () => {
    expect(goalItemSublabel(item({ type: 'bank', recorded: true }), false)).toBe('Deposited this month')
    expect(goalItemSublabel(item({ type: 'bank', recorded: true }), true)).toBe('Đã gửi tháng này')
    expect(goalItemSublabel(item({ type: 'fund', recorded: true }), false)).toBe('Recorded')
    expect(goalItemSublabel(item({ type: 'fund', recorded: true }), true)).toBe('Đã mua')
  })

  it('falls back to the item kind', () => {
    expect(goalItemSublabel(item({ type: 'fund' }), true)).toBe('Fund')
    expect(goalItemSublabel(item({ type: 'bank', isRecurring: true }), false)).toBe('Recurring saving')
    expect(goalItemSublabel(item({ type: 'bank', isRecurring: true }), true)).toBe('Tiết kiệm định kỳ')
    expect(goalItemSublabel(item({ type: 'bank' }), false)).toBe('Direct saving')
    expect(goalItemSublabel(item({ type: 'bank' }), true)).toBe('Tiết kiệm')
  })
})

describe('goalProgress', () => {
  it('is the contributed share of what was planned', () => {
    expect(goalProgress(goalRow({ totalAllocated: 4_000_000, contributed: 1_000_000 })))
      .toEqual({ pct: 25, met: false })
  })

  it('caps the bar at 100% but still marks the goal met', () => {
    expect(goalProgress(goalRow({ totalAllocated: 1_000_000, contributed: 3_000_000 })))
      .toEqual({ pct: 100, met: true })
  })

  it('marks an exactly-funded goal met', () => {
    expect(goalProgress(goalRow({ totalAllocated: 1_000_000, contributed: 1_000_000 })))
      .toEqual({ pct: 100, met: true })
  })

  // An unplanned goal that received money is full, not 0/0 — but it isn't "met",
  // since there was no target to meet.
  it('shows an unplanned contribution as full and not met', () => {
    expect(goalProgress(goalRow({ totalAllocated: 0, contributed: 500_000 })))
      .toEqual({ pct: 100, met: false })
  })

  it('is empty when nothing is planned and nothing given', () => {
    expect(goalProgress(goalRow())).toEqual({ pct: 0, met: false })
  })
})

describe('fixedExpenseRow', () => {
  it('uses the base amount when there is no override', () => {
    expect(fixedExpenseRow(expense())).toEqual({
      skipped: false, overridden: false, amount: 5_000_000,
      hasStoredOverride: false, overrideDefault: 5_000_000,
    })
  })

  it('treats a zero override as skipped for the month', () => {
    expect(fixedExpenseRow(expense({ override: 0 }))).toMatchObject({
      skipped: true, overridden: false, amount: 0,
    })
  })

  // Desktop pre-filled the override input from `override ?? amount_vnd`, so
  // opening "Override amount" on a *skipped* expense offered 0 — a value the
  // sheet refuses to save. Both surfaces now offer the base amount.
  it('offers the base amount as the override default on a skipped expense', () => {
    expect(fixedExpenseRow(expense({ override: 0 })).overrideDefault).toBe(5_000_000)
  })

  it('uses the override when it differs from the base amount', () => {
    expect(fixedExpenseRow(expense({ override: 6_000_000 }))).toEqual({
      skipped: false, overridden: true, amount: 6_000_000,
      hasStoredOverride: true, overrideDefault: 6_000_000,
    })
  })

  // An override stored at exactly the base amount changes nothing the user can
  // see, so it isn't announced — but it is still restorable.
  it('does not announce an override equal to the base amount', () => {
    expect(fixedExpenseRow(expense({ override: 5_000_000 }))).toMatchObject({
      overridden: false, hasStoredOverride: true, amount: 5_000_000,
    })
  })
})

describe('insuranceRow', () => {
  it('spreads the annual payment over twelve months', () => {
    expect(insuranceRow(member())).toEqual({
      excluded: false, overridden: false, hasStoredOverride: false,
      defaultMonthly: 1_000_000, amount: 1_000_000, overrideDefault: 1_000_000,
    })
  })

  it('rounds the monthly default', () => {
    expect(insuranceRow(member({ annual_payment_vnd: 10_000_000 })).defaultMonthly).toBe(833_333)
  })

  it('zeroes an excluded member but keeps the default visible', () => {
    expect(insuranceRow(member({ excluded: true }))).toMatchObject({
      excluded: true, amount: 0, defaultMonthly: 1_000_000, overrideDefault: 1_000_000,
    })
  })

  it('uses the override when set', () => {
    expect(insuranceRow(member({ monthlyOverride: 1_500_000 }))).toMatchObject({
      overridden: true, hasStoredOverride: true, amount: 1_500_000, overrideDefault: 1_500_000,
    })
  })

  // Desktop announced "(overridden)" for any stored override, mobile only when
  // it differed from the default — the same member read differently on the two
  // surfaces. Announce it only when the amount actually changed, matching how
  // fixed expenses already behaved on both.
  it('does not announce an override equal to the monthly default', () => {
    expect(insuranceRow(member({ monthlyOverride: 1_000_000 }))).toMatchObject({
      overridden: false, hasStoredOverride: true, amount: 1_000_000,
    })
  })

  it('never announces an override on an excluded member', () => {
    expect(insuranceRow(member({ excluded: true, monthlyOverride: 1_500_000 }))).toMatchObject({
      excluded: true, overridden: false, hasStoredOverride: true, amount: 0,
    })
  })
})

describe('savedPercent', () => {
  it('is the planned-goal share of income', () => {
    expect(savedPercent(9_000_000, 30_000_000)).toBe(30)
  })

  it('rounds to a whole percent', () => {
    expect(savedPercent(1_000_000, 3_000_000)).toBe(33)
  })

  it('is null without income to divide by', () => {
    expect(savedPercent(1_000_000, 0)).toBeNull()
  })
})
