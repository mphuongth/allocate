'use client'

import { useState, useEffect, useCallback } from 'react'
import SalaryInput from './components/SalaryInput'
import FundInvestmentsSection from './components/FundInvestmentsSection'
import DirectSavingsSection from './components/DirectSavingsSection'
import FixedExpensesSection from './components/FixedExpensesSection'
import InsuranceSection from './components/InsuranceSection'
import AllocationSummary from './components/AllocationSummary'

export interface MonthlyPlan {
  id: string
  month: number
  year: number
  salary_vnd: number
}

export interface FundInvestment {
  transaction_id: string
  plan_id: string
  fund_id: string
  goal_id: string | null
  amount_vnd: number
  units: number
  unit_price: number
  investment_date: string | null
  funds: { name: string; nav: number } | null
  savings_goals: { goal_name: string } | null
}

export interface DirectSaving {
  transaction_id: string
  plan_id: string
  goal_id: string | null
  amount_vnd: number
  interest_rate: number | null
  expiry_date: string | null
  investment_date: string
  savings_goals: { goal_name: string } | null
}

export interface FixedExpense {
  expense_id: string
  expense_name: string
  amount_vnd: number
  override?: number // overridden monthly amount if set
}

export interface InsuranceMember {
  member_id: string
  member_name: string
  relationship: string
  annual_payment_vnd: number
  payment_date: string | null
  excluded?: boolean
  monthlyOverride?: number
}

export interface Fund { id: string; name: string; nav: number }
export interface Goal { goal_id: string; goal_name: string }

const MONTHS = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']

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
  const [insuranceMembers, setInsuranceMembers] = useState<InsuranceMember[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }, [])

  const fetchPlan = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/v1/monthly-plans?month=${month}&year=${year}&full=true`)
    if (res.ok) {
      const p = await res.json()
      setPlan({ id: p.id, month: p.month, year: p.year, salary_vnd: p.salary_vnd })
      setInvestments(p.fund_investments ?? [])
      setSavings(p.direct_savings ?? [])

      const overrideMap = new Map(
        (p.fixed_expense_overrides as Array<{ fixed_expense_id: string; monthly_amount_override_vnd: number }>)
          .map((o) => [o.fixed_expense_id, o.monthly_amount_override_vnd])
      )
      setFixedExpenses(
        (p.fixed_expenses as Array<{ expense_id: string; expense_name: string; amount_vnd: number }>).map((e) => ({
          ...e,
          override: overrideMap.get(e.expense_id),
        }))
      )

      const excludedSet = new Set(
        (p.excluded_insurance as Array<{ member_id: string }>).map((e) => e.member_id)
      )
      const insOverrideMap = new Map(
        (p.insurance_overrides as Array<{ member_id: string; monthly_amount_override_vnd: number }>)
          .map((o) => [o.member_id, o.monthly_amount_override_vnd])
      )
      setInsuranceMembers(
        (p.insurance_members as InsuranceMember[]).map((m) => ({
          ...m,
          excluded: excludedSet.has(m.member_id),
          monthlyOverride: insOverrideMap.get(m.member_id),
        }))
      )
      setGoals(p.goals ?? [])
      setFunds(p.funds ?? [])
    } else {
      setPlan(null)
      setInvestments([])
      setSavings([])
      setGoals([])
      setFunds([])
      // Still load fixed expenses and insurance even without a plan
      const [expRes, insRes] = await Promise.all([
        fetch('/api/v1/fixed-expenses'),
        fetch('/api/v1/insurance-members'),
      ])
      const { expenses } = expRes.ok ? await expRes.json() : { expenses: [] }
      setFixedExpenses((expenses ?? []).map((e: { expense_id: string; expense_name: string; amount_vnd: number }) => ({ ...e })))
      const { members } = insRes.ok ? await insRes.json() : { members: [] }
      setInsuranceMembers(members ?? [])
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Kế hoạch Tháng</h1>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('prev')} className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400">‹</button>
            <span className="text-lg font-semibold text-gray-800 dark:text-gray-200 min-w-[120px] text-center">
              {MONTHS[month - 1]} {year}
            </span>
            <button onClick={() => navigate('next')} className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400">›</button>
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed top-4 right-4 z-50 px-4 py-3 bg-green-600 text-white text-sm font-medium rounded-lg shadow-lg">
            {toast}
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500">Đang tải...</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left col: salary + sections */}
            <div className="lg:col-span-2 space-y-6">
              <SalaryInput
                plan={plan}
                month={month}
                year={year}
                onPlanCreated={(p) => { setPlan(p); refetch() }}
                onPlanDeleted={() => {
                  const deletedMonth = MONTHS[month - 1]
                  const deletedYear = year
                  setPlan(null)
                  setInvestments([])
                  setSavings([])
                  setFixedExpenses([])
                  showToast(`Đã xóa bản ghi lương ${deletedMonth} ${deletedYear}`)
                }}
              />

              {plan ? (
                <>
                  <FundInvestmentsSection
                    plan={plan}
                    investments={investments}
                    funds={funds}
                    goals={goals}
                    onRefresh={refetch}
                    onToast={showToast}
                  />
                  <DirectSavingsSection
                    plan={plan}
                    savings={savings}
                    goals={goals}
                    onRefresh={refetch}
                    onToast={showToast}
                  />
                  <FixedExpensesSection
                    plan={plan}
                    fixedExpenses={fixedExpenses}
                    onRefresh={refetch}
                    onToast={showToast}
                  />
                  <InsuranceSection
                    plan={plan}
                    insuranceMembers={insuranceMembers}
                    onRefresh={refetch}
                    onToast={showToast}
                  />
                </>
              ) : (
                <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
                  Nhập lương tháng để bắt đầu lập kế hoạch.
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
                insuranceMembers={insuranceMembers}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
