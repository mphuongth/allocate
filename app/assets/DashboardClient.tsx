'use client'

import { useState, useEffect, useCallback } from 'react'
import { NetWorthSkeleton, GoalSkeleton, InsuranceSkeleton } from './components/Skeletons'
import NetWorthCard from './components/NetWorthCard'
import GoalCard from './components/GoalCard'
import UnallocatedSection from './components/UnallocatedSection'
import InsuranceCard from './components/InsuranceCard'
import FundDetailModal from './components/FundDetailModal'
import GoalPickerModal from './components/GoalPickerModal'
import GoldPriceWidget from './components/GoldPriceWidget'

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
  lastPaymentDate: string | null
}

export interface NonFundUnallocatedItem {
  transactionId: string
  type: string
  amount: number
  currentValue: number
  interestRate: number | null
  expiryDate: string | null
  investmentDate: string
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
    hasGold: boolean
  }
  goals: GoalData[]
  unallocated: { totalValue: number; funds: FundBreakdownItem[]; nonFunds: NonFundUnallocatedItem[] }
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

// Fetch fund detail (purchase history) from investment_transactions
interface PurchaseHistory { purchase_date: string; units: number; nav_at_purchase: number }

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('manual')
  const [fundDetailId, setFundDetailId] = useState<string | null>(null)
  const [goalPickerFundId, setGoalPickerFundId] = useState<string | null>(null)
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistory[]>([])
  const [nonFundPickerTxId, setNonFundPickerTxId] = useState<string | null>(null)
  const [nonFundAssignLoading, setNonFundAssignLoading] = useState(false)
  const [nonFundAssignError, setNonFundAssignError] = useState('')

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
        setError(e ?? 'Không thể tải dữ liệu.')
      } else {
        setData(await res.json())
      }
    } catch {
      setError('Không thể tải dữ liệu. Vui lòng kiểm tra kết nối và thử lại.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function handleSortChange(order: SortOrder) {
    setSortOrder(order)
    localStorage.setItem(SORT_KEY, order)
  }

  async function handleFundClick(fundId: string) {
    setFundDetailId(fundId)
    // Fetch purchase history for this fund
    try {
      const res = await fetch(`/api/v1/fund-investments?fund_id=${fundId}`)
      if (res.ok) {
        const items = await res.json()
        setPurchaseHistory(
          (items as Array<{ nav_at_purchase: number; units_purchased: number; investment_date: string | null; created_at: string }>)
            .map((i) => ({ purchase_date: i.investment_date ?? i.created_at, units: i.units_purchased, nav_at_purchase: i.nav_at_purchase }))
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

  async function handleAssignNonFundToGoal(txId: string, goalId: string) {
    setNonFundAssignLoading(true)
    setNonFundAssignError('')
    try {
      const res = await fetch(`/api/v1/investment-transactions/${txId}/assign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: goalId }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        setNonFundAssignError(error ?? 'Failed to assign. Please try again.')
      } else {
        setNonFundPickerTxId(null)
        await fetchData()
      }
    } catch {
      setNonFundAssignError('Unable to save. Please check your connection.')
    }
    setNonFundAssignLoading(false)
  }

  const isEmpty = data && data.goals.length === 0 && data.unallocated.funds.length === 0 && data.unallocated.nonFunds.length === 0 && data.insurance.length === 0

  const sortedGoals = data ? sortGoals(data.goals, sortOrder) : []

  // Find fund item for detail modal
  const allFunds = data ? [...data.unallocated.funds, ...data.goals.flatMap((g) => g.funds)] : []
  const detailFund = fundDetailId ? allFunds.find((f) => f.fundId === fundDetailId) : null

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Tổng Quan Tài Sản</h1>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Sort dropdown */}
            {!loading && data && (
              <select
                value={sortOrder}
                onChange={(e) => handleSortChange(e.target.value as SortOrder)}
                className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="manual">Sắp xếp thủ công</option>
                <option value="progress-desc">Tiến độ: Cao → Thấp</option>
                <option value="progress-asc">Tiến độ: Thấp → Cao</option>
                <option value="alpha">Theo bảng chữ cái (A-Z)</option>
              </select>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Đang tải...' : 'Làm mới'}
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center justify-between">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button onClick={fetchData} className="text-sm text-red-600 dark:text-red-400 font-medium hover:underline ml-4">Thử lại</button>
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
            <div className="w-20 h-20 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center mb-6">
              <span className="text-4xl">📊</span>
            </div>

            {/* Title & description */}
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Chưa có tài sản nào</h2>
            <p className="text-gray-500 dark:text-gray-400 text-center max-w-sm mb-10">
              Bắt đầu bằng cách thêm mục tiêu tài chính, quỹ đầu tư hoặc bảo hiểm để theo dõi tài sản.
            </p>

            {/* Action cards */}
            <div className="w-full max-w-md space-y-3 mb-8">
              {[
                { icon: '🎯', title: 'Thêm Mục tiêu Tài chính', desc: 'Tạo mục tiêu tiết kiệm hoặc đầu tư' },
                { icon: '💰', title: 'Thêm Quỹ Đầu tư', desc: 'Ghi lại các quỹ và chứng chỉ của bạn' },
                { icon: '🛡️', title: 'Thêm Bảo hiểm', desc: 'Quản lý các hợp đồng bảo hiểm' },
              ].map(({ icon, title, desc }) => (
                <a
                  key={title}
                  href="/settings"
                  className="flex items-center gap-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-xl px-5 py-4 shadow-sm hover:shadow-md hover:border-indigo-100 dark:hover:border-indigo-700 transition-all group"
                >
                  <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center flex-shrink-0 text-xl">
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
                  </div>
                  <span className="text-gray-300 dark:text-gray-600 group-hover:text-indigo-500 transition-colors text-lg">→</span>
                </a>
              ))}
            </div>

            {/* Divider + Settings button */}
            <div className="flex items-center gap-3 w-full max-w-md mb-5">
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">Hoặc quản lý mọi thứ trong</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            </div>
            <a
              href="/settings"
              className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Settings
            </a>
          </div>
        )}

        {/* Gold price widget — shown whenever user has any gold investment */}
        {!loading && data?.netWorth.hasGold && (
          <div className="mb-6 rounded-xl overflow-hidden border border-amber-100 dark:border-amber-800/30">
            <GoldPriceWidget onRefresh={fetchData} />
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
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Mục tiêu</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {sortedGoals.map((goal) => (
                    <GoalCard
                      key={goal.goalId}
                      {...goal}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Unallocated */}
            {(data.unallocated.funds.length > 0 || data.unallocated.nonFunds.length > 0) && (
              <UnallocatedSection
                unallocatedAmount={data.unallocated.totalValue}
                funds={data.unallocated.funds}
                nonFunds={data.unallocated.nonFunds}
                onFundClick={handleFundClick}
                onAssignToGoal={(fundId) => setGoalPickerFundId(fundId)}
                onAssignNonFundToGoal={(txId) => setNonFundPickerTxId(txId)}
                onRefresh={fetchData}
              />
            )}

            {/* Insurance */}
            {data.insurance.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Bảo hiểm</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {data.insurance.map((ins) => (
                    <InsuranceCard key={ins.insuranceId} {...ins} onSavingsChange={fetchData} />
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

      {/* Goal Picker Modal — funds */}
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

      {/* Goal Picker Modal — non-funds (gold, bank, stock) */}
      {nonFundPickerTxId && data && (() => {
        const item = data.unallocated.nonFunds.find((i) => i.transactionId === nonFundPickerTxId)
        const label = item ? `${item.type === 'gold' ? 'Vàng' : item.type === 'bank' ? 'Ngân hàng' : 'Cổ phiếu'} · ${new Date(item.investmentDate).toLocaleDateString('vi-VN')}` : ''
        return (
          <GoalPickerModal
            fundId={nonFundPickerTxId}
            fundName={label}
            goals={data.goals.map((g) => ({
              id: g.goalId,
              name: g.goalName,
              targetAmount: g.targetAmount,
              currentValue: g.currentValue,
              progressPercent: g.progressPercentage,
            }))}
            onConfirm={(goalId) => handleAssignNonFundToGoal(nonFundPickerTxId, goalId)}
            onCancel={() => { setNonFundPickerTxId(null); setNonFundAssignError('') }}
            isLoading={nonFundAssignLoading}
            error={nonFundAssignError}
          />
        )
      })()}
    </div>
  )
}
