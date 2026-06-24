'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, ArrowDownToLine, ChevronDown, Check } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { useNavigation } from '@/app/components/navigation/NavigationContext'
import { CreateGoalSheet } from './components/CreateGoalSheet'
import { DashboardSkeleton, DesktopDashboardSkeleton } from './components/Skeletons'
import { CairnLoader } from '@/app/components/ui/CairnLoader'
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
import RecentActivityCard from './components/RecentActivityCard'
import MaturityActionCard from './components/MaturityActionCard'
import { MaturityResolveSheet, MaturityResolveModal } from './components/MaturityResolveSheet'
import { isActionableTermDeposit, MATURING_COUNT_EVENT } from '@/lib/maturity'
import { detectMergeClusters } from '@/lib/mergeCluster'
import { actionableBooks } from './maturityCardItems'
import { collapseUnallocatedBooks } from './unallocatedBooks'
import type { InvRow } from './components/goalDetailShared'
import { loadOverview, overviewErrorText, getCachedOverview, setCachedOverview, computeAllocationTotals } from './overviewData'

import TransactionHistorySheet from './components/TransactionHistorySheet'
import DesktopNetWorthPanel from './components/DesktopNetWorthPanel'
import DesktopGoalCard from './components/DesktopGoalCard'
import DesktopInsuranceList from './components/DesktopInsuranceList'
import DesktopInsuranceDetail from './components/DesktopInsuranceDetail'
import InsuranceEmpty from './components/InsuranceEmpty'
import AddInsuranceMemberModal from './components/AddInsuranceMemberModal'
import { OverviewEmptyState } from './components/OverviewEmptyState'
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
  // Progress-bar numerator: equals currentValue except that affects_progress=false
  // withdrawals are added back, so the bar holds steady while net worth (currentValue)
  // falls. Optional for back-compat with cached overview payloads predating the field.
  progressValue?: number
  totalInvested: number
  profitLoss: number
  profitLossPercentage: number
  progressPercentage: number | null
  transactionCount: number
  funds: FundBreakdownItem[]
  nonFunds?: NonFundUnallocatedItem[]
  // "Ví chờ gộp": settle-with-hold settlements still pooled in this goal. Shown as
  // a "đang chờ gộp" chip (with unhold) and preselected in the anchor's merge sheet.
  // transactionId is the held WITHDRAWAL row. Optional for cached payloads.
  heldForMerge?: Array<{ transactionId: string; amount: number; anchorInvId: string | null; name: string | null }>
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
  // Set on a tranche of an accumulating book — keeps the book out of the
  // maturity "needs attention" card (it isn't renewed via the single-row flow).
  depositGroupId?: string | null
  // Structured bank (FK) + currency + pledged flag — null/false on legacy
  // deposits. Drive the merge destination-bank default and the eligibility
  // "same currency" / "not pledged" rules (see lib/mergeEligibility).
  bankCode?: string | null
  currency?: string | null
  isPledged?: boolean | null
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

// Map a dashboard overview non-fund holding to the InvRow shape the maturity
// resolve flow expects.
function nonFundToInvRow(it: NonFundUnallocatedItem, isVi: boolean): InvRow {
  return {
    id: it.transactionId,
    name: it.notes ?? (it.type === 'bank' ? (isVi ? 'Tiền gửi' : 'Bank deposit') : it.type),
    type: it.type,
    value: it.currentValue,
    gainPct: it.amount > 0 ? ((it.currentValue - it.amount) / it.amount) * 100 : null,
    units: it.units,
    principal: it.amount,
    interestRate: it.interestRate,
    expiryDate: it.expiryDate,
    investmentDate: it.investmentDate,
    fund: null,
    depositGroupId: it.depositGroupId ?? null,
    bankCode: it.type === 'bank' ? (it.bankCode ?? null) : null,
    currency: it.currency ?? null,
    isPledged: it.isPledged ?? false,
  }
}

// A maturing deposit plus the context needed to act on it: the goal it belongs
// to (null when unassigned) and the raw item for the withdraw flow.
interface MaturingDep {
  inv: InvRow
  goalId: string | null
  raw: NonFundUnallocatedItem
  // The goal's other bank deposits, attached when the resolve flow opens so the
  // merge UI can fold close-maturing siblings into this re-deposit. Computed lazily
  // (only on open) to keep it off the hot maturingDeposits list.
  siblings?: InvRow[]
  // Pooled "Ví chờ gộp" holdings in this goal, attached on open so the merge sheet
  // can preselect them as held_sources (consumed in place, no second withdrawal).
  heldSiblings?: { id: string; name: string | null; amount: number }[]
}

