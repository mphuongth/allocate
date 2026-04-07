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
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('summaryTitle')}</h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">{t('enterSalary')}</p>
      </div>
    )
  }

  const salary = plan.salary_vnd

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
    if (e.override === 0) return sum
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
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 sticky top-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('summaryTitle')}</h2>

      <div className="space-y-4">
        {/* Salary */}
        <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{t('salaryLabel')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{fmt(salary)}</p>
        </div>

        <div className="space-y-3">
          {/* Goal rows */}
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">{t('colGoal')}</p>
            <div className="space-y-2">
              {goalRows.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">{t('noAllocations')}</p>
              ) : (
                goalRows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{row.label}</span>
                    <div className="text-right">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(row.total)}</span>
                      <span className="text-gray-500 dark:text-gray-400 ml-2">{pct(row.total)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Expenses */}
          <div className="space-y-2 pt-3 border-t border-gray-200 dark:border-gray-700">
            {fixedExpenses.length > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">{t('rowFixedExpenses')}</span>
                <div className="text-right">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(totalFixed)}</span>
                  <span className="text-gray-500 dark:text-gray-400 ml-2">{pct(totalFixed)}</span>
                </div>
              </div>
            )}
            {insuranceMembers.length > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">{t('rowInsurance')}</span>
                <div className="text-right">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(totalInsurance)}</span>
                  <span className="text-gray-500 dark:text-gray-400 ml-2">{pct(totalInsurance)}</span>
                </div>
              </div>
            )}
            {otherExpenses.length > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">{t('rowOtherExpenses')}</span>
                <div className="text-right">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(totalOther)}</span>
                  <span className="text-gray-500 dark:text-gray-400 ml-2">{pct(totalOther)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Total + Remaining */}
          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-900 dark:text-gray-100">{t('rowTotal')}</span>
              <div className="text-right">
                <span className="font-semibold text-gray-900 dark:text-gray-100">{fmt(totalAllocated)}</span>
                <span className="text-gray-500 dark:text-gray-400 ml-2">{pct(totalAllocated)}</span>
              </div>
            </div>

            <div className={`flex items-center justify-between p-3 rounded-lg ${remaining >= 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
              <span className={`font-semibold ${remaining >= 0 ? 'text-green-900 dark:text-green-400' : 'text-red-900 dark:text-red-400'}`}>
                {t('rowRemaining')}
              </span>
              <div className="text-right">
                <span className={`font-bold ${remaining >= 0 ? 'text-green-900 dark:text-green-400' : 'text-red-900 dark:text-red-400'}`}>
                  {fmt(remaining)}
                </span>
                <span className={`ml-2 ${remaining >= 0 ? 'text-green-700 dark:text-green-500' : 'text-red-700 dark:text-red-400'}`}>
                  {pct(Math.abs(remaining))}
                </span>
              </div>
            </div>

            {remaining < 0 && (
              <p className="text-xs text-red-500 dark:text-red-400 text-center mt-2">{t('overAllocated', { amount: fmt(Math.abs(remaining)) })}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
