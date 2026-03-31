'use client'

import { useTranslations } from 'next-intl'
import type { MonthlyPlan, FundInvestment, DirectSaving, FixedExpense, InsuranceMember, OtherExpense } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan | null
  investments: FundInvestment[]
  savings: DirectSaving[]
  fixedExpenses: FixedExpense[]
  insuranceMembers: InsuranceMember[]
  otherExpenses: OtherExpense[]
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

interface GoalRow {
  label: string
  total: number
}

export default function AllocationSummary({ plan, investments, savings, fixedExpenses, insuranceMembers, otherExpenses }: Props) {
  const t = useTranslations('planning')
  if (!plan) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('summaryTitle')}</h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">{t('enterSalary')}</p>
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
    const label = inv.savings_goals?.goal_name ?? t('unassigned')
    addToGoal(label, inv.amount_vnd)
  }
  for (const sav of savings) {
    const label = sav.savings_goals?.goal_name ?? t('unassigned')
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
  const totalOther = otherExpenses.reduce((s, e) => s + e.amount_vnd, 0)
  const totalAllocated = totalInvested + totalSaved + totalFixed + totalInsurance + totalOther
  const remaining = salary - totalAllocated

  // Build rows sorted: named goals alphabetically, then Unassigned
  const goalRows: GoalRow[] = []
  const unassignedLabel = t('unassigned')
  const unassigned = goalMap.get(unassignedLabel)
  for (const [label, total] of goalMap.entries()) {
    if (label !== unassignedLabel) goalRows.push({ label, total })
  }
  goalRows.sort((a, b) => a.label.localeCompare(b.label))
  if (unassigned != null) goalRows.push({ label: unassignedLabel, total: unassigned })

  const pct = (n: number) => salary > 0 ? `${Math.round((n / salary) * 100)}%` : '—'

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden sticky top-6">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t('summaryTitle')}</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('salaryRow', { amount: fmt(salary) })}</p>
      </div>

      <div className="p-5">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="pb-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('colGoal')}</th>
              <th className="pb-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide px-3">{t('colAllocation')}</th>
              <th className="pb-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">{t('colPercent')}</th>
            </tr>
          </thead>
          <tbody>
            {/* Goal rows */}
            {goalRows.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-2 text-sm text-gray-400 dark:text-gray-500 text-center">{t('noAllocations')}</td>
              </tr>
            ) : (
              goalRows.map((row) => (
                <tr key={row.label} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="py-2 text-gray-700 dark:text-gray-300 font-medium">{row.label}</td>
                  <td className="py-2 text-right text-gray-600 dark:text-gray-400 px-3">{fmt(row.total)}</td>
                  <td className="py-2 text-right text-gray-400 dark:text-gray-500">{pct(row.total)}</td>
                </tr>
              ))
            )}

            {/* Fixed Expenses */}
            {fixedExpenses.length > 0 && (
              <tr className="border-t border-gray-200 dark:border-gray-600">
                <td className="pt-3 pb-1 text-gray-600 dark:text-gray-400">{t('rowFixedExpenses')}</td>
                <td className="pt-3 pb-1 text-right text-gray-700 dark:text-gray-300 font-medium px-3">{fmt(totalFixed)}</td>
                <td className="pt-3 pb-1 text-right text-gray-400 dark:text-gray-500">{pct(totalFixed)}</td>
              </tr>
            )}

            {/* Insurance */}
            {insuranceMembers.length > 0 && (
              <tr className={fixedExpenses.length > 0 ? '' : 'border-t border-gray-200 dark:border-gray-600'}>
                <td className="py-1 text-gray-600 dark:text-gray-400">{t('rowInsurance')}</td>
                <td className="py-1 text-right text-gray-700 dark:text-gray-300 font-medium px-3">{fmt(totalInsurance)}</td>
                <td className="py-1 text-right text-gray-400 dark:text-gray-500">{pct(totalInsurance)}</td>
              </tr>
            )}

            {/* Other Expenses */}
            {otherExpenses.length > 0 && (
              <tr className={(fixedExpenses.length > 0 || insuranceMembers.length > 0) ? '' : 'border-t border-gray-200 dark:border-gray-600'}>
                <td className="py-1 text-gray-600 dark:text-gray-400">{t('rowOtherExpenses')}</td>
                <td className="py-1 text-right text-gray-700 dark:text-gray-300 font-medium px-3">{fmt(totalOther)}</td>
                <td className="py-1 text-right text-gray-400 dark:text-gray-500">{pct(totalOther)}</td>
              </tr>
            )}

            {/* Total Allocated */}
            <tr className="border-t border-gray-200 dark:border-gray-600">
              <td className="pt-2 pb-1 font-semibold text-gray-700 dark:text-gray-300">{t('rowTotal')}</td>
              <td className="pt-2 pb-1 text-right font-semibold text-gray-900 dark:text-gray-100 px-3">{fmt(totalAllocated)}</td>
              <td className="pt-2 pb-1 text-right font-semibold text-gray-400 dark:text-gray-500">{pct(totalAllocated)}</td>
            </tr>

            {/* Spacer */}
            <tr><td colSpan={3} className="pt-2" /></tr>

            {/* Remaining Salary — inside the table so columns stay aligned */}
            <tr>
              <td className={`py-2 pl-3 rounded-l-lg font-semibold ${remaining >= 0 ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
                {t('rowRemaining')}
              </td>
              <td className={`py-2 text-right font-semibold px-3 ${remaining >= 0 ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
                {fmt(remaining)}
              </td>
              <td className={`py-2 pr-3 text-right text-xs font-semibold rounded-r-lg whitespace-nowrap ${remaining >= 0 ? 'bg-green-50 dark:bg-green-900/20 text-green-500 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-400 dark:text-red-300'}`}>
                {pct(Math.abs(remaining))}
              </td>
            </tr>
          </tbody>
        </table>

        {remaining < 0 && (
          <p className="text-xs text-red-500 dark:text-red-400 text-center mt-2">{t('overAllocated', { amount: fmt(Math.abs(remaining)) })}</p>
        )}
      </div>
    </div>
  )
}