// Build the SellWithdrawSheet payload for a non-fund holding (bank/gold/stock).
function nonFundToSellItem(item: NonFundUnallocatedItem): SellItem {
  return {
    type: item.type as 'bank' | 'gold' | 'stock',
    name: item.notes ?? (item.type === 'bank' ? 'Bank deposit' : item.type === 'gold' ? 'Gold' : item.type),
    currentValue: item.currentValue,
    units: item.units ?? undefined,
    navPerUnit: item.units && item.units > 0 ? item.currentValue / item.units : undefined,
    interestRate: item.interestRate ?? undefined,
    transactionId: item.transactionId, // for a book this is the anchor (= deposit_group_id)
    purchasePrice: item.amount,
    depositGroupId: item.depositGroupId ?? null,
  }
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
  const locale = useLocale()
  const { userName, setMobileTopBar } = useNavigation()
  const isDesktop = useIsDesktop()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  // Re-fetch while data is already on screen → number-refresh state (pulse + XS
  // Cairn), as opposed to `loading` which drives the first-paint skeleton.
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [fundDetailId, setFundDetailId] = useState<string | null>(null)
  const [goalPickerFundId, setGoalPickerFundId] = useState<string | null>(null)
  const [goalPickerFundItem, setGoalPickerFundItem] = useState<{ name: string; value: number; type: string } | null>(null)
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [nonFundPickerTxId, setNonFundPickerTxId] = useState<string | null>(null)
  const [nonFundPickerItem, setNonFundPickerItem] = useState<{ name: string; value: number; type: string } | null>(null)
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
  const [resolveDep, setResolveDep] = useState<MaturingDep | null>(null)
  // Goal-context withdraw triggered from the maturity flow — a dedicated
  // SellWithdrawSheet so a goal-assigned deposit withdraws in one tap (linked to
  // its goal, issue #261) instead of bouncing through the goal detail panel.
  const [maturityWithdraw, setMaturityWithdraw] = useState<
    { item: SellItem; goalId: string; goalCurrentValue: number; goalTargetAmount: number | null } | null
  >(null)
  const [showReportSheet, setShowReportSheet] = useState(false)
  const [selectedInsuranceId, setSelectedInsuranceId] = useState<string | null>(null)
  const [desktopAddTxOpen, setDesktopAddTxOpen] = useState(false)
  const [showAddInsurance, setShowAddInsurance] = useState(false)
  const selectedGoal = data?.goals.find((g) => g.goalId === selectedGoalId) ?? null
  // Derive the selected insurance from fresh data (mirrors selectedGoal) so the
  // detail panel reflects updates after mark-paid / log-payment refetches
  // instead of rendering a stale snapshot.
  const selectedInsurance = data?.insurance.find((i) => i.insuranceId === selectedInsuranceId) ?? null
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
    // Only show skeleton on initial load — if data is already visible, refresh
    // silently with the number-refresh pulse instead.
    if (!hasDataRef.current) setLoading(true)
    else setRefreshing(true)
    setError('')

    // Resilient load: retries once on a transient failure (e.g. the service
    // worker's synthetic "Offline" 503 from a slow cold start) and falls back to
    // the last cached snapshot before ever surfacing an error banner.
    const result = await loadOverview({
      getCache: (allowStale) => getCachedOverview(userId, { allowStale }),
      setCache: (json) => setCachedOverview(userId, json),
    })

    if (result.data) {
      setData(result.data)
      hasDataRef.current = true
      setHistoryKey((k) => k + 1)
      // Only mark a real network refresh (not a stale-cache fallback) so the PWA
      // foreground-staleness check still triggers a true refetch later.
      if (!result.fromCache) {
        try { localStorage.setItem('pwa_last_fetch', String(Date.now())) } catch {}
      }
    }
    setError(overviewErrorText(result, tc('error')) ?? '')
    setLoading(false)
    setRefreshing(false)
  }, [userId, tc])

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

  // Publish the live count of maturing deposits so the nav badge stays in sync
  // with this view — e.g. after renewing on the dashboard, the card drops the
  // item and the badge must drop with it (not wait for its own cache TTL).
  // Same filter as the card and the badge hook, so they can't disagree.
  useEffect(() => {
    if (!data) return
    // Tag each tranche with its goal bucket, then group books GLOBALLY — same as
    // the card below — so the badge and the card can't disagree even if a book is
    // momentarily split across goals. Term deposits count one each; a book counts
    // as ONE. isVi is irrelevant to the count, so pass false.
    const tagged = [
      ...data.goals.flatMap((g) => (g.nonFunds ?? []).map((it) => ({ it, goalId: g.goalId }))),
      ...data.unallocated.nonFunds.map((it) => ({ it, goalId: null as string | null })),
    ]
    const count = tagged.filter(({ it }) => isActionableTermDeposit(it)).length + actionableBooks(tagged, false).length
    window.dispatchEvent(new CustomEvent(MATURING_COUNT_EVENT, { detail: count }))
  }, [data])

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
    setSellItem(nonFundToSellItem(item))
    setSellSheetOpen(true)
  }

  const isEmpty = data && data.goals.length === 0 && data.unallocated.funds.length === 0 && data.unallocated.nonFunds.length === 0 && data.insurance.length === 0

  const sortedGoals = data ? (() => {
    const goals = [...data.goals]
    if (goalSort === 'progressDesc') goals.sort((a, b) => (b.progressPercentage ?? 0) - (a.progressPercentage ?? 0))
    else if (goalSort === 'progressAsc') goals.sort((a, b) => (a.progressPercentage ?? 0) - (b.progressPercentage ?? 0))
    else if (goalSort === 'alpha') goals.sort((a, b) => a.goalName.localeCompare(b.goalName))
    return goals
  })() : []

  // Asset-allocation buckets for the allocation bar. fundTotal sums all fund
  // types (incl. unexpected ones) so nothing drops out of the bar (#3).
  const allocationTotals = data ? computeAllocationTotals(data) : null

  // Find fund item for detail modal
  const allFunds = data ? [...data.unallocated.funds, ...data.goals.flatMap((g) => g.funds)] : []
  const detailFund = fundDetailId ? allFunds.find((f) => f.fundId === fundDetailId) : null

  // Roll an unallocated accumulating book's tranches into one row (the assign/sell
  // actions then act on the whole book — /assign cascades a book's goal atomically).
  const unallocatedNonFunds = data ? collapseUnallocatedBooks(data.unallocated.nonFunds) : []

  const isVi = locale === 'vi'

  // Term deposits (assigned + unassigned) that need a renew/withdraw decision,
  // carrying the context needed to act on each.
  // Single term deposits surface one row each; an accumulating book surfaces as
  // ONE grouped row (its tranches rolled up via actionableBooks) that opens the
  // collapse flow. We tag every tranche with its goal bucket, then group books
  // GLOBALLY across buckets so a momentarily goal-split book still shows one row
  // (full principal, anchor's goal) — and matches the badge count above. A book's
  // `raw` is its anchor tranche — context only; withdraw isn't offered for a book.
  const taggedNonFunds = data ? [
    ...data.goals.flatMap((g) => (g.nonFunds ?? []).map((it) => ({ it, goalId: g.goalId as string | null }))),
    ...data.unallocated.nonFunds.map((it) => ({ it, goalId: null as string | null })),
  ] : []
  const maturingDeposits: MaturingDep[] = [
    ...taggedNonFunds.filter(({ it }) => isActionableTermDeposit(it))
      .map(({ it, goalId }) => ({ inv: nonFundToInvRow(it, isVi), goalId, raw: it })),
    ...actionableBooks(taggedNonFunds, isVi)
      .map((b) => ({ inv: b.inv, goalId: b.goalId, raw: b.anchor })),
  ]

  // Auto-detect goals whose deposits fall close together, so the card can offer a
  // one-tap "gộp lại" (merge) shortcut. Fed from ALL the goal's bank deposits (not
  // just the actionable ones) with an `actionable` flag: the anchor must be due now
  // — that's what the card surfaces and the sheet opens on — but a close-maturing
  // sibling counts even if it isn't due yet, exactly matching what the sheet
  // preselects. Reuses the eligibility rules, so the banner can't over-promise.
  const mergeClusters = detectMergeClusters(
    taggedNonFunds.map(({ it, goalId }) => ({
      id: it.transactionId, goalId, type: it.type, expiryDate: it.expiryDate,
      depositGroupId: it.depositGroupId ?? null, principal: it.amount, value: it.currentValue,
      currency: it.currency ?? null, isPledged: it.isPledged ?? false,
      actionable: isActionableTermDeposit(it),
    })),
  ).map((c) => ({ anchorId: c.anchorId, size: c.size }))

  // A goal's OTHER bank deposits, mapped to InvRows the merge flow can fold into a
  // re-deposit. Books are mapped too but the sheet filters them out. Empty for an
  // unassigned deposit (merge is goal-scoped).
  function goalSiblingInvRows(goalId: string | null, excludeId: string): InvRow[] {
    if (!data || goalId == null) return []
    const goal = data.goals.find((g) => g.goalId === goalId)
    return (goal?.nonFunds ?? [])
      .filter((it) => it.transactionId !== excludeId && it.type === 'bank')
      .map((it) => nonFundToInvRow(it, isVi))
  }

  // The goal's pooled "Ví chờ gộp" holdings, for preselect in the anchor's merge
  // sheet. Empty for an unassigned deposit (the pool is goal-scoped).
  function goalHeldSiblings(goalId: string | null): { id: string; name: string | null; amount: number }[] {
    if (!data || goalId == null) return []
    const goal = data.goals.find((g) => g.goalId === goalId)
    return (goal?.heldForMerge ?? []).map((h) => ({ id: h.transactionId, name: h.name, amount: h.amount }))
  }

  // Open the resolve flow for a maturing deposit, attaching the goal's siblings so
  // the merge UI is available (and close-maturing ones preselect) plus any pooled
  // holdings waiting to be folded into this anchor.
  function openResolve(dep: MaturingDep) {
    setResolveDep({
      ...dep,
      siblings: goalSiblingInvRows(dep.goalId, dep.inv.id),
      heldSiblings: goalHeldSiblings(dep.goalId),
    })
  }

  // Resolve a maturing deposit by its id (used by the card's "handle" + the
  // cluster banner, which opens on the anchor = latest maturity).
  function resolveById(id: string) {
    const dep = maturingDeposits.find((d) => d.inv.id === id)
    if (dep) openResolve(dep)
  }

  // Withdraw from the maturity card: open the withdraw sheet pre-targeted at the
  // deposit in one tap. A goal-assigned deposit withdraws in its goal context so
  // the withdrawal links to the goal (issue #261); an unassigned one uses the
  // unallocated sell flow. Takes the dep explicitly because the resolve sheet
  // clears `resolveDep` before invoking onWithdraw.
  function withdrawMaturingDeposit(dep: MaturingDep | null) {
    if (!dep) return
    // For a book, withdraw the WHOLE book — build the sell item from the rolled-up
    // row (book total + anchor id + depositGroupId) so the full-close sheet
    // prefills the book balance, not just the anchor tranche's value.
    const item: SellItem = dep.inv.depositGroupId
      ? { type: 'bank', name: dep.inv.name, currentValue: dep.inv.value, transactionId: dep.inv.id, purchasePrice: dep.inv.principal ?? dep.inv.value, depositGroupId: dep.inv.depositGroupId, interestRate: dep.inv.interestRate ?? undefined }
      : nonFundToSellItem(dep.raw)
    if (dep.goalId) {
      const goal = data?.goals.find((g) => g.goalId === dep.goalId)
      setMaturityWithdraw({
        item,
        goalId: dep.goalId,
        goalCurrentValue: goal?.currentValue ?? dep.raw.currentValue,
        goalTargetAmount: goal?.targetAmount ?? null,
      })
    } else {
      setSellItem(item)
      setSellSheetOpen(true)
    }
  }

  return (
    <div className="space-y-4 md:space-y-0 md:flex md:flex-col md:flex-1 md:min-h-0">
        {/* Pull-to-refresh indicator (mobile PWA only) */}
        <div
          className="md:hidden -mx-4 -mt-4 overflow-hidden flex items-center justify-center"
          style={{ height: `${pullY}px`, transition: pullY === 0 ? 'height 0.25s ease' : 'none' }}
        >
          <CairnLoader size={20} variant="pos" />
        </div>

        {/* Error state */}
        {error && (
          <div
            className="mb-6 flex items-center justify-between"
            style={{ padding: 16, background: 'var(--c-neg-tint)', border: '1px solid var(--c-neg)', borderRadius: 12 }}
          >
            <p className="text-sm" style={{ color: 'var(--c-neg)', margin: 0 }}>{error}</p>
            <button onClick={() => fetchData({ force: true })} className="text-sm font-medium hover:underline ml-4" style={{ color: 'var(--c-neg)' }}>{tc('tryAgain')}</button>
          </div>
        )}

        {/* Loading skeleton — each breakpoint gets its own per the design:
            the mobile stack vs the two-column desktop Overview shell. Toggled
            with CSS (not isDesktop) so the right one paints first, no flash. */}
        {loading && (
          <>
            <div className="md:hidden">
              <DashboardSkeleton />
            </div>
            <div className="hidden md:block md:flex-1 md:min-h-0">
              <DesktopDashboardSkeleton />
            </div>
          </>
        )}

        {/* Empty state */}
        {!loading && !error && isEmpty && (
          <OverviewEmptyState
            onAddGoal={() => setShowGoalForm(true)}
            onAddInsurance={() => setShowAddInsurance(true)}
          />
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
                {/* Term deposits needing a maturity decision */}
                <MaturityActionCard
                  items={maturingDeposits.map((d) => d.inv)}
                  isVi={isVi}
                  onResolve={(inv) => resolveById(inv.id)}
                  clusters={mergeClusters}
                  onMergeCluster={resolveById}
                  style={{ marginBottom: 24 }}
                />
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
                          onClick={() => { setSelectedGoalId(goal.goalId); setSelectedInsuranceId(null) }}
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
                      nonFunds={unallocatedNonFunds}
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
                <section style={{ marginBottom: 24 }}>
                  <DesktopInsuranceList
                    insurance={data.insurance}
                    locale={locale}
                    goalCount={data.goals.length}
                    onOpen={(ins) => { setSelectedGoalId(null); setSelectedInsuranceId(selectedInsuranceId === ins.insuranceId ? null : ins.insuranceId) }}
                    onAdd={() => setShowAddInsurance(true)}
                  />
                </section>

                {/* Recent activity — last section */}
                <section style={{ marginBottom: 24 }}>
                  <RecentActivityCard
                    locale={locale}
                    desktop={isDesktop}
                    refreshKey={historyKey}
                    onChanged={() => fetchData({ force: true })}
                  />
                </section>

              </div>

              {/* Right column: net worth panel — has its own scroll inside the
                  two-column body, no sticky needed since the body itself is the
                  scroll container. */}
              <div style={{
                width: 300, flexShrink: 0,
                borderLeft: '1px solid var(--c-line)',
                overflowY: 'auto',
                // Match the Plan page's right panel: content sits ~flush to the
                // divider, no extra left/right margin (issue #230).
                padding: '20px 20px 40px 4px',
              }}>
                {selectedGoal ? (
                  <DesktopGoalDetail
                    goal={selectedGoal}
                    locale={locale}
                    onClose={() => setSelectedGoalId(null)}
                    onDataChanged={() => { setSelectedGoalId(null); fetchData({ force: true }) }}
                    // A renewal keeps the deposit in this goal — refresh in place
                    // so the panel stays open and the renewal summary is visible.
                    onRenewed={() => fetchData({ force: true })}
                    refreshKey={historyKey}
                  />
                ) : selectedInsurance ? (
                  <DesktopInsuranceDetail
                    ins={selectedInsurance}
                    locale={locale}
                    onClose={() => setSelectedInsuranceId(null)}
                    onChanged={() => fetchData({ force: true })}
                  />
                ) : (
                  <DesktopNetWorthPanel
                    data={data}
                    allocationTotals={allocationTotals}
                    goldUnits={data.goldUnits}
                    locale={locale}
                    refreshKey={historyKey}
                    refreshing={refreshing}
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
                  refreshing={refreshing}
                  allocationBar={allocationTotals ? {
                    fund: allocationTotals.fundTotal,
                    bank: allocationTotals.bankTotal,
                    gold: allocationTotals.goldTotal,
                    stock: allocationTotals.stockTotal,
                    goldUnits: data.goldUnits,
                  } : undefined}
                />
              </div>

              {/* Term deposits needing a maturity decision */}
              <MaturityActionCard
                items={maturingDeposits.map((d) => d.inv)}
                isVi={isVi}
                onResolve={(inv) => resolveById(inv.id)}
                clusters={mergeClusters}
                onMergeCluster={resolveById}
              />

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
                        locale={locale}
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
                  nonFunds={unallocatedNonFunds}
                  onFundClick={handleFundClick}
                  onAssignToGoal={(fundId, name, value, type) => { setGoalPickerFundId(fundId); setGoalPickerFundItem({ name, value, type }) }}
                  onSellFund={openSellFund}
                  onAssignNonFundToGoal={(txId, name, value, type) => { setNonFundPickerTxId(txId); setNonFundPickerItem({ name, value, type }) }}
                  onSellNonFund={openSellNonFund}
                />
              )}

              {/* Insurance */}
              <section>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('sectionInsurance')}</h2>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--c-muted)' }}>
                      {data.insurance.length} {data.insurance.length === 1 ? t('member') : t('members')}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAddInsurance(true)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 12, fontWeight: 500, padding: '4px 8px',
                      border: 'none', borderRadius: 'var(--r-control)',
                      background: 'transparent', color: 'var(--c-ink)',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    <Plus size={12} strokeWidth={2.4} />
                    {t('add')}
                  </button>
                </div>
                {data.insurance.length > 0 ? (
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
                        onClick={() => setSelectedInsuranceId(ins.insuranceId)}
                      />
                    ))}
                  </div>
                ) : (
                  <InsuranceEmpty
                    goalCount={data.goals.length}
                    locale={locale}
                    onAdd={() => setShowAddInsurance(true)}
                  />
                )}
              </section>

              {/* Recent activity — last section */}
              <RecentActivityCard
                locale={locale}
                desktop={isDesktop}
                refreshKey={historyKey}
                onChanged={() => fetchData({ force: true })}
              />

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
        desktop={isDesktop}
        onClose={() => setSellSheetOpen(false)}
        onSuccess={() => fetchData({ force: true })}
      />

      {/* Goal-context withdraw deep-linked from the maturity flow */}
      {maturityWithdraw && (
        <SellWithdrawSheet
          item={maturityWithdraw.item}
          open
          context="goal"
          goalId={maturityWithdraw.goalId}
          goalCurrentValue={maturityWithdraw.goalCurrentValue}
          goalTargetAmount={maturityWithdraw.goalTargetAmount}
          desktop={isDesktop}
          onClose={() => setMaturityWithdraw(null)}
          onSuccess={() => { setMaturityWithdraw(null); fetchData({ force: true }) }}
        />
      )}

      {/* Maturity resolve — mobile sheet / desktop modal */}
      {!isDesktop && (
        <MaturityResolveSheet
          open={!!resolveDep}
          inv={resolveDep?.inv ?? null}
          goalId={resolveDep?.goalId ?? null}
          siblingDeposits={resolveDep?.siblings}
          heldSiblings={resolveDep?.heldSiblings}
          isVi={isVi}
          onClose={() => setResolveDep(null)}
          onRenewed={() => { setResolveDep(null); fetchData({ force: true }) }}
          onWithdraw={() => withdrawMaturingDeposit(resolveDep)}
        />
      )}
      {isDesktop && resolveDep && (
        <MaturityResolveModal
          inv={resolveDep.inv}
          goalId={resolveDep.goalId ?? null}
          siblingDeposits={resolveDep.siblings}
          heldSiblings={resolveDep.heldSiblings}
          isVi={isVi}
          onClose={() => setResolveDep(null)}
          onRenewed={() => { setResolveDep(null); fetchData({ force: true }) }}
          onWithdraw={() => withdrawMaturingDeposit(resolveDep)}
        />
      )}

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
        desktop={isDesktop}
      />

      {/* Mobile: Insurance detail sheet */}
      <InsuranceDetailSheet
        open={!isDesktop && !!selectedInsurance}
        ins={selectedInsurance}
        locale={locale}
        onClose={() => setSelectedInsuranceId(null)}
        onChanged={() => fetchData({ force: true })}
      />
    </div>
  )
}
