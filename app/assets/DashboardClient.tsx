'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { NetWorthSkeleton, GoalSkeleton, InsuranceSkeleton } from './components/Skeletons'
import NetWorthCard from './components/NetWorthCard'
import GoalCard from './components/GoalCard'
import UnallocatedSection from './components/UnallocatedSection'
import InsuranceCard from './components/InsuranceCard'
import AssetAllocationPie from './components/AssetAllocationPie'

const FundDetailModal = dynamic(() => import('./components/FundDetailModal'))
const GoalPickerModal = dynamic(() => import('./components/GoalPickerModal'))
const GoldPriceWidget = dynamic(() => import('./components/GoldPriceWidget'))

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
const OVERVIEW_CACHE_KEY = 'dashboardOverviewCache'
const OVERVIEW_CACHE_TTL = 2 * 60 * 1000 // 2 minutes

function getCachedOverview(): DashboardData | null {
  try {
    const raw = localStorage.getItem(OVERVIEW_CACHE_KEY)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > OVERVIEW_CACHE_TTL) return null
    return data
  } catch { return null }
}

function setCachedOverview(data: DashboardData) {
  try { localStorage.setItem(OVERVIEW_CACHE_KEY, JSON.stringify({ data, ts: Date.now() })) } catch { /* ignore */ }
}

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
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')
  const tt = useTranslations('transactions')
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

  const fetchData = useCallback(async (opts?: { force?: boolean }) => {
    const cached = !opts?.force && getCachedOverview()
    if (cached) {
      setData(cached)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/dashboard/overview')
      if (!res.ok) {
        const { error: e } = await res.json()
        setError(e ?? tc('error'))
      } else {
        const json = await res.json()
        setData(json)
        setCachedOverview(json)
      }
    } catch {
      setError(tc('error'))
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
        await fetchData({ force: true })
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
        await fetchData({ force: true })
      }
    } catch {
      setNonFundAssignError('Unable to save. Please check your connection.')
    }
    setNonFundAssignLoading(false)
  }

  const isEmpty = data && data.goals.length === 0 && data.unallocated.funds.length === 0 && data.unallocated.nonFunds.length === 0 && data.insurance.length === 0

  const sortedGoals = data ? sortGoals(data.goals, sortOrder) : []

  // Compute asset allocation totals for pie chart
  const allocationTotals = data ? (() => {
    const fundTotal = [
      ...data.goals.flatMap((g) => g.funds),
      ...data.unallocated.funds,
    ].reduce((s, f) => s + f.currentValue, 0)
    const nonFundAll = data.unallocated.nonFunds
    const bankTotal = nonFundAll.filter((i) => i.type === 'bank').reduce((s, i) => s + i.currentValue, 0)
    const goldTotal = nonFundAll.filter((i) => i.type === 'gold').reduce((s, i) => s + i.currentValue, 0)
    const stockTotal = nonFundAll.filter((i) => i.type === 'stock').reduce((s, i) => s + i.currentValue, 0)
    const investedTotal = fundTotal + bankTotal + goldTotal + stockTotal
    const cashTotal = Math.max(data.netWorth.totalAssets - investedTotal, 0)
    return { fundTotal, bankTotal, goldTotal, stockTotal, cashTotal }
  })() : null

  // Find fund item for detail modal
  const allFunds = data ? [...data.unallocated.funds, ...data.goals.flatMap((g) => g.funds)] : []
  const detailFund = fundDetailId ? allFunds.find((f) => f.fundId === fundDetailId) : null

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Sort dropdown */}
            {!loading && data && (
              <select
                value={sortOrder}
                onChange={(e) => handleSortChange(e.target.value as SortOrder)}
                className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="manual">{t('sortManual')}</option>
                <option value="progress-desc">{t('sortProgressDesc')}</option>
                <option value="progress-asc">{t('sortProgressAsc')}</option>
                <option value="alpha">{t('sortAlpha')}</option>
              </select>
            )}
            <button
              onClick={() => fetchData({ force: true })}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? tc('loading') : tc('refresh')}
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center justify-between">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button onClick={() => fetchData({ force: true })} className="text-sm text-red-600 dark:text-red-400 font-medium hover:underline ml-4">{tc('tryAgain')}</button>
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
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t('empty')}</h2>
            <p className="text-gray-500 dark:text-gray-400 text-center max-w-sm mb-10">
              {t('emptyDesc')}
            </p>

            {/* Action cards */}
            <div className="w-full max-w-md space-y-3 mb-8">
              {[
                { icon: '🎯', title: t('addGoal'), desc: t('addGoalDesc') },
                { icon: '💰', title: t('addFund'), desc: t('addFundDesc') },
                { icon: '🛡️', title: t('addInsurance'), desc: t('addInsuranceDesc') },
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
              <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{t('orManage')}</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            </div>
            <a
              href="/settings"
              className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              {t('settingsLink')}
            </a>
          </div>
        )}

        {/* Gold price widget — shown whenever user has any gold investment */}
        {!loading && data?.netWorth.hasGold && (
          <div className="mb-6 rounded-xl overflow-hidden border border-amber-200 dark:border-amber-800/30 bg-gradient-to-r from-amber-50 to-amber-100 dark:from-amber-900/10 dark:to-amber-900/5">
            <GoldPriceWidget onRefresh={() => fetchData({ force: true })} />
          </div>
        )}

        {/* Dashboard content */}
        {!loading && data && !isEmpty && (
          <div className="space-y-8">
            {/* Net Worth + Asset Allocation */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <NetWorthCard {...data.netWorth} />
              </div>
              {allocationTotals && (
                <AssetAllocationPie
                  {...allocationTotals}
                  totalAssets={data.netWorth.totalAssets}
                />
              )}
            </div>

            {/* Goals */}
            {sortedGoals.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('sectionGoals')}</h2>
                  <Link
                    href="/settings?tab=goals"
                    className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    {t('addGoalBtn')}
                  </Link>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
                onRefresh={() => fetchData({ force: true })}
              />
            )}

            {/* Insurance */}
            {data.insurance.length > 0 && (
              <section>
                <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('sectionInsurance')}</h2>
                    <Link
                      href="/settings?tab=insurance"
                      className="text-sm px-3 py-1.5 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      {t('manageInsurance')}
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {data.insurance.map((ins) => (
                      <InsuranceCard key={ins.insuranceId} {...ins} onSavingsChange={() => fetchData({ force: true })} />
                    ))}
                  </div>
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
        const typeLabel = item ? (item.type === 'gold' ? tt('assetGold') : item.type === 'bank' ? tt('assetBank') : tt('assetStock')) : ''
        const label = item ? `${typeLabel} · ${new Date(item.investmentDate).toLocaleDateString('vi-VN')}` : ''
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
