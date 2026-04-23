'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
  notes: string | null
  units: number | null
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
  byType: { bank: number; gold: number; stock: number }
  insurance: InsuranceData[]
}

const OVERVIEW_CACHE_TTL = 2 * 60 * 1000 // 2 minutes

function overviewCacheKey(userId: string) { return `dashboardOverviewCache_${userId}` }

function getCachedOverview(userId: string): DashboardData | null {
  try {
    const raw = localStorage.getItem(overviewCacheKey(userId))
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > OVERVIEW_CACHE_TTL) return null
    return data
  } catch { return null }
}

function setCachedOverview(userId: string, data: DashboardData) {
  try { localStorage.setItem(overviewCacheKey(userId), JSON.stringify({ data, ts: Date.now() })) } catch { /* ignore */ }
}

// Fetch fund detail (purchase history) from investment_transactions
interface PurchaseHistory { purchase_date: string; units: number; nav_at_purchase: number }

export default function DashboardClient({ userId }: { userId: string }) {
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')
  const tt = useTranslations('transactions')
  const tg = useTranslations('goals')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fundDetailId, setFundDetailId] = useState<string | null>(null)
  const [goalPickerFundId, setGoalPickerFundId] = useState<string | null>(null)
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistory[]>([])
  const [nonFundPickerTxId, setNonFundPickerTxId] = useState<string | null>(null)
  const [nonFundAssignLoading, setNonFundAssignLoading] = useState(false)
  const [nonFundAssignError, setNonFundAssignError] = useState('')
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [goalName, setGoalName] = useState('')
  const [goalTarget, setGoalTarget] = useState('')
  const [goalDesc, setGoalDesc] = useState('')
  const [goalSaving, setGoalSaving] = useState(false)
  const [goalError, setGoalError] = useState('')
  const [sellFund, setSellFund] = useState<FundBreakdownItem | null>(null)
  const [sellDate, setSellDate] = useState('')
  const [sellUnits, setSellUnits] = useState('')
  const [sellAmount, setSellAmount] = useState('')
  const [sellSaving, setSellSaving] = useState(false)
  const [sellError, setSellError] = useState('')
  const [sellNonFund, setSellNonFund] = useState<NonFundUnallocatedItem | null>(null)
  const [nfDate, setNfDate] = useState('')
  const [nfPrincipal, setNfPrincipal] = useState('')
  const [nfUnits, setNfUnits] = useState('')
  const [nfAmount, setNfAmount] = useState('')
  const [nfSaving, setNfSaving] = useState(false)
  const [nfError, setNfError] = useState('')

  const fetchData = useCallback(async (opts?: { force?: boolean }) => {
    const cached = !opts?.force && getCachedOverview(userId)
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
        setCachedOverview(userId, json)
      }
    } catch {
      setError(tc('error'))
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchData() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fetchData])

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

  async function handleGoalSave() {
    setGoalError('')
    if (!goalName.trim()) { setGoalError('Goal name is required'); return }
    setGoalSaving(true)
    try {
      const res = await fetch('/api/v1/savings-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal_name: goalName.trim(),
          target_amount: goalTarget ? Number(goalTarget) : null,
          description: goalDesc.trim() || null,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        setGoalError(error ?? 'Could not save goal')
      } else {
        setShowGoalForm(false)
        setGoalName('')
        setGoalTarget('')
        setGoalDesc('')
        fetchData({ force: true })
      }
    } catch {
      setGoalError('Could not save goal')
    }
    setGoalSaving(false)
  }

  function openSellFund(fund: FundBreakdownItem) {
    setSellFund(fund)
    setSellDate(new Date().toISOString().slice(0, 10))
    setSellUnits('')
    setSellAmount('')
    setSellError('')
  }

  async function handleSellFundSubmit() {
    if (!sellFund) return
    const units = parseFloat(sellUnits)
    const amount = Number(sellAmount)
    if (!sellDate) { setSellError('Date is required'); return }
    if (!units || units <= 0) { setSellError('Units must be greater than 0'); return }
    if (units > sellFund.quantity) { setSellError('Units exceed available balance'); return }
    if (!amount || amount <= 0) { setSellError('Amount must be greater than 0'); return }

    setSellSaving(true)
    setSellError('')
    try {
      const principalWithdrawn = Math.round(units * sellFund.purchasePrice)
      const res = await fetch('/api/v1/investment-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_type: 'withdrawal',
          asset_type: 'fund',
          fund_id: sellFund.fundId,
          investment_date: sellDate,
          amount_vnd: Math.round(amount),
          units_withdrawn: units,
          principal_withdrawn: principalWithdrawn,
          goal_id: null,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        setSellError(error ?? 'Failed to record sale')
      } else {
        setSellFund(null)
        await fetchData({ force: true })
      }
    } catch {
      setSellError('Unable to save. Please check your connection.')
    }
    setSellSaving(false)
  }

  function openSellNonFund(item: NonFundUnallocatedItem) {
    setSellNonFund(item)
    setNfDate(new Date().toISOString().slice(0, 10))
    setNfPrincipal('')
    setNfUnits('')
    setNfAmount('')
    setNfError('')
  }

  async function handleSellNonFundSubmit() {
    if (!sellNonFund) return
    const date = nfDate
    if (!date) { setNfError('Date is required'); return }

    let principalWithdrawn: number
    let unitsWithdrawn: number | null = null
    let amountVnd: number

    if (sellNonFund.type === 'bank') {
      principalWithdrawn = parseFloat(nfPrincipal)
      amountVnd = parseFloat(nfAmount)
      if (!principalWithdrawn || principalWithdrawn <= 0) { setNfError('Principal withdrawn is required'); return }
      if (!amountVnd || amountVnd <= 0) { setNfError('Amount received is required'); return }
    } else {
      // gold
      const units = parseFloat(nfUnits)
      amountVnd = parseFloat(nfAmount)
      if (!units || units <= 0) { setNfError('Chi to sell is required'); return }
      if (!amountVnd || amountVnd <= 0) { setNfError('Amount received is required'); return }
      const originalPricePerUnit = sellNonFund.units && sellNonFund.units > 0
        ? sellNonFund.amount / sellNonFund.units : 0
      principalWithdrawn = Math.round(units * originalPricePerUnit)
      unitsWithdrawn = units
    }

    setNfSaving(true)
    setNfError('')
    try {
      const body: Record<string, unknown> = {
        transaction_type: 'withdrawal',
        asset_type: sellNonFund.type,
        parent_transaction_id: sellNonFund.transactionId,
        investment_date: date,
        amount_vnd: Math.round(amountVnd),
        principal_withdrawn: Math.round(principalWithdrawn),
        goal_id: null,
      }
      if (unitsWithdrawn !== null) body.units_withdrawn = unitsWithdrawn

      const res = await fetch('/api/v1/investment-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const { error } = await res.json()
        setNfError(error ?? 'Failed to record transaction')
      } else {
        setSellNonFund(null)
        await fetchData({ force: true })
      }
    } catch {
      setNfError('Unable to save. Please check your connection.')
    }
    setNfSaving(false)
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

  const sortedGoals = data ? data.goals : []

  // Compute asset allocation totals for pie chart
  const allocationTotals = data ? (() => {
    const fundTotal = [
      ...data.goals.flatMap((g) => g.funds),
      ...data.unallocated.funds,
    ].reduce((s, f) => s + f.currentValue, 0)
    const { bank: bankTotal, gold: goldTotal, stock: stockTotal } = data.byType
    const cashTotal = 0
    return { fundTotal, bankTotal, goldTotal, stockTotal, cashTotal }
  })() : null

  // Find fund item for detail modal
  const allFunds = data ? [...data.unallocated.funds, ...data.goals.flatMap((g) => g.funds)] : []
  const detailFund = fundDetailId ? allFunds.find((f) => f.fundId === fundDetailId) : null

  return (
    <div className="space-y-6">
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
                  <button
                    onClick={() => { setGoalName(''); setGoalTarget(''); setGoalDesc(''); setGoalError(''); setShowGoalForm(true) }}
                    className="flex items-center gap-2 h-9 px-4 bg-gray-950 hover:bg-gray-800 text-white text-sm font-bold rounded-md transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    {t('addGoalBtn')}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                onSellFund={openSellFund}
                onAssignNonFundToGoal={(txId) => setNonFundPickerTxId(txId)}
                onSellNonFund={openSellNonFund}
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
                      className="text-sm font-medium px-3 py-1.5 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      {t('manageInsurance')}
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {data.insurance.map((ins) => (
                      <InsuranceCard key={ins.insuranceId} {...ins} onSavingsChange={() => fetchData({ force: true })} />
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

      {/* Fund Detail Modal */}
      <FundDetailModal
        open={!!(fundDetailId && detailFund)}
        onOpenChange={(o) => { if (!o) { setFundDetailId(null); setPurchaseHistory([]) } }}
        fundId={detailFund?.fundId ?? ''}
        fundName={detailFund?.fundName ?? ''}
        currentNAV={detailFund?.currentNAV ?? 0}
        quantity={detailFund?.quantity ?? 0}
        currentValue={detailFund?.currentValue ?? 0}
        purchasePrice={detailFund?.purchasePrice ?? 0}
        profitLoss={detailFund?.profitLoss ?? 0}
        profitLossPercentage={detailFund?.profitLossPercentage ?? 0}
        purchaseHistory={purchaseHistory}
        onClose={() => { setFundDetailId(null); setPurchaseHistory([]) }}
      />

      {/* Goal Picker Modal — funds */}
      <GoalPickerModal
        open={!!(goalPickerFundId && data)}
        onOpenChange={(o) => { if (!o) { setGoalPickerFundId(null); setAssignError('') } }}
        fundId={goalPickerFundId ?? ''}
        fundName={allFunds.find((f) => f.fundId === goalPickerFundId)?.fundName ?? ''}
        goals={data ? data.goals.map((g) => ({
          id: g.goalId,
          name: g.goalName,
          targetAmount: g.targetAmount,
          currentValue: g.currentValue,
          progressPercent: g.progressPercentage,
        })) : []}
        onConfirm={(goalId) => goalPickerFundId && handleAssignToGoal(goalPickerFundId, goalId)}
        onCancel={() => { setGoalPickerFundId(null); setAssignError('') }}
        isLoading={assignLoading}
        error={assignError}
      />

      {/* Goal Picker Modal — non-funds (gold, bank, stock) */}
      {/* Add Goal Modal */}
      <Dialog open={showGoalForm} onOpenChange={(o) => { if (!o && !goalSaving) setShowGoalForm(false) }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{tg('createModal')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleGoalSave() }}>
            <div className="space-y-5 py-4">
              {goalError && <p className="text-sm text-red-600 dark:text-red-400">{goalError}</p>}
              <div className="space-y-2">
                <Label>{tg('nameLabel')} <span className="text-red-500">*</span></Label>
                <Input type="text" value={goalName} onChange={(e) => setGoalName(e.target.value)} placeholder={tg('namePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{tg('targetLabel')}</Label>
                <Input type="text" inputMode="numeric" value={goalTarget ? Number(goalTarget).toLocaleString('en-US') : ''} onChange={(e) => setGoalTarget(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))} placeholder={tg('targetPlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{tg('descLabel')}</Label>
                <Textarea value={goalDesc} onChange={(e) => setGoalDesc(e.target.value)} placeholder={tg('descPlaceholder')} rows={3} />
              </div>
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowGoalForm(false)}>{tc('cancel')}</Button>
              <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={goalSaving}>
                {goalSaving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {goalSaving ? tc('saving') : tc('save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Sell Unallocated Fund Modal */}
      <Dialog open={!!sellFund} onOpenChange={(o) => { if (!o && !sellSaving) setSellFund(null) }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{tg('sellModal')} — {sellFund?.fundName}</DialogTitle>
          </DialogHeader>
          {sellFund && (() => {
            const units = parseFloat(sellUnits) || 0
            const nav = sellFund.currentNAV
            const avgCost = sellFund.purchasePrice
            const costBasis = Math.round(units * avgCost)
            const estimatedAmount = Math.round(units * nav)
            const parsedAmount = Number(sellAmount) || 0
            const gain = parsedAmount - costBasis
            const remaining = sellFund.quantity - units
            const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
            return (
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{tg('colCurrentNav')}</p>
                    <p className="font-medium text-gray-900 dark:text-gray-100">{fmt(nav)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{tg('colAvgNav')}</p>
                    <p className="font-medium text-gray-900 dark:text-gray-100">{fmt(avgCost)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{tg('colRemaining')}</p>
                    <p className="font-medium text-gray-900 dark:text-gray-100">{sellFund.quantity.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {tg('unitsShort')}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{tg('dateSellLabel')}</Label>
                  <Input type="date" value={sellDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setSellDate(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>{tg('unitsToSellFund')}</Label>
                  <Input
                    type="number"
                    value={sellUnits}
                    min={0}
                    max={sellFund.quantity}
                    step="0.01"
                    placeholder="0.00"
                    onChange={(e) => {
                      setSellUnits(e.target.value)
                      const u = parseFloat(e.target.value) || 0
                      if (u > 0) setSellAmount(String(Math.round(u * nav)))
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{tg('amountReceivedLabel')}</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={sellAmount ? Number(sellAmount).toLocaleString('en-US') : ''}
                    placeholder="0"
                    onChange={(e) => {
                      const raw = e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '')
                      setSellAmount(raw)
                      const a = Number(raw) || 0
                      if (a > 0 && nav > 0) setSellUnits(String(Math.round((a / nav) * 100) / 100))
                    }}
                  />
                </div>

                {units > 0 && (
                  <div className="text-sm bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">{tg('costBasisLabel')}</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(costBasis)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 dark:text-gray-400">{tg('receivedLabel')}</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(parsedAmount || estimatedAmount)}</span>
                    </div>
                    <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-1 mt-1">
                      <span className="text-gray-500 dark:text-gray-400">P&amp;L</span>
                      <span className={`font-semibold ${gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {gain >= 0 ? '+' : ''}{fmt(gain)}
                      </span>
                    </div>
                    {remaining >= 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">{tg('colRemaining')}</span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">{remaining.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {tg('unitsShort')}</span>
                      </div>
                    )}
                  </div>
                )}

                {sellError && <p className="text-sm text-red-600 dark:text-red-400">{sellError}</p>}

                <div className="flex gap-3 pt-1">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setSellFund(null)} disabled={sellSaving}>{tc('cancel')}</Button>
                  <Button type="button" className="flex-1 bg-amber-600 hover:bg-amber-700" disabled={sellSaving || !sellUnits || !sellAmount} onClick={handleSellFundSubmit}>
                    {sellSaving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />}
                    {sellSaving ? tc('saving') : tg('sell')}
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Sell / Withdraw Non-Fund (bank/gold) Modal */}
      <Dialog open={!!sellNonFund} onOpenChange={(o) => { if (!o && !nfSaving) setSellNonFund(null) }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {sellNonFund?.type === 'bank' ? tg('withdrawBankModal') : tg('sellGoldModal')}
              {sellNonFund?.notes ? ` — ${sellNonFund.notes}` : ''}
            </DialogTitle>
          </DialogHeader>
          {sellNonFund && (() => {
            const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
            const isBank = sellNonFund.type === 'bank'
            const originalPricePerUnit = sellNonFund.units && sellNonFund.units > 0
              ? sellNonFund.amount / sellNonFund.units : 0
            const currentPricePerUnit = sellNonFund.units && sellNonFund.units > 0
              ? sellNonFund.currentValue / sellNonFund.units : 0
            const nfUnitsNum = parseFloat(nfUnits) || 0
            const nfAmountNum = parseFloat(nfAmount) || 0
            const nfPrincipalNum = parseFloat(nfPrincipal) || 0

            // bank: gain = amountReceived - principalWithdrawn
            const bankGain = nfAmountNum - nfPrincipalNum
            const bankRemaining = sellNonFund.amount - nfPrincipalNum

            // gold: cost basis = units × original price, gain = amount - cost basis
            const goldCostBasis = Math.round(nfUnitsNum * originalPricePerUnit)
            const goldGain = nfAmountNum - goldCostBasis
            const goldRemaining = (sellNonFund.units ?? 0) - nfUnitsNum

            return (
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                  {isBank ? (
                    <>
                      <div>
                        <p className="text-gray-500 dark:text-gray-400">{tg('principalLabel')}</p>
                        <p className="font-medium text-gray-900 dark:text-gray-100">{fmt(sellNonFund.amount)}</p>
                      </div>
                      {sellNonFund.interestRate != null && (
                        <div>
                          <p className="text-gray-500 dark:text-gray-400">{tg('perYearShort')}</p>
                          <p className="font-medium text-gray-900 dark:text-gray-100">{sellNonFund.interestRate}%</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="text-gray-500 dark:text-gray-400">{tg('colRemaining')}</p>
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {(sellNonFund.units ?? 0).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} chi
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500 dark:text-gray-400">{tg('currentPriceLabel')}</p>
                        <p className="font-medium text-gray-900 dark:text-gray-100">{fmt(currentPricePerUnit)}/chi</p>
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{isBank ? tg('dateWithdrawLabel') : tg('dateSellLabel')}</Label>
                  <Input type="date" value={nfDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setNfDate(e.target.value)} />
                </div>

                {isBank ? (
                  <>
                    <div className="space-y-2">
                      <Label>{tg('principalWithdrawnLabel')}</Label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={nfPrincipal ? Number(nfPrincipal).toLocaleString('en-US') : ''}
                        placeholder={tg('principalWithdrawnPlaceholder')}
                        onChange={(e) => setNfPrincipal(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{tg('amountReceivedLabel')}</Label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={nfAmount ? Number(nfAmount).toLocaleString('en-US') : ''}
                        placeholder={tg('amountReceivedPlaceholder')}
                        onChange={(e) => setNfAmount(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))}
                      />
                    </div>
                    {nfPrincipalNum > 0 && nfAmountNum > 0 && (
                      <div className="text-sm bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 space-y-1">
                        <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-1">
                          <span className="text-gray-500 dark:text-gray-400">P&amp;L</span>
                          <span className={`font-semibold ${bankGain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {bankGain >= 0 ? '+' : ''}{fmt(bankGain)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500 dark:text-gray-400">{tg('remainingPrincipalLabel')}</span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(Math.max(bankRemaining, 0))}</span>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>{tg('unitsToSellGold')}</Label>
                      <Input
                        type="number"
                        value={nfUnits}
                        min={0}
                        max={sellNonFund.units ?? undefined}
                        step="0.01"
                        placeholder="0.00"
                        onChange={(e) => {
                          setNfUnits(e.target.value)
                          const u = parseFloat(e.target.value) || 0
                          if (u > 0) setNfAmount(String(Math.round(u * currentPricePerUnit)))
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{tg('amountReceivedLabel')}</Label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={nfAmount ? Number(nfAmount).toLocaleString('en-US') : ''}
                        placeholder="0"
                        onChange={(e) => {
                          const raw = e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '')
                          setNfAmount(raw)
                          const a = Number(raw) || 0
                          if (a > 0 && currentPricePerUnit > 0) setNfUnits(String(Math.round((a / currentPricePerUnit) * 100) / 100))
                        }}
                      />
                    </div>
                    {nfUnitsNum > 0 && (
                      <div className="text-sm bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 space-y-1">
                        <div className="flex justify-between">
                          <span className="text-gray-500 dark:text-gray-400">{tg('costBasisLabel')}</span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(goldCostBasis)}</span>
                        </div>
                        <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-1 mt-1">
                          <span className="text-gray-500 dark:text-gray-400">P&amp;L</span>
                          <span className={`font-semibold ${goldGain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {goldGain >= 0 ? '+' : ''}{fmt(goldGain)}
                          </span>
                        </div>
                        {goldRemaining >= 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-500 dark:text-gray-400">{tg('remainingChiLabel')}</span>
                            <span className="font-medium text-gray-900 dark:text-gray-100">
                              {goldRemaining.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} chi
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {nfError && <p className="text-sm text-red-600 dark:text-red-400">{nfError}</p>}

                <div className="flex gap-3 pt-1">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setSellNonFund(null)} disabled={nfSaving}>{tc('cancel')}</Button>
                  <Button type="button" className="flex-1 bg-amber-600 hover:bg-amber-700" disabled={nfSaving} onClick={handleSellNonFundSubmit}>
                    {nfSaving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />}
                    {nfSaving ? tc('saving') : (isBank ? tg('withdraw') : tg('sell'))}
                  </Button>
                </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      {(() => {
        const item = data?.unallocated.nonFunds.find((i) => i.transactionId === nonFundPickerTxId)
        const typeLabel = item ? (item.type === 'gold' ? tt('assetGold') : item.type === 'bank' ? tt('assetBank') : tt('assetStock')) : ''
        const label = item ? `${typeLabel} · ${new Date(item.investmentDate).toLocaleDateString('vi-VN')}` : ''
        return (
          <GoalPickerModal
            open={!!(nonFundPickerTxId && data)}
            onOpenChange={(o) => { if (!o) { setNonFundPickerTxId(null); setNonFundAssignError('') } }}
            fundId={nonFundPickerTxId ?? ''}
            fundName={label}
            goals={data ? data.goals.map((g) => ({
              id: g.goalId,
              name: g.goalName,
              targetAmount: g.targetAmount,
              currentValue: g.currentValue,
              progressPercent: g.progressPercentage,
            })) : []}
            onConfirm={(goalId) => nonFundPickerTxId && handleAssignNonFundToGoal(nonFundPickerTxId, goalId)}
            onCancel={() => { setNonFundPickerTxId(null); setNonFundAssignError('') }}
            isLoading={nonFundAssignLoading}
            error={nonFundAssignError}
          />
        )
      })()}
    </div>
  )
}
