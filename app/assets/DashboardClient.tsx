'use client'

import { useState, useEffect, useCallback } from 'react'
import { NetWorthSkeleton, GoalSkeleton, InsuranceSkeleton } from './components/Skeletons'
import NetWorthCard from './components/NetWorthCard'
import GoalCard from './components/GoalCard'
import UnallocatedSection from './components/UnallocatedSection'
import InsuranceCard from './components/InsuranceCard'
import FundDetailModal from './components/FundDetailModal'
import GoalPickerModal from './components/GoalPickerModal'

export interface FundBreakdownItem {
  fundId: string
  fundName: string
  quantity: number
  currentNAV: number
  currentValue: number
  purchasePrice: number
  profitLoss: number
  profitLossPercentage: number
  goalId: string | null
}

export interface GoalData {
  goalId: string
  goalName: string
  targetAmount: number | null
  currentValue: number
  totalInvested: number
  profitLoss: number
  profitLossPercentage: number
  progressPercentage: number | null
  funds: FundBreakdownItem[]
}

export interface InsuranceData {
  insuranceId: string
  insuranceName: string
  coverageType: string | null
  annualPremium: number
  amountSaved: number
  savingsProgressPercentage: number
  status: 'on_track' | 'upcoming' | 'overdue' | 'completed'
  nextPaymentDate: string | null
}

export interface DashboardData {
  netWorth: {
    totalAssets: number
    totalLiabilities: number
    netWorth: number
    totalInvested: number
    currentValue: number
    overallProfitLoss: number
    overallProfitLossPercentage: number
    navStale: boolean
  }
  goals: GoalData[]
  unallocated: { totalValue: number; funds: FundBreakdownItem[] }
  insurance: InsuranceData[]
}

type SortOrder = 'manual' | 'progress-desc' | 'progress-asc' | 'alpha'

const SORT_KEY = 'assetsSortOrder'

function sortGoals(goals: GoalData[], order: SortOrder): GoalData[] {
  const copy = [...goals]
  switch (order) {
    case 'progress-desc':
      return copy.sort((a, b) => (b.progressPercentage ?? 0) - (a.progressPercentage ?? 0))
    case 'progress-asc':
      return copy.sort((a, b) => (a.progressPercentage ?? 0) - (b.progressPercentage ?? 0))
    case 'alpha':
      return copy.sort((a, b) => a.goalName.localeCompare(b.goalName))
    default:
      return copy
  }
}

