'use client'

import { useState, useEffect } from 'react'
import { Plus, ArrowDownToLine } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { useNavigation } from '@/components/navigation/NavigationContext'
import { CreateGoalSheet } from './components/CreateGoalSheet'
import { DashboardSkeleton, DesktopDashboardSkeleton } from './components/Skeletons'
import { CairnLoader } from '@/components/ui/CairnLoader'
import NetWorthCard from './components/NetWorthCard'
import GoalCard from './components/GoalCard'
import UnallocatedSection from './components/UnallocatedSection'
import InsuranceCard from './components/InsuranceCard'
import InsuranceDetailSheet from './components/InsuranceDetailSheet'
import { SellWithdrawSheet, type SellItem } from './components/SellWithdrawSheet'
import GoalDetailSheet from './components/GoalDetailSheet'
import AssignGoalSheet from './components/AssignGoalSheet'
import DownloadReportSheet from './components/DownloadReportSheet'
import AddTransactionSheet, { type PrefillTransaction } from './components/AddTransactionSheet'
import RecentActivityCard from './components/RecentActivityCard'
import MaturityActionCard from './components/MaturityActionCard'
import { MaturityResolveSheet, MaturityResolveModal } from './components/MaturityResolveSheet'
import { MATURING_COUNT_EVENT } from '@/lib/maturity'
import { collapseUnallocatedBooks } from '@/features/dashboard/unallocatedBooks'
import { computeAllocationTotals } from '@/features/dashboard/overviewData'
import { useOverviewData } from '@/features/dashboard/useOverviewData'
import { useFundPurchaseHistory } from '@/features/dashboard/useFundPurchaseHistory'
import {
  isDashboardEmpty,
  reportPreviewStats,
  sortGoals,
  tagNonFunds,
  maturingCount,
  maturingDeposits as deriveMaturingDeposits,
  mergeClusterSummaries,
  goalSiblingInvRows,
  goalHeldSiblings,
  findFund,
  nonFundToSellItem,
  sellItemForFund,
  sellItemForMaturingDeposit,
  type SortValue,
  type MaturingDep,
} from '@/features/dashboard/dashboardModel'
import { fetchNetWorthHistory, type TimeRange, type ChartPoint } from './components/netWorthHistory'
import { fmtTimeAgo } from '@/lib/formatters'
import { assignInvestmentToGoal } from '@/lib/assignToGoal'

