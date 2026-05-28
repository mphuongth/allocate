'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { fmt } from '@/lib/formatters'
import { Plus, ArrowDownToLine, ChevronDown, Check } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { useNavigation } from '@/app/components/navigation/NavigationContext'
import dynamic from 'next/dynamic'
import { CreateGoalSheet } from './components/CreateGoalSheet'
import { NetWorthSkeleton, GoalSkeleton, InsuranceSkeleton } from './components/Skeletons'
import NetWorthCard from './components/NetWorthCard'
import GoalCard from './components/GoalCard'
import UnallocatedSection from './components/UnallocatedSection'
import InsuranceCard from './components/InsuranceCard'
import InsuranceDetailSheet from './components/InsuranceDetailSheet'
import { SellWithdrawSheet, type SellItem } from './components/SellWithdrawSheet'
import GoalDetailSheet from './components/GoalDetailSheet'
import AssignGoalSheet from './components/AssignGoalSheet'
import DownloadReportSheet from './components/DownloadReportSheet'
import AddTransactionSheet from './components/AddTransactionSheet'

const GoldPriceWidget = dynamic(() => import('./components/GoldPriceWidget'))
import TransactionHistorySheet from './components/TransactionHistorySheet'
import DesktopNetWorthPanel from './components/DesktopNetWorthPanel'
import DesktopGoalCard from './components/DesktopGoalCard'
import DesktopInsuranceList from './components/DesktopInsuranceList'
import DesktopInsuranceDetail from './components/DesktopInsuranceDetail'
import AddInsuranceMemberModal from './components/AddInsuranceMemberModal'
import DesktopGoalDetail from './components/DesktopGoalDetail'

export interface FundBreakdownItem {
  fundId: string
  fundName: string
  fundType: string
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
  targetDate: string | null
  currentValue: number
  totalInvested: number
  profitLoss: number
  profitLossPercentage: number
  progressPercentage: number | null
  transactionCount: number
  funds: FundBreakdownItem[]
}

export interface InsuranceData {
  insuranceId: string
  insuranceName: string
  coverageType: string | null
  annualPremium: number
  amountSaved: number
  savingsProgressPercentage: number
  status: 'on_track' | 'upcoming' | 'overdue' | 'completed' | 'ready'
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
    navUpdatedAt: string | null
  }
  goals: GoalData[]
  unallocated: { totalValue: number; funds: FundBreakdownItem[]; nonFunds: NonFundUnallocatedItem[] }
  byType: { bank: number; gold: number; stock: number }
  goldUnits?: number
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

type SortValue = 'manual' | 'progressDesc' | 'progressAsc' | 'alpha'

