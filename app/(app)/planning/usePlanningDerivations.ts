import { useMemo } from 'react'
import {
  buildByGoal,
  resolveRecurringSavings,
  DEPOSIT_BACKED_FULFILLMENT_SOURCES,
  type GoalRow,
} from '@/lib/planning'
import type {
  MonthlyPlan, FundInvestment, DirectSaving, FixedExpense, InsuranceMember,
  OtherExpense, RecurringSaving, RecurringSavingOverride, RecurringFulfillment, DcaSkip, Fund, Goal,
} from '@/features/planning/contracts'

// Effective monthly totals. A `override === 0` fixed expense is skipped for the
// month; an `excluded` insurance member is skipped; otherwise the override (if
// any) wins over the base amount. Shared verbatim by both planning views.
function getFixedTotal(fixedExpenses: FixedExpense[]) {
  return fixedExpenses.reduce((s, e) => {
    if (e.override === 0) return s
    return s + (e.override ?? e.amount_vnd)
  }, 0)
}

function getInsTotal(insuranceMembers: InsuranceMember[]) {
  return insuranceMembers.reduce((s, m) => {
    if (m.excluded) return s
    return s + (m.monthlyOverride ?? Math.round(m.annual_payment_vnd / 12))
  }, 0)
}

export interface PlanningDerivationsInput {
  plan: MonthlyPlan | null
  investments: FundInvestment[]
  savings: DirectSaving[]
  fixedExpenses: FixedExpense[]
  insuranceMembers: InsuranceMember[]
  otherExpenses: OtherExpense[]
  recurringSavings: RecurringSaving[]
  recurringSavingOverrides: RecurringSavingOverride[]
  recurringFulfillments: RecurringFulfillment[]
  dcaSkips: DcaSkip[]
  funds: Fund[]
  goals: Goal[]
  isVI: boolean
}

// The single source of truth for the planning page's derived model: the by-goal
// allocation rows and the salary-vs-outflow totals. Extracted so the mobile and
// desktop views can't drift (issue #467); the block was previously copy-pasted
// into both, modulo local variable names.
export function usePlanningDerivations(input: PlanningDerivationsInput) {
  const {
    plan, investments, savings, fixedExpenses, insuranceMembers, otherExpenses,
    recurringSavings, recurringSavingOverrides, recurringFulfillments, dcaSkips, funds, goals, isVI,
  } = input

  const goalsById = useMemo(() => new Map(goals.map(g => [g.goal_id, g.goal_name])), [goals])

  const resolvedRecurring = useMemo(
    () => resolveRecurringSavings(recurringSavings, recurringSavingOverrides),
    [recurringSavings, recurringSavingOverrides],
  )

  // Skipped DCA funds are no longer seeded as rows, so synthesize struck-through
  // lines from the fund config + the plan's skip list.
  const skippedDcaInvestments = useMemo(() => {
    const skipped = new Set(dcaSkips.map(s => s.fund_id))
    return funds
      .filter(f => f.is_dca && f.dca_monthly_amount_vnd && skipped.has(f.id))
      .map(f => ({
        goal_id: f.dca_goal_id ?? null,
        amount_vnd: f.dca_monthly_amount_vnd as number,
        is_dca_seeded: true,
        skipped: true,
        fund_id: f.id,
        funds: { name: f.name },
      }))
  }, [funds, dcaSkips])

  const fulfillments = useMemo(
    () => new Map(recurringFulfillments.map(f => [f.recurring_saving_id, {
      amount: f.amount_vnd,
      countedAsDeposit: DEPOSIT_BACKED_FULFILLMENT_SOURCES.has(f.source),
    }])),
    [recurringFulfillments],
  )

  const byGoal: GoalRow[] = useMemo(
    () => buildByGoal([...investments, ...skippedDcaInvestments], savings, resolvedRecurring, goalsById, {
      unallocated: isVI ? 'Chưa phân bổ' : 'Unallocated',
    }, fulfillments),
    [investments, skippedDcaInvestments, savings, resolvedRecurring, goalsById, isVI, fulfillments],
  )

  const totalGoals = useMemo(() => byGoal.reduce((s, g) => s + g.totalAllocated, 0), [byGoal])
  const contributedTotal = useMemo(() => byGoal.reduce((s, g) => s + g.contributed, 0), [byGoal])
  const totalFixed = useMemo(() => getFixedTotal(fixedExpenses), [fixedExpenses])
  const totalInsurance = useMemo(() => getInsTotal(insuranceMembers), [insuranceMembers])
  const totalOther = useMemo(() => otherExpenses.reduce((s, e) => s + e.amount_vnd, 0), [otherExpenses])
  const totalOutflow = totalGoals + totalFixed + totalInsurance + totalOther
  const remaining = plan ? plan.salary_vnd - totalOutflow : 0

  return {
    goalsById, resolvedRecurring, skippedDcaInvestments, fulfillments, byGoal,
    totalGoals, contributedTotal, totalFixed, totalInsurance, totalOther, totalOutflow, remaining,
  }
}