// Fetch fund detail (purchase history) from fund_investments
interface PurchaseHistory { purchase_date: string; units: number; nav_at_purchase: number }

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('manual')
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null)
  const [fundDetailId, setFundDetailId] = useState<string | null>(null)
  const [goalPickerFundId, setGoalPickerFundId] = useState<string | null>(null)
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistory[]>([])

  // Load sort preference from localStorage
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(SORT_KEY) : null
    if (saved) setSortOrder(saved as SortOrder)
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/dashboard/overview')
      if (!res.ok) {
        const { error: e } = await res.json()
        setError(e ?? 'Failed to load dashboard data.')
      } else {
        setData(await res.json())
      }
    } catch {
      setError('Unable to load data. Please check your connection and try again.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function handleSortChange(order: SortOrder) {
    setSortOrder(order)
    localStorage.setItem(SORT_KEY, order)
  }

  function handleToggleExpand(goalId: string) {
    setExpandedGoalId((prev) => (prev === goalId ? null : goalId))
  }

  async function handleFundClick(fundId: string) {
    setFundDetailId(fundId)
    // Fetch purchase history for this fund
    try {
      const res = await fetch(`/api/v1/fund-investments?fund_id=${fundId}`)
      if (res.ok) {
        const items = await res.json()
        setPurchaseHistory(
          (items as Array<{ nav_at_purchase: number; units_purchased: number; created_at: string }>)
            .map((i) => ({ purchase_date: i.created_at, units: i.units_purchased, nav_at_purchase: i.nav_at_purchase }))
            .sort((a, b) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime())
        )
      }
    } catch { /* ignore — show modal without history */ }
  }

  async function handleAssignToGoal(fundId: string, goalId: string) {
    if (!data) return
    setAssignLoading(true)
    setAssignError('')

    // Optimistic update — find all investments for this fund and move to goal
    const prevData = data
    const movedFund = [...data.unallocated.funds, ...data.goals.flatMap((g) => g.funds)]
      .find((f) => f.fundId === fundId)

    if (movedFund) {
      const targetGoal = data.goals.find((g) => g.goalId === goalId)
      if (targetGoal) {
        setData({
          ...data,
          unallocated: {
            ...data.unallocated,
            funds: data.unallocated.funds.filter((f) => f.fundId !== fundId),
            totalValue: data.unallocated.totalValue - movedFund.currentValue,
          },
          goals: data.goals.map((g) =>
            g.goalId === goalId
              ? { ...g, funds: [...g.funds, { ...movedFund, goalId }], currentValue: g.currentValue + movedFund.currentValue }
              : { ...g, funds: g.funds.filter((f) => f.fundId !== fundId) }
          ),
        })
      }
    }

    // Find the actual investment IDs for this fund (we need to PATCH each one)
    try {
      const res = await fetch(`/api/v1/fund-investments?fund_id=${fundId}`)
      if (res.ok) {
        const investments = await res.json() as Array<{ id: string }>
        await Promise.all(
          investments.map((inv) =>
            fetch(`/api/v1/fund-investments/${inv.id}/goal`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ goal_id: goalId }),
            })
          )
        )
        setGoalPickerFundId(null)
      } else {
        setData(prevData)
        setAssignError('Failed to reassign fund. Please try again.')
      }
    } catch {
      setData(prevData)
      setAssignError('Unable to save. Please check your connection and try again.')
    }
    setAssignLoading(false)
  }

  const isEmpty = data && data.goals.length === 0 && data.unallocated.funds.length === 0 && data.insurance.length === 0

  const sortedGoals = data ? sortGoals(data.goals, sortOrder) : []

  // Find fund item for detail modal
  const allFunds = data ? [...data.unallocated.funds, ...data.goals.flatMap((g) => g.funds)] : []
  const detailFund = fundDetailId ? allFunds.find((f) => f.fundId === fundDetailId) : null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Assets Dashboard</h1>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Sort dropdown */}
            {!loading && data && (
              <select
                value={sortOrder}
                onChange={(e) => handleSortChange(e.target.value as SortOrder)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="manual">Manual Order</option>
                <option value="progress-desc">Progress: High to Low</option>
                <option value="progress-asc">Progress: Low to High</option>
                <option value="alpha">Alphabetical (A-Z)</option>
              </select>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={fetchData} className="text-sm text-red-600 font-medium hover:underline ml-4">Retry</button>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-6">
            <NetWorthSkeleton />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <GoalSkeleton />
              <GoalSkeleton />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InsuranceSkeleton />
              <InsuranceSkeleton />
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && isEmpty && (
          <div className="flex flex-col items-center py-16 px-4">
            {/* Icon */}
            <div className="w-20 h-20 rounded-2xl bg-indigo-50 flex items-center justify-center mb-6">
              <span className="text-4xl">📊</span>
            </div>

            {/* Title & description */}
            <h2 className="text-2xl font-bold text-gray-900 mb-2">No Assets Yet</h2>
            <p className="text-gray-500 text-center max-w-sm mb-10">
              Start by adding financial goals, investment funds, or insurance to track your wealth.
            </p>

            {/* Action cards */}
            <div className="w-full max-w-md space-y-3 mb-8">
              {[
                { icon: '🎯', title: 'Add Financial Goal', desc: 'Create a savings or investment target' },
                { icon: '💰', title: 'Add Investment Fund', desc: 'Record your funds and certificates' },
                { icon: '🛡️', title: 'Add Insurance', desc: 'Manage your insurance policies' },
              ].map(({ icon, title, desc }) => (
                <a
                  key={title}
                  href="/settings"
                  className="flex items-center gap-4 bg-white border border-gray-100 rounded-xl px-5 py-4 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all group"
                >
                  <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0 text-xl">
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm">{title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </div>
                  <span className="text-gray-300 group-hover:text-indigo-500 transition-colors text-lg">→</span>
                </a>
              ))}
            </div>

            {/* Divider + Settings button */}
            <div className="flex items-center gap-3 w-full max-w-md mb-5">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400 whitespace-nowrap">Or manage everything in</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <a
              href="/settings"
              className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Settings
            </a>
          </div>
        )}

        {/* Dashboard content */}
        {!loading && data && !isEmpty && (
          <div className="space-y-8">
            {/* Net Worth */}
            <NetWorthCard {...data.netWorth} />

            {/* Goals */}
            {sortedGoals.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Goals</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {sortedGoals.map((goal) => (
                    <GoalCard
                      key={goal.goalId}
                      {...goal}
                      isExpanded={expandedGoalId === goal.goalId}
                      onToggleExpand={handleToggleExpand}
                      onFundClick={handleFundClick}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Unallocated */}
            {data.unallocated.funds.length > 0 && (
              <UnallocatedSection
                unallocatedAmount={data.unallocated.totalValue}
                funds={data.unallocated.funds}
                onFundClick={handleFundClick}
                onAssignToGoal={(fundId) => setGoalPickerFundId(fundId)}
              />
            )}

            {/* Insurance */}
            {data.insurance.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Insurance</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {data.insurance.map((ins) => (
                    <InsuranceCard key={ins.insuranceId} {...ins} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Fund Detail Modal */}
      {fundDetailId && detailFund && (
        <FundDetailModal
          fundId={detailFund.fundId}
          fundName={detailFund.fundName}
          currentNAV={detailFund.currentNAV}
          quantity={detailFund.quantity}
          currentValue={detailFund.currentValue}
          purchasePrice={detailFund.purchasePrice}
          profitLoss={detailFund.profitLoss}
          profitLossPercentage={detailFund.profitLossPercentage}
          purchaseHistory={purchaseHistory}
          onClose={() => { setFundDetailId(null); setPurchaseHistory([]) }}
        />
      )}

      {/* Goal Picker Modal */}
      {goalPickerFundId && data && (
        <GoalPickerModal
          fundId={goalPickerFundId}
          fundName={allFunds.find((f) => f.fundId === goalPickerFundId)?.fundName ?? ''}
          goals={data.goals.map((g) => ({
            id: g.goalId,
            name: g.goalName,
            targetAmount: g.targetAmount,
            currentValue: g.currentValue,
            progressPercent: g.progressPercentage,
          }))}
          onConfirm={(goalId) => handleAssignToGoal(goalPickerFundId, goalId)}
          onCancel={() => { setGoalPickerFundId(null); setAssignError('') }}
          isLoading={assignLoading}
          error={assignError}
        />
      )}
    </div>
  )
}