function SortDropdown({ value, onChange, options }: {
  value: SortValue
  onChange: (v: SortValue) => void
  options: { value: SortValue; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 13, padding: '5px 10px', cursor: 'pointer',
          background: 'var(--c-card)', border: '1px solid var(--c-line)',
          borderRadius: 8, color: 'var(--c-ink)', fontFamily: 'inherit', fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
      >
        {current?.label}
        <ChevronDown size={12} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 50,
          background: 'var(--c-card)', border: '1px solid var(--c-line)',
          borderRadius: 10, boxShadow: 'var(--shadow-pop)',
          minWidth: 160, overflow: 'hidden',
        }}>
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '10px 14px', border: 'none', cursor: 'pointer',
                background: o.value === value ? 'var(--c-navy-tint)' : 'transparent',
                color: o.value === value ? 'var(--c-navy)' : 'var(--c-ink)',
                fontSize: 14, fontFamily: 'inherit', fontWeight: o.value === value ? 600 : 400,
                textAlign: 'left',
              }}
            >
              {o.label}
              {o.value === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function fmtTimeAgo(isoString: string, locale: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diffMs / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const isVi = locale === 'vi'
  if (days > 0) return isVi ? `${days} ngày trước` : `${days}d ago`
  if (hours > 0) return isVi ? `${hours} giờ trước` : `${hours}h ago`
  return isVi ? `${mins} phút trước` : `${mins}m ago`
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    function check() { setIsDesktop(window.innerWidth >= 768) }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return isDesktop
}

export default function DashboardClient({ userId }: { userId: string }) {
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')
  const tg = useTranslations('goals')
  const locale = useLocale()
  const { userName, setMobileTopBar } = useNavigation()
  const isDesktop = useIsDesktop()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fundDetailId, setFundDetailId] = useState<string | null>(null)
  const [goalPickerFundId, setGoalPickerFundId] = useState<string | null>(null)
  const [goalPickerFundItem, setGoalPickerFundItem] = useState<{ name: string; value: number; type: string } | null>(null)
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [nonFundPickerTxId, setNonFundPickerTxId] = useState<string | null>(null)
  const [nonFundPickerItem, setNonFundPickerItem] = useState<{ name: string; value: number; type: string } | null>(null)
  const [nonFundAssignLoading, setNonFundAssignLoading] = useState(false)
  const [nonFundAssignError, setNonFundAssignError] = useState('')
  const [goalSort, setGoalSort] = useState<SortValue>('manual')
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [sellItem, setSellItem] = useState<SellItem | null>(null)
  const [sellSheetOpen, setSellSheetOpen] = useState(false)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [historyKey, setHistoryKey] = useState(0)
  const [pullY, setPullY] = useState(0)
  // Track the goal by id rather than by object reference. When fetchData
  // refreshes data.goals (e.g. after an Unallocated → Assign-to-goal flow),
  // selectedGoal automatically picks up the new GoalData with updated funds
  // so the goal detail panel/sheet shows the new investment without a hard
  // page reload.
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null)
  const [goalDetailOpen, setGoalDetailOpen] = useState(false)
  const [showReportSheet, setShowReportSheet] = useState(false)
  const [selectedInsurance, setSelectedInsurance] = useState<InsuranceData | null>(null)
  const [desktopAddTxOpen, setDesktopAddTxOpen] = useState(false)
  const [showAddInsurance, setShowAddInsurance] = useState(false)
  const selectedGoal = data?.goals.find((g) => g.goalId === selectedGoalId) ?? null
  const PULL_THRESHOLD = 65

  const fetchDataRef = useRef<(opts?: { force?: boolean }) => Promise<void>>(async () => {})
  const hasDataRef = useRef(false)
  const touchStartY = useRef(-1)

  const fetchData = useCallback(async (opts?: { force?: boolean }) => {
    const cached = !opts?.force && getCachedOverview(userId)
    if (cached) {
      setData(cached)
      hasDataRef.current = true
      setLoading(false)
      return
    }
    // Only show skeleton on initial load — if data is already visible, refresh silently
    if (!hasDataRef.current) setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/dashboard/overview', { cache: 'no-store' })
      if (!res.ok) {
        const { error: e } = await res.json()
        setError(e ?? tc('error'))
      } else {
        const json = await res.json()
        setData(json)
        hasDataRef.current = true
        setHistoryKey((k) => k + 1)
        setCachedOverview(userId, json)
        try { localStorage.setItem('pwa_last_fetch', String(Date.now())) } catch {}
      }
    } catch {
      setError(tc('error'))
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchDataRef.current = fetchData }, [fetchData])

  // Initial load — on PWA, bust cache if last fetch was > 30s ago (handles force quit + reopen)
  useEffect(() => {
    const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true
    if (!isPWA) { fetchData(); return }
    try {
      const last = localStorage.getItem('pwa_last_fetch')
      const stale = !last || Date.now() - Number(last) > 30_000
      fetchData(stale ? { force: true } : undefined)
    } catch { fetchData() }
  }, [fetchData])

  // PWA only: refresh when foregrounded after > 30s in background
  useEffect(() => {
    const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true
    if (!isPWA) return
    let hiddenAt = 0
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
      } else if (hiddenAt > 0 && Date.now() - hiddenAt > 30_000) {
        fetchDataRef.current({ force: true })
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  // PWA only: pull-to-refresh
  useEffect(() => {
    const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true
    if (!isPWA) return
    let pullCurrent = 0
    const onTouchStart = (e: TouchEvent) => {
      touchStartY.current = window.scrollY === 0 ? e.touches[0].clientY : -1
    }
    const onTouchMove = (e: TouchEvent) => {
      if (touchStartY.current < 0) return
      const delta = e.touches[0].clientY - touchStartY.current
      if (delta > 0) {
        pullCurrent = Math.min(delta * 0.5, 80)
        setPullY(pullCurrent)
      }
    }
    const onTouchEnd = () => {
      if (pullCurrent >= PULL_THRESHOLD) fetchDataRef.current({ force: true })
      pullCurrent = 0
      setPullY(0)
      touchStartY.current = -1
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onTouchEnd)
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  async function handleFundClick(fundId: string) {
    setFundDetailId(fundId)
    setPurchaseHistory([])
    setHistoryLoading(true)
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
    } catch { /* show sheet without history */ }
    setHistoryLoading(false)
  }

  async function handleGenerateReport() {
    if (!data || isGeneratingReport) return
    setIsGeneratingReport(true)
    try {
      const { downloadPortfolioPDF } = await import('@/lib/generateReport')
      await downloadPortfolioPDF(data, locale)
    } finally {
      setIsGeneratingReport(false)
    }
  }


  useEffect(() => {
    setMobileTopBar({
      title: t('greeting', { name: userName }),
      subtitle: t('overview'),
      trailing: isDesktop ? undefined : (
        <button
          data-testid="generate-report-btn"
          onClick={() => setShowReportSheet(true)}
          aria-label={t('downloadReport')}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: 8, border: 'none', background: 'transparent',
            borderRadius: 'var(--r-control)', cursor: 'pointer', color: 'var(--c-ink)',
          }}
        >
          <ArrowDownToLine size={18} />
        </button>
      ),
    })
    return () => setMobileTopBar({ title: '' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userName, data, isDesktop])

  function openSellFund(fund: FundBreakdownItem) {
    setSellItem({
      type: 'fund',
      name: fund.fundName,
      currentValue: fund.currentValue,
      units: fund.quantity,
      navPerUnit: fund.currentNAV,
      gainPct: fund.profitLossPercentage,
      fundId: fund.fundId,
      purchasePrice: fund.purchasePrice,
    })
    setSellSheetOpen(true)
  }

  function openSellNonFund(item: NonFundUnallocatedItem) {
    const navPerUnit = item.units && item.units > 0 ? item.currentValue / item.units : undefined
    setSellItem({
      type: item.type as 'bank' | 'gold' | 'stock',
      name: item.notes ?? (item.type === 'bank' ? 'Bank deposit' : item.type === 'gold' ? 'Gold' : item.type),
      currentValue: item.currentValue,
      units: item.units ?? undefined,
      navPerUnit,
      interestRate: item.interestRate ?? undefined,
      transactionId: item.transactionId,
      purchasePrice: item.amount,
    })
    setSellSheetOpen(true)
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

  const sortedGoals = data ? (() => {
    const goals = [...data.goals]
    if (goalSort === 'progressDesc') goals.sort((a, b) => (b.progressPercentage ?? 0) - (a.progressPercentage ?? 0))
    else if (goalSort === 'progressAsc') goals.sort((a, b) => (a.progressPercentage ?? 0) - (b.progressPercentage ?? 0))
    else if (goalSort === 'alpha') goals.sort((a, b) => a.goalName.localeCompare(b.goalName))
    return goals
  })() : []

  // Compute asset allocation totals for pie chart
  const allocationTotals = data ? (() => {
    const allFundItems = [...data.goals.flatMap((g) => g.funds), ...data.unallocated.funds]
    const equityTotal = allFundItems.filter((f) => f.fundType === 'equity').reduce((s, f) => s + f.currentValue, 0)
    const bondTotal = allFundItems.filter((f) => f.fundType === 'debt').reduce((s, f) => s + f.currentValue, 0)
    const balancedTotal = allFundItems.filter((f) => f.fundType === 'balanced').reduce((s, f) => s + f.currentValue, 0)
    const { bank: bankTotal, gold: goldTotal, stock: stockTotal } = data.byType
    const cashTotal = 0
    return { equityTotal, bondTotal, balancedTotal, bankTotal, goldTotal, stockTotal, cashTotal }
  })() : null

  // Find fund item for detail modal
  const allFunds = data ? [...data.unallocated.funds, ...data.goals.flatMap((g) => g.funds)] : []
  const detailFund = fundDetailId ? allFunds.find((f) => f.fundId === fundDetailId) : null

  return (
    <div className="space-y-4 md:space-y-0 md:flex md:flex-col md:flex-1 md:min-h-0">
        {/* Pull-to-refresh indicator (mobile PWA only) */}
        <div
          className="md:hidden -mx-4 -mt-4 overflow-hidden flex items-center justify-center"
          style={{ height: `${pullY}px`, transition: pullY === 0 ? 'height 0.25s ease' : 'none' }}
        >
          <div className={`w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent ${pullY >= PULL_THRESHOLD ? 'animate-spin' : ''}`} />
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



        {/* Dashboard content — conditionally renders desktop or mobile layout (no DOM duplication) */}
        {!loading && data && !isEmpty && (
          isDesktop ? (
            /* ── Desktop: two-column layout — self-contained scroll context
               so the page header sits outside the scroll and stays pinned
               (same pattern as DesktopPlanningView). <main> is full-bleed
               on /dashboard via PAGES_WITH_FULL_HEIGHT_DESKTOP, so no
               negative margins are needed here. ── */
            <div
              data-testid="desktop-overview"
              style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
            >
              {/* Page title — outside the scrollable body so it stays at the top. */}
              <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px 16px', borderBottom: '1px solid var(--c-line)', background: 'var(--c-canvas)', flexShrink: 0 }}>
                <div>
                  <div data-testid="desktop-page-title" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 3 }}>
                    {t('overview')}
                  </div>
                  <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--c-ink)', lineHeight: 1.1 }}>
                    {t('greeting', { name: userName })}
                  </h1>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    data-testid="desktop-add-tx-btn"
                    onClick={() => setDesktopAddTxOpen(true)}
                    className="cn-btn"
                    style={{ padding: '8px 14px', fontSize: 13, gap: 6 }}
                  >
                    <Plus size={14} strokeWidth={2.4} />
                    {locale === 'vi' ? 'Giao dịch' : 'Transaction'}
                  </button>
                  <button
                    data-testid="desktop-new-goal-btn"
                    onClick={() => setShowGoalForm(true)}
                    className="cn-btn primary"
                    style={{ padding: '8px 14px', fontSize: 13, gap: 6 }}
                  >
                    <Plus size={14} strokeWidth={2.4} />
                    {locale === 'vi' ? 'Mục tiêu mới' : 'New goal'}
                  </button>
                </div>
              </header>

              {/* Two-column body — clips overflow so each column scrolls on its own */}
              <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {/* Left column: goals, unallocated, insurance */}
              <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 20px 40px 28px' }}>
                {/* Goals */}
                {sortedGoals.length > 0 && (
                  <section style={{ marginBottom: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div>
                        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
                          {t('sectionGoals')}
                        </h2>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--c-muted)' }}>
                          {sortedGoals.length} {locale !== 'vi' && sortedGoals.length === 1 ? 'goal tracked' : t('tracked')}
                        </p>
                      </div>
                      <SortDropdown
                        value={goalSort}
                        onChange={setGoalSort}
                        options={[
                          { value: 'manual', label: t('sortManual') },
                          { value: 'progressDesc', label: t('sortProgressDesc') },
                          { value: 'progressAsc', label: t('sortProgressAsc') },
                          { value: 'alpha', label: t('sortAlpha') },
                        ]}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                      {sortedGoals.map((goal) => (
                        <DesktopGoalCard
                          key={goal.goalId}
                          goal={goal}
                          locale={locale}
                          onClick={() => { setSelectedGoalId(goal.goalId); setSelectedInsurance(null) }}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Unallocated */}
                {(data.unallocated.funds.length > 0 || data.unallocated.nonFunds.length > 0) && (
                  <div style={{ marginBottom: 24 }}>
                    <UnallocatedSection
                      unallocatedAmount={data.unallocated.totalValue}
                      funds={data.unallocated.funds}
                      nonFunds={data.unallocated.nonFunds}
                      onFundClick={handleFundClick}
                      onAssignToGoal={(fundId, name, value, type) => { setGoalPickerFundId(fundId); setGoalPickerFundItem({ name, value, type }) }}
                      onSellFund={openSellFund}
                      onAssignNonFundToGoal={(txId, name, value, type) => { setNonFundPickerTxId(txId); setNonFundPickerItem({ name, value, type }) }}
                      onSellNonFund={openSellNonFund}
                      desktopCard
                      onDesktopAssign={async (kind, id, goalId) => {
                        if (kind === 'fund') {
                          const res = await fetch(`/api/v1/fund-investments?fund_id=${id}`)
                          if (!res.ok) throw new Error('Failed to fetch fund investments')
                          const investments = await res.json() as Array<{ id: string }>
                          await Promise.all(investments.map((inv) =>
                            fetch(`/api/v1/fund-investments/${inv.id}/goal`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ goal_id: goalId }),
                            }).then((r) => { if (!r.ok) throw new Error('Failed to assign') })
                          ))
                        } else {
                          const res = await fetch(`/api/v1/investment-transactions/${id}/assign`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ goal_id: goalId }),
                          })
                          if (!res.ok) {
                            const { error: e } = await res.json().catch(() => ({ error: 'Failed to assign' }))
                            throw new Error(e ?? 'Failed to assign')
                          }
                        }
                        // Delay refresh so the 1.5s success state in the modal
                        // stays visible before UnallocatedSection unmounts
                        setTimeout(() => fetchData({ force: true }), 2000)
                      }}
                    />
                  </div>
                )}

                {/* Insurance */}
                {data.insurance.length > 0 && (
                  <section style={{ marginBottom: 24 }}>
                    <DesktopInsuranceList
                      insurance={data.insurance}
                      locale={locale}
                      onOpen={(ins) => { setSelectedGoalId(null); setSelectedInsurance(selectedInsurance?.insuranceId === ins.insuranceId ? null : ins) }}
                      onAdd={() => setShowAddInsurance(true)}
                    />
                  </section>
                )}

              </div>

              {/* Right column: net worth panel — has its own scroll inside the
                  two-column body, no sticky needed since the body itself is the
                  scroll container. */}
              <div style={{
                width: 300, flexShrink: 0,
                borderLeft: '1px solid var(--c-line)',
                overflowY: 'auto',
                padding: '20px 28px 40px 20px',
              }}>
                {selectedGoal ? (
                  <DesktopGoalDetail
                    goal={selectedGoal}
                    locale={locale}
                    onClose={() => setSelectedGoalId(null)}
                    onDataChanged={() => { setSelectedGoalId(null); fetchData({ force: true }) }}
                    refreshKey={historyKey}
                  />
                ) : selectedInsurance ? (
                  <DesktopInsuranceDetail
                    ins={selectedInsurance}
                    locale={locale}
                    onClose={() => setSelectedInsurance(null)}
                    onChanged={() => fetchData({ force: true })}
                  />
                ) : (
                  <DesktopNetWorthPanel
                    data={data}
                    allocationTotals={allocationTotals}
                    goldUnits={data.goldUnits}
                    locale={locale}
                    refreshKey={historyKey}
                    navUpdatedAt={data.netWorth.navUpdatedAt}
                    onDownloadReport={() => setShowReportSheet(true)}
                  />
                )}
              </div>
              </div>{/* end two-column body */}
            </div>
          ) : (
            /* ── Mobile layout ── */
            <div className="space-y-8">
              {/* Net Worth */}
              <div className="space-y-4">
                <NetWorthCard
                  {...data.netWorth}
                  refreshKey={historyKey}
                  allocationBar={allocationTotals ? {
                    fund: allocationTotals.equityTotal + allocationTotals.bondTotal + allocationTotals.balancedTotal,
                    bank: allocationTotals.bankTotal,
                    gold: allocationTotals.goldTotal,
                    stock: allocationTotals.stockTotal,
                    goldUnits: data.goldUnits,
                  } : undefined}
                />
              </div>

              {/* Goals */}
              {sortedGoals.length > 0 && (
                <section>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('sectionGoals')}</h2>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--c-muted)' }}>
                        {sortedGoals.length} {locale !== 'vi' && sortedGoals.length === 1 ? 'goal tracked' : t('tracked')}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <SortDropdown
                        value={goalSort}
                        onChange={setGoalSort}
                        options={[
                          { value: 'manual', label: t('sortManual') },
                          { value: 'progressDesc', label: t('sortProgressDesc') },
                          { value: 'progressAsc', label: t('sortProgressAsc') },
                          { value: 'alpha', label: t('sortAlpha') },
                        ]}
                      />
                      <button
                        onClick={() => setShowGoalForm(true)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          padding: 6, border: 'none',
                          borderRadius: 'var(--r-control)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                          color: 'var(--c-ink)',
                        }}
                        aria-label={t('addGoalBtn')}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {sortedGoals.map((goal) => (
                      <GoalCard
                        key={goal.goalId}
                        {...goal}
                        onClick={() => { setSelectedGoalId(goal.goalId); setGoalDetailOpen(true) }}
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
                  onAssignToGoal={(fundId, name, value, type) => { setGoalPickerFundId(fundId); setGoalPickerFundItem({ name, value, type }) }}
                  onSellFund={openSellFund}
                  onAssignNonFundToGoal={(txId, name, value, type) => { setNonFundPickerTxId(txId); setNonFundPickerItem({ name, value, type }) }}
                  onSellNonFund={openSellNonFund}
                />
              )}

              {/* Insurance */}
              {data.insurance.length > 0 && (
                <section>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('sectionInsurance')}</h2>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--c-muted)' }}>
                        {data.insurance.length} {data.insurance.length === 1 ? t('member') : t('members')}
                      </p>
                    </div>
                    <Link
                      href="/settings?tab=insurance"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 12, fontWeight: 500, padding: '4px 8px',
                        border: 'none', borderRadius: 'var(--r-control)',
                        background: 'transparent', color: 'var(--c-ink)',
                        textDecoration: 'none',
                      }}
                    >
                      <Plus size={12} strokeWidth={2.4} />
                      {t('add')}
                    </Link>
                  </div>
                  <div style={{
                    background: 'var(--c-card)',
                    border: '1px solid var(--c-line)',
                    borderRadius: 'var(--r-card)',
                    boxShadow: 'var(--shadow-card)',
                    overflow: 'hidden',
                  }}>
                    {data.insurance.map((ins, idx) => (
                      <InsuranceCard
                        key={ins.insuranceId}
                        {...ins}
                        isLast={idx === data.insurance.length - 1}
                        onClick={() => setSelectedInsurance(ins)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* NAV updated footer */}
              {data.netWorth.navUpdatedAt && (
                <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--c-muted)', marginTop: 24 }}>
                  {t('navUpdated')} {fmtTimeAgo(data.netWorth.navUpdatedAt, locale)}
                </p>
              )}
            </div>
          )
        )}

      {/* Transaction History Sheet */}
      <TransactionHistorySheet
        open={!!(fundDetailId && detailFund)}
        onClose={() => { setFundDetailId(null); setPurchaseHistory([]); setHistoryLoading(false) }}
        fundName={detailFund?.fundName ?? ''}
        currentNAV={detailFund?.currentNAV ?? 0}
        quantity={detailFund?.quantity ?? 0}
        currentValue={detailFund?.currentValue ?? 0}
        purchasePrice={detailFund?.purchasePrice ?? 0}
        profitLoss={detailFund?.profitLoss ?? 0}
        profitLossPercentage={detailFund?.profitLossPercentage ?? 0}
        purchaseHistory={purchaseHistory}
        loading={historyLoading}
      />

      {/* Assign Goal Sheet — funds */}
      <AssignGoalSheet
        open={!!goalPickerFundId}
        onClose={() => { setGoalPickerFundId(null); setGoalPickerFundItem(null); fetchData({ force: true }) }}
        item={goalPickerFundItem ?? undefined}
        desktop={isDesktop}
        onConfirm={async (goalId) => {
          if (!goalPickerFundId) return
          const res = await fetch(`/api/v1/fund-investments?fund_id=${goalPickerFundId}`)
          if (!res.ok) throw new Error('Failed to fetch fund investments')
          const investments = await res.json() as Array<{ id: string }>
          await Promise.all(
            investments.map((inv) =>
              fetch(`/api/v1/fund-investments/${inv.id}/goal`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ goal_id: goalId }),
              }).then((r) => { if (!r.ok) throw new Error('Failed to assign') })
            )
          )
        }}
      />

      {/* Assign Goal Sheet — non-funds */}
      <AssignGoalSheet
        open={!!nonFundPickerTxId}
        onClose={() => { setNonFundPickerTxId(null); setNonFundPickerItem(null); fetchData({ force: true }) }}
        item={nonFundPickerItem ?? undefined}
        desktop={isDesktop}
        onConfirm={async (goalId) => {
          if (!nonFundPickerTxId) return
          const res = await fetch(`/api/v1/investment-transactions/${nonFundPickerTxId}/assign`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ goal_id: goalId }),
          })
          if (!res.ok) {
            const { error: e } = await res.json().catch(() => ({ error: 'Failed to assign' }))
            throw new Error(e ?? 'Failed to assign')
          }
        }}
      />

      {/* Add Goal Sheet */}
      <CreateGoalSheet
        open={showGoalForm}
        onClose={() => setShowGoalForm(false)}
        onSuccess={() => fetchData({ force: true })}
        desktop={isDesktop}
      />

      {/* Sell / Withdraw Sheet */}
      <SellWithdrawSheet
        item={sellItem}
        open={sellSheetOpen}
        context="unallocated"
        onClose={() => setSellSheetOpen(false)}
        onSuccess={() => fetchData({ force: true })}
      />

      {/* Goal Detail Sheet */}
      <GoalDetailSheet
        goal={selectedGoal}
        open={goalDetailOpen}
        onClose={() => setGoalDetailOpen(false)}
        onDataChanged={() => fetchData({ force: true })}
        refreshKey={historyKey}
      />

      {/* Desktop: Add Transaction Sheet */}
      <AddTransactionSheet
        open={desktopAddTxOpen}
        onClose={() => setDesktopAddTxOpen(false)}
        onSaved={() => fetchData({ force: true })}
        desktop={isDesktop}
      />

      {/* Download Report Sheet */}
      <DownloadReportSheet
        open={showReportSheet}
        onClose={() => setShowReportSheet(false)}
        data={data ? {
          netWorth: data.netWorth.netWorth,
          currentValue: data.netWorth.currentValue,
          totalPL: data.netWorth.overallProfitLoss,
          goalCount: data.goals.length,
        } : null}
        onExport={handleGenerateReport}
        desktop={isDesktop}
      />

      {/* Add Insurance Member modal (desktop) */}
      <AddInsuranceMemberModal
        open={showAddInsurance}
        onClose={() => setShowAddInsurance(false)}
        onCreated={() => fetchData({ force: true })}
        locale={locale}
      />

      {/* Mobile: Insurance detail sheet */}
      <InsuranceDetailSheet
        open={!isDesktop && !!selectedInsurance}
        ins={selectedInsurance}
        locale={locale}
        onClose={() => setSelectedInsurance(null)}
        onChanged={() => fetchData({ force: true })}
      />
    </div>
  )
}
