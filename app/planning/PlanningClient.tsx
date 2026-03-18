'use client'

import { useState, useEffect, useCallback } from 'react'
import SalaryInput from './components/SalaryInput'
import FundInvestmentsSection from './components/FundInvestmentsSection'
import DirectSavingsSection from './components/DirectSavingsSection'
import FixedExpensesSection from './components/FixedExpensesSection'
import AllocationSummary from './components/AllocationSummary'

export interface MonthlyPlan {
  id: string
  month: number
  year: number
  salary_vnd: number
}

export interface FundInvestment {
  id: string
  plan_id: string
  fund_id: string
  goal_id: string | null
  amount_vnd: number
  units_purchased: number
  nav_at_purchase: number
  funds: { name: string; nav: number } | null
  savings_goals: { goal_name: string } | null
}

export interface DirectSaving {
  id: string
  plan_id: string
  goal_id: string | null
  amount_vnd: number
  profit_percent: number | null
  expiry_date: string | null
  savings_goals: { goal_name: string } | null
}

export interface FixedExpense {
  expense_id: string
  expense_name: string
  amount_vnd: number
  override?: number // overridden monthly amount if set
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function prevMonth(m: number, y: number) { return m === 1 ? { m: 12, y: y - 1 } : { m: m - 1, y } }
function nextMonth(m: number, y: number) { return m === 12 ? { m: 1, y: y + 1 } : { m: m + 1, y } }

export default function PlanningClient() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [plan, setPlan] = useState<MonthlyPlan | null>(null)
  const [investments, setInvestments] = useState<FundInvestment[]>([])
  const [savings, setSavings] = useState<DirectSaving[]>([])
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }, [])

  const fetchPlan = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/v1/monthly-plans?month=${month}&year=${year}`)
    if (res.ok) {
      const p = await res.json()
      setPlan(p)
      const [invRes, savRes, overridesRes] = await Promise.all([
        fetch(`/api/v1/monthly-plans/${p.id}/fund-investments`),
        fetch(`/api/v1/monthly-plans/${p.id}/direct-savings`),
        fetch(`/api/v1/monthly-plans/${p.id}/fixed-expense-overrides`),
      ])
      setInvestments(invRes.ok ? await invRes.json() : [])
      setSavings(savRes.ok ? await savRes.json() : [])

      const expRes = await fetch('/api/v1/fixed-expenses')
      const { expenses } = expRes.ok ? await expRes.json() : { expenses: [] }
      const overrides: Array<{ fixed_expense_id: string; monthly_amount_override_vnd: number }> =
        overridesRes.ok ? await overridesRes.json() : []
      const overrideMap = new Map(overrides.map((o) => [o.fixed_expense_id, o.monthly_amount_override_vnd]))
      setFixedExpenses((expenses ?? []).map((e: { expense_id: string; expense_name: string; amount_vnd: number }) => ({
        ...e,
        override: overrideMap.get(e.expense_id),
      })))
    } else {
      setPlan(null)
      setInvestments([])
      setSavings([])
      // Still load fixed expenses even without a plan
      const expRes = await fetch('/api/v1/fixed-expenses')
      const { expenses } = expRes.ok ? await expRes.json() : { expenses: [] }
      setFixedExpenses((expenses ?? []).map((e: { expense_id: string; expense_name: string; amount_vnd: number }) => ({ ...e })))
    }
    setLoading(false)
  }, [month, year])

  useEffect(() => { fetchPlan() }, [fetchPlan])

  function navigate(dir: 'prev' | 'next') {
    const { m, y } = dir === 'prev' ? prevMonth(month, year) : nextMonth(month, year)
    setMonth(m)
    setYear(y)
  }

  const refetch = useCallback(() => fetchPlan(), [fetchPlan])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Monthly Planning</h1>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('prev')} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-600">‹</button>
            <span className="text-lg font-semibold text-gray-800 min-w-[120px] text-center">
              {MONTHS[month - 1]} {year}
            </span>
            <button onClick={() => navigate('next')} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-600">›</button>
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed top-4 right-4 z-50 px-4 py-3 bg-green-600 text-white text-sm font-medium rounded-lg shadow-lg">
            {toast}
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-gray-400">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left col: salary + sections */}
            <div className="lg:col-span-2 space-y-6">
              <SalaryInput
                plan={plan}
                month={month}
                year={year}
                onPlanCreated={(p) => { setPlan(p); refetch() }}
              />

              {plan ? (
                <>
                  <FundInvestmentsSection
                    plan={plan}
                    investments={investments}
                    onRefresh={refetch}
                    onToast={showToast}
                  />
                  <DirectSavingsSection
                    plan={plan}
                    savings={savings}
                    onRefresh={refetch}
                    onToast={showToast}
                  />
                  <FixedExpensesSection
                    plan={plan}
                    fixedExpenses={fixedExpenses}
                    onRefresh={refetch}
                    onToast={showToast}
                  />
                </>
              ) : (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Enter your monthly salary to begin planning.
                </div>
              )}
            </div>

            {/* Right col: allocation summary */}
            <div>
              <AllocationSummary
                plan={plan}
                investments={investments}
                savings={savings}
                fixedExpenses={fixedExpenses}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