import TransactionHistorySheet from './components/TransactionHistorySheet'
import DesktopNetWorthPanel from './components/DesktopNetWorthPanel'
import DesktopGoalCard from './components/DesktopGoalCard'
import DesktopInsuranceList from './components/DesktopInsuranceList'
import DesktopInsuranceDetail from './components/DesktopInsuranceDetail'
import InsuranceEmpty from './components/InsuranceEmpty'
import AddInsuranceMemberModal from './components/AddInsuranceMemberModal'
import { OverviewEmptyState } from './components/OverviewEmptyState'
import SortDropdown from './components/SortDropdown'
import DesktopGoalDetail from './components/DesktopGoalDetail'
import type { FundBreakdownItem, NonFundUnallocatedItem } from '@/features/dashboard/contracts'

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
  const fundHistory = useFundPurchaseHistory()
  const [goalPickerFundId, setGoalPickerFundId] = useState<string | null>(null)
  const [goalPickerFundItem, setGoalPickerFundItem] = useState<{ name: string; value: number; type: string } | null>(null)
  const [nonFundPickerTxId, setNonFundPickerTxId] = useState<string | null>(null)
  const [nonFundPickerItem, setNonFundPickerItem] = useState<{ name: string; value: number; type: string } | null>(null)
  const [goalSort, setGoalSort] = useState<SortValue>('manual')
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [sellItem, setSellItem] = useState<SellItem | null>(null)
  const [sellSheetOpen, setSellSheetOpen] = useState(false)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
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
    { item: SellItem; goalId: string; goalProgressValue: number; goalTargetAmount: number | null; received: number | null } | null
  >(null)
  // Same figure for the unallocated fork, which reuses the plain sell sheet (#705).
  const [sellPayout, setSellPayout] = useState<number | null>(null)
  const [showReportSheet, setShowReportSheet] = useState(false)
  const [selectedInsuranceId, setSelectedInsuranceId] = useState<string | null>(null)
  const [desktopAddTxOpen, setDesktopAddTxOpen] = useState(false)
  // When set, the add-transaction sheet opens prefilled (e.g. "Add to this goal"
  // from a goal detail). Cleared on close so the plain FAB/button path stays blank.
  const [addTxPrefill, setAddTxPrefill] = useState<PrefillTransaction | null>(null)
  const [showAddInsurance, setShowAddInsurance] = useState(false)
  // Data loading — cache-first paint, silent refresh, the error banner and the
  // three PWA-only staleness rules — all belongs to useOverviewData now (#602).
  const { data, loading, refreshing, error, pullY, historyKey, bumpHistoryKey, refresh: fetchData } =
    useOverviewData(userId, tc('error'))

  const selectedGoal = data?.goals.find((g) => g.goalId === selectedGoalId) ?? null
  // Derive the selected insurance from fresh data (mirrors selectedGoal) so the
  // detail panel reflects updates after mark-paid / log-payment refetches
  // instead of rendering a stale snapshot.
  const selectedInsurance = data?.insurance.find((i) => i.insuranceId === selectedInsuranceId) ?? null

  // Goal/insurance selection is rendered differently per breakpoint — desktop
  // shows a right-side panel, mobile a sheet gated by separate state. Crossing
  // the 768px boundary (resize/rotate) would otherwise leave a desktop goal
  // selection set-but-invisible (then pop back open on the next resize) or
  // unexpectedly auto-open the mobile insurance sheet. Clear selection on flip.
  useEffect(() => {
    setSelectedGoalId(null)
    setSelectedInsuranceId(null)
    setGoalDetailOpen(false)
  }, [isDesktop])

  // Net-worth history + selected range live here (not inside the two net-worth
  // cards) so the range the user picks survives a desktop↔mobile breakpoint
  // switch — each card used to own its own range and reset to 1Y on remount (#5).
  const [timeRange, setTimeRange] = useState<TimeRange>('1Y')
  const [history, setHistory] = useState<ChartPoint[]>([])
  useEffect(() => {
    let cancelled = false
    fetchNetWorthHistory(timeRange).then((h) => { if (!cancelled) setHistory(h) })
    return () => { cancelled = true }
  }, [timeRange, historyKey])

  async function handleGenerateReport() {
    if (!data || isGeneratingReport) return
    setIsGeneratingReport(true)
    try {
      // `data` gates the button (nothing to export on an empty account) but is
      // not sent — the endpoint derives the report from the user's holdings.
      const { downloadPortfolioPDF } = await import('@/lib/generateReport')
      await downloadPortfolioPDF(locale)
    } finally {
      setIsGeneratingReport(false)
    }
  }


  useEffect(() => {
    setMobileTopBar({
      title: t('greeting', { name: userName }),
      subtitle: t('overview'),
      // Hide the download-report action on an empty account — there's nothing to
      // export yet. `isEmpty` is derived below from `data`; the effect re-runs on
      // `data` changes so the button appears once real holdings load.
      trailing: (isDesktop || isEmpty) ? undefined : (
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
    window.dispatchEvent(new CustomEvent(MATURING_COUNT_EVENT, { detail: maturingCount(tagNonFunds(data)) }))
  }, [data])

  function openSellFund(fund: FundBreakdownItem) {
    setSellItem(sellItemForFund(fund))
    setSellSheetOpen(true)
  }

  function openSellNonFund(item: NonFundUnallocatedItem) {
    setSellItem(nonFundToSellItem(item, isVi))
    setSellSheetOpen(true)
  }

  const isVi = locale === 'vi'
  const isEmpty = isDashboardEmpty(data)
  // Completed goals leave the tracked list (#650): they are archives, not
  // something to fund, and leaving them in the grid makes "3 goals tracked" a
  // lie. They keep their own section below — and every transaction they ever
  // held stays linked, so the ledger and reports are unchanged.
  const allSortedGoals = data ? sortGoals(data.goals, goalSort) : []
  const sortedGoals = allSortedGoals.filter((g) => !g.completedAt)
  const completedGoals = allSortedGoals.filter((g) => g.completedAt)

  // Asset-allocation buckets for the allocation bar. fundTotal sums all fund
  // types (incl. unexpected ones) so nothing drops out of the bar (#3).
  const allocationTotals = data ? computeAllocationTotals(data) : null
  const detailFund = findFund(data, fundHistory.fundId)

  // Roll an unallocated accumulating book's tranches into one row (the assign/sell
  // actions then act on the whole book — /assign cascades a book's goal atomically).
  const unallocatedNonFunds = data ? collapseUnallocatedBooks(data.unallocated.nonFunds) : []

  // Deposits needing a renew/withdraw decision, and the goals whose deposits fall
  // close enough together to offer a one-tap "gộp lại". Both derive from the same
  // tagged tranches as the nav badge above, so they cannot disagree.
  const taggedNonFunds = tagNonFunds(data)
  const maturingDeposits = deriveMaturingDeposits(taggedNonFunds, isVi)
  const mergeClusters = mergeClusterSummaries(taggedNonFunds)

  // Open the resolve flow for a maturing deposit, attaching the goal's siblings so
  // the merge UI is available (and close-maturing ones preselect) plus any pooled
  // holdings waiting to be folded into this anchor.
  function openResolve(dep: MaturingDep) {
    setResolveDep({
      ...dep,
      siblings: goalSiblingInvRows(data, dep.goalId, dep.inv.id, isVi),
      heldSiblings: goalHeldSiblings(data, dep.goalId),
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
  // `received` is the payout the user stated at the maturity sheet (#705); it
  // opens the withdraw sheet on their figure instead of a fresh estimate.
  function withdrawMaturingDeposit(dep: MaturingDep | null, received?: number) {
    if (!dep) return
    const item = sellItemForMaturingDeposit(dep, isVi)
    if (dep.goalId) {
      const goal = data?.goals.find((g) => g.goalId === dep.goalId)
      setMaturityWithdraw({
        item,
        goalId: dep.goalId,
        goalProgressValue: goal?.progressValue ?? goal?.currentValue ?? dep.raw.currentValue,
        goalTargetAmount: goal?.targetAmount ?? null,
        received: received ?? null,
      })
    } else {
      setSellItem(item)
      setSellPayout(received ?? null)
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
                    onClick={() => { setAddTxPrefill(null); setDesktopAddTxOpen(true) }}
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

                {/* Completed goals — kept on the page, out of the tracked grid */}
                {completedGoals.length > 0 && (
                  <section data-testid="completed-goals-section" style={{ marginBottom: 24 }}>
                    <h2 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
                      {isVi ? 'Mục tiêu đã hoàn thành' : 'Completed goals'}
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                      {completedGoals.map((goal) => (
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
                      onFundClick={fundHistory.open}
                      onAssignToGoal={(fundId, name, value, type) => { setGoalPickerFundId(fundId); setGoalPickerFundItem({ name, value, type }) }}
                      onSellFund={openSellFund}
                      onAssignNonFundToGoal={(txId, name, value, type) => { setNonFundPickerTxId(txId); setNonFundPickerItem({ name, value, type }) }}
                      onSellNonFund={openSellNonFund}
                      desktopCard
                      onDesktopAssign={assignInvestmentToGoal}
                      // Refreshing drops the assigned row and unmounts the
                      // section showing the success flash, so the section decides
                      // when that is safe rather than both sides running their
                      // own timer of the same length (#567).
                      onDesktopAssigned={() => fetchData({ force: true })}
                    />
                  </div>
                )}

                {/* Insurance */}
                <section style={{ marginBottom: 24 }}>
                  <DesktopInsuranceList
                    insurance={data.insurance}
                    locale={locale}
                    // Active goals only: an archived goal is not a goal left
                    // unprotected, and with every goal finished this counted them
                    // all as needing cover (#650).
                    goalCount={sortedGoals.length}
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
                    onAddToGoal={() => { setAddTxPrefill({ goal_id: selectedGoal.goalId }); setDesktopAddTxOpen(true) }}
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
                    refreshing={refreshing}
                    navUpdatedAt={data.netWorth.navUpdatedAt}
                    onDownloadReport={() => setShowReportSheet(true)}
                    history={history}
                    timeRange={timeRange}
                    onRangeChange={setTimeRange}
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
                  refreshing={refreshing}
                  history={history}
                  timeRange={timeRange}
                  onRangeChange={setTimeRange}
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

              {/* Completed goals — kept on the page, out of the tracked list */}
              {completedGoals.length > 0 && (
                <section data-testid="completed-goals-section" style={{ marginBottom: 20 }}>
                  <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
                    {isVi ? 'Mục tiêu đã hoàn thành' : 'Completed goals'}
                  </h2>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {completedGoals.map((goal) => (
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
                  onFundClick={fundHistory.open}
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
                    // Active goals only: an archived goal is not a goal left
                    // unprotected, and with every goal finished this counted them
                    // all as needing cover (#650).
                    goalCount={sortedGoals.length}
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
        open={!!(fundHistory.fundId && detailFund)}
        onClose={fundHistory.close}
        fundName={detailFund?.fundName ?? ''}
        currentNAV={detailFund?.currentNAV ?? 0}
        quantity={detailFund?.quantity ?? 0}
        currentValue={detailFund?.currentValue ?? 0}
        purchasePrice={detailFund?.purchasePrice ?? 0}
        profitLoss={detailFund?.profitLoss ?? 0}
        profitLossPercentage={detailFund?.profitLossPercentage ?? 0}
        purchaseHistory={fundHistory.items}
        loading={fundHistory.loading}
        error={fundHistory.failed}
        onRetry={() => { if (fundHistory.fundId) fundHistory.open(fundHistory.fundId) }}
      />

      {/* Assign Goal Sheet — funds */}
      <AssignGoalSheet
        open={!!goalPickerFundId}
        onClose={() => { setGoalPickerFundId(null); setGoalPickerFundItem(null); fetchData({ force: true }) }}
        item={goalPickerFundItem ?? undefined}
        desktop={isDesktop}
        onConfirm={async (goalId) => {
          if (!goalPickerFundId) return
          await assignInvestmentToGoal('fund', goalPickerFundId, goalId)
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
          await assignInvestmentToGoal('nonFund', nonFundPickerTxId, goalId)
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
        receivedPrefill={sellPayout}
        desktop={isDesktop}
        onClose={() => { setSellSheetOpen(false); setSellPayout(null) }}
        onSuccess={() => fetchData({ force: true })}
      />

      {/* Goal-context withdraw deep-linked from the maturity flow */}
      {maturityWithdraw && (
        <SellWithdrawSheet
          item={maturityWithdraw.item}
          open
          context="goal"
          goalId={maturityWithdraw.goalId}
          goalProgressValue={maturityWithdraw.goalProgressValue}
          goalTargetAmount={maturityWithdraw.goalTargetAmount}
          receivedPrefill={maturityWithdraw.received}
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
          onWithdraw={(received) => withdrawMaturingDeposit(resolveDep, received)}
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
          onWithdraw={(received) => withdrawMaturingDeposit(resolveDep, received)}
        />
      )}

      {/* Goal Detail Sheet */}
      <GoalDetailSheet
        goal={selectedGoal}
        open={goalDetailOpen}
        onClose={() => setGoalDetailOpen(false)}
        onDataChanged={() => fetchData({ force: true })}
        refreshKey={historyKey}
        onAddToGoal={selectedGoal ? () => { setAddTxPrefill({ goal_id: selectedGoal.goalId }); setDesktopAddTxOpen(true) } : undefined}
      />

      {/* Add Transaction Sheet — opened by the desktop button (blank) or by a
          goal detail's "Add to this goal" CTA (prefilled). Renders as a bottom
          sheet on mobile via desktop={isDesktop}. */}
      <AddTransactionSheet
        open={desktopAddTxOpen}
        onClose={() => { setDesktopAddTxOpen(false); setAddTxPrefill(null) }}
        onSaved={() => { fetchData({ force: true }); bumpHistoryKey() }}
        desktop={isDesktop}
        prefill={addTxPrefill}
      />

      {/* Download Report Sheet */}
      <DownloadReportSheet
        open={showReportSheet}
        onClose={() => setShowReportSheet(false)}
        data={data ? reportPreviewStats(data.netWorth, allSortedGoals) : null}
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
