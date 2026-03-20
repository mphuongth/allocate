'use client'

import type { MonthlyPlan, FundInvestment, DirectSaving, FixedExpense, InsuranceMember } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan | null
  investments: FundInvestment[]
  savings: DirectSaving[]
  fixedExpenses: FixedExpense[]
  insuranceMembers: InsuranceMember[]
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

interface GoalRow {
  label: string
  total: number
}

export default function AllocationSummary({ plan, investments, savings, fixedExpenses, insuranceMembers }: Props) {
  if (!plan) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Allocation Summary</h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">Enter your salary to see the summary.</p>
      </div>
    )
  }

  const salary = plan.salary_vnd

  // Build goal map: goal_name → total invested/saved
  const goalMap = new Map<string, number>()

  const addToGoal = (label: string, amount: number) => {
    goalMap.set(label, (goalMap.get(label) ?? 0) + amount)
  }

  for (const inv of investments) {
    const label = inv.savings_goals?.goal_name ?? 'Unassigned'
    addToGoal(label, inv.amount_vnd)
  }
  for (const sav of savings) {
    const label = sav.savings_goals?.goal_name ?? 'Unassigned'
    addToGoal(label, sav.amount_vnd)
  }

  const totalFixed = fixedExpenses.reduce((sum, e) => {
    if (e.override === 0) return sum // skipped this month
    const monthly = e.override != null ? e.override : e.amount_vnd
    return sum + monthly
  }, 0)

  const totalInsurance = insuranceMembers.reduce((sum, m) => {
    if (m.excluded) return sum
    return sum + (m.monthlyOverride ?? Math.round(m.annual_payment_vnd / 12))
  }, 0)

  const totalInvested = investments.reduce((s, i) => s + i.amount_vnd, 0)
  const totalSaved = savings.reduce((s, d) => s + d.amount_vnd, 0)
  const totalAllocated = totalInvested + totalSaved + totalFixed + totalInsurance
  const remaining = salary - totalAllocated

  // Build rows sorted: named goals alphabetically, then Unassigned
  const goalRows: GoalRow[] = []
  const unassigned = goalMap.get('Unassigned')
  for (const [label, total] of goalMap.entries()) {
    if (label !== 'Unassigned') goalRows.push({ label, total })
  }
  goalRows.sort((a, b) => a.label.localeCompare(b.label))
  if (unassigned != null) goalRows.push({ label: 'Unassigned', total: unassigned })

  const pct = (n: number) => salary > 0 ? `${Math.round((n / salary) * 100)}%` : '—'

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden sticky top-6">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Allocation Summary</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Salary: {fmt(salary)}</p>
      </div>

      <div className="p-5 space-y-4">
        {/* Goal breakdown table */}
        {goalRows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['Goal', 'Allocated', '% Salary'].map((h) => (
                  <th key={h} className="pb-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {goalRows.map((row) => (
                <tr key={row.label}>
                  <td className="py-2 text-gray-700 dark:text-gray-300 font-medium pr-2">{row.label}</td>
                  <td className="py-2 text-gray-600 dark:text-gray-400 pr-2">{fmt(row.total)}</td>
                  <td className="py-2 text-gray-400 dark:text-gray-500">{pct(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {goalRows.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">No allocations yet</p>
        )}

        {/* Divider */}
        <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-2">
          {/* Fixed expenses row */}
          {fixedExpenses.length > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Fixed Expenses</span>
              <div className="text-right">
                <span className="text-gray-700 dark:text-gray-300 font-medium">{fmt(totalFixed)}</span>
                <span className="ml-2 text-gray-400 dark:text-gray-500 text-xs">{pct(totalFixed)}</span>
              </div>
            </div>
          )}

          {/* Insurance row */}
          {insuranceMembers.length > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Insurance</span>
              <div className="text-right">
                <span className="text-gray-700 dark:text-gray-300 font-medium">{fmt(totalInsurance)}</span>
                <span className="ml-2 text-gray-400 dark:text-gray-500 text-xs">{pct(totalInsurance)}</span>
              </div>
            </div>
          )}

          {/* Total row */}
          <div className="flex items-center justify-between text-sm border-t border-gray-100 dark:border-gray-700 pt-2 mt-2">
            <span className="font-semibold text-gray-700 dark:text-gray-300">Total Allocated</span>
            <div className="text-right">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{fmt(totalAllocated)}</span>
              <span className="ml-2 text-gray-400 dark:text-gray-500 text-xs">{pct(totalAllocated)}</span>
            </div>
          </div>

          {/* Remaining row */}
          <div className={`flex items-center justify-between text-sm rounded-lg px-3 py-2 ${remaining >= 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
            <span className={`font-semibold ${remaining >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
              Remaining Salary
            </span>
            <div className="text-right">
              <span className={`font-semibold ${remaining >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                {fmt(remaining)}
              </span>
              <span className={`ml-2 text-xs ${remaining >= 0 ? 'text-green-500 dark:text-green-400' : 'text-red-400 dark:text-red-300'}`}>
                {pct(Math.abs(remaining))}
              </span>
            </div>
          </div>

          {remaining < 0 && (
            <p className="text-xs text-red-500 dark:text-red-400 text-center">Over-allocated by {fmt(Math.abs(remaining))}</p>
          )}
        </div>
      </div>
    </div>
  )
}
