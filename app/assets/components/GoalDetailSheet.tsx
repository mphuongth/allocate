'use client'

import { useState, useEffect } from 'react'
import {
  ChevronLeft, MoreHorizontal,
  Target, PiggyBank, Plus,
} from 'lucide-react'
import { iconHit } from './iconHit'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { fmt, fmtCompact, fmtPct } from '@/lib/formatters'
import { formatIntVN, parseIntVN } from '@/lib/numberFormat'
import type { GoalData, FundBreakdownItem } from '../DashboardClient'
import TransactionHistorySheet, { type PurchaseHistoryRow } from './TransactionHistorySheet'
import { SellWithdrawSheet } from './SellWithdrawSheet'
import { MaturityResolveSheet } from './MaturityResolveSheet'
import { GD_COLORS, TypeIcon, ProgressCreditNote, ProgressGatherNote, progressCredit, type InvRow, type GoalDetailTx } from './goalDetailShared'
import { buildCompositionSegments, buildInvRows, buildRenewalSummary } from './goalDetailRows'
import { computeGoalCalculator, describeHistoryRow } from './goalDetailModel'
import { fmtTxDate } from './transactionUtils'
import { TxRowsSkeleton } from './Skeletons'
import LoadError from './LoadError'
import { useGoalDetailData } from './useGoalDetailData'
import { deleteGoal, unholdTransaction, unassignInvestment } from './goalActions'
import { invToSellItem } from './invToSellItem'
import { GoalActionsSheet, DeleteGoalConfirmSheet, EditGoalSheet, InvestmentActionSheet, UnassignConfirmSheet } from './goalDetailDialogs'

interface Props {
  goal: GoalData | null
  open: boolean
  onClose: () => void
  onDataChanged: () => void
  /**
   * Monotonically increases each time the parent's dashboard data refreshes
   * (e.g. after assigning an investment from Unallocated). Including it in
   * the transactions-fetching useEffect ensures this sheet shows fresh data
   * without requiring a hard page reload.
   */
  refreshKey?: number
  /** Opens the Add-transaction flow prefilled with this goal, so a new
   *  contribution is logged straight to it (the sheet was otherwise a dead end). */
  onAddToGoal?: () => void
}

export default function GoalDetailSheet({ goal, open, onClose, onDataChanged, refreshKey, onAddToGoal }: Props) {
  const isVI = useLocale() === 'vi'
  const td = useTranslations('deleteTransaction')
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'investments' | 'calculator' | 'history'>('investments')
  // Bumped by the retry button to re-run the transactions fetch.
  const [txReload, setTxReload] = useState(0)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [actionInv, setActionInv] = useState<InvRow | null>(null)
  const [investActionOpen, setInvestActionOpen] = useState(false)
  const [resolveOpen, setResolveOpen] = useState(false)
  const [sellOpen, setSellOpen] = useState(false)
  const [unassignConfirmOpen, setUnassignConfirmOpen] = useState(false)
  const [unassigning, setUnassigning] = useState(false)
  const [unassignedIds, setUnassignedIds] = useState<string[]>([])
  // Transactions + gold price load (shared with DesktopGoalDetail, #467). The
  // sheet only loads while open; each load clears the optimistic unassign filter.
  const { transactions, txLoading, txError, goldPricePerChi } = useGoalDetailData({
    goalId: goal?.goalId,
    enabled: open && !!goal,
    refreshKey,
    txReload,
    onLoadStart: () => setUnassignedIds([]),
  })
  const [fundDetailId, setFundDetailId] = useState<string | null>(null)
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const [monthlyContrib, setMonthlyContrib] = useState('')

  useEffect(() => {
    if (open) {
      setMounted(true)
      setActiveTab('investments')
      setConfirmDeleteOpen(false)
    } else {
      const t = setTimeout(() => setMounted(false), 220)
      return () => clearTimeout(t)
    }
  }, [open])

  async function handleDelete() {
    if (!goal) return
    setIsDeleting(true)
    const ok = await deleteGoal(goal.goalId)
    setIsDeleting(false)
    if (!ok) {
      // Keep the confirm sheet open so the user can retry; don't claim success.
      toast.error(isVI ? 'Không thể xoá mục tiêu' : "Couldn't delete goal")
      return
    }
    onDataChanged()
    onClose()
    setActionsOpen(false)
  }

  // "Bỏ chờ gộp" — delete the held settlement row, which restores the original
  // deposit (its withdrawal no longer subtracts). onDataChanged re-fetches the
  // overview, so the chip drops and the deposit reappears in the list.
  const [unholdingId, setUnholdingId] = useState<string | null>(null)
  async function handleUnhold(heldTxId: string) {
    setUnholdingId(heldTxId)
    const result = await unholdTransaction(heldTxId)
    setUnholdingId(null)
    // Each refusal has its own remedy — "undo the merge" vs "cancel the pending
    // settlement" send the user to different places, so one generic message
    // isn't enough (#550).
    if (!result.ok) { toast.error(td(result.code)); return }
    onDataChanged()
  }

  // Mirror of DesktopGoalDetail.handleUnassign — fund rows aggregate every
  // fund-investment under the same fund, non-fund rows correspond to a
  // single investment_transactions row.
  async function handleUnassignConfirm() {
    if (!actionInv || !goal) return
    setUnassigning(true)
    const ok = await unassignInvestment(actionInv, goal.goalId)
    setUnassigning(false)
    if (!ok) { toast.error(isVI ? 'Không thể huỷ liên kết' : "Couldn't unassign"); return }
    setUnassignedIds((prev) => [...prev, actionInv.id])
    setUnassignConfirmOpen(false)
    setActionInv(null)
    onDataChanged()
  }

  async function openFundDetail(fund: FundBreakdownItem) {
    setFundDetailId(fund.fundId)
    setPurchaseHistory([])
    setHistoryError(false)
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/v1/fund-investments?fund_id=${fund.fundId}`)
      if (!res.ok) throw new Error('load failed')
      const items = await res.json()
      setPurchaseHistory(
        (items as Array<{ nav_at_purchase: number | null; units_purchased: number | null; investment_date: string | null; created_at: string; is_dca_seeded?: boolean }>)
          .filter((i) => !(i.is_dca_seeded && i.units_purchased == null))
          .map((i) => ({ purchase_date: i.investment_date ?? i.created_at, units: i.units_purchased, nav_at_purchase: i.nav_at_purchase }))
          .sort((a, b) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime())
      )
    } catch {
      // Distinguish a failed load from a genuinely empty history.
      setHistoryError(true)
    }
    setHistoryLoading(false)
  }

  if (!mounted || !goal) return null

  const progress = Math.min(goal.progressPercentage ?? 0, 100)
  const exceededTarget = goal.progressPercentage !== null && goal.progressPercentage >= 100
  const isPositive = goal.profitLoss >= 0
  // The bar runs off progressValue (affects_progress=false withdrawals added
  // back), so the fraction beside it uses the same numerator to stay coherent;
  // the big "current value" above stays net worth. creditedWithdrawn is the gap.
  const progValue = goal.progressValue ?? goal.currentValue
  const creditedWithdrawn = progressCredit(goal.currentValue, goal.progressValue)

  const fundMap = new Map(goal.funds.map((f) => [f.fundId, f]))

  // Build typed investment rows for the Investments tab, then drop any
  // optimistically-unassigned ones.
  const invRows: InvRow[] = buildInvRows(transactions, goal.funds, goldPricePerChi, isVI)
    .filter((row) => !unassignedIds.includes(row.id))

  // Calculator (shared projection math — #467). `monthly` is parsed here (the
  // input is comma-formatted on this surface) and drives the shared derivation.
  const monthly = Math.max(0, parseFloat(monthlyContrib.replace(/,/g, '')) || 0)
  const { remaining, monthsLeft, neededPerMonth, monthsToGoal, projectedDate, isOnTrack, gap } = computeGoalCalculator(goal, monthly)
  const projectedMonths = monthsToGoal ?? 0

  const detailFund = fundDetailId ? (fundMap.get(fundDetailId) ?? null) : null

  // Composition breakdown by asset type — held-for-merge cash is folded back in (see
  // helper) so the bar reconciles with the headline instead of summing short.
  const heldCompValue = (goal.heldForMerge ?? []).reduce((a, h) => a + h.amount, 0)
  const segs = buildCompositionSegments(invRows, heldCompValue, isVI)

  return (
    <>
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'var(--c-canvas,#faf9f7)',
          animation: open
            ? 'pop-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            : 'fade-out 180ms ease forwards',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: 'var(--c-canvas,#faf9f7)',
          padding: '14px 16px 10px',
          borderBottom: '1px solid transparent',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
            <button
              data-testid="goal-back-btn"
              onClick={onClose}
              style={{ ...iconHit, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-ink)', flexShrink: 0 }}
            >
              <ChevronLeft size={20} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
                {isVI ? 'Mục tiêu' : 'Goal'}
              </div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--c-ink)' }}>
                {goal.goalName}
              </h1>
            </div>
            <button
              data-testid="goal-options-btn"
              aria-label={isVI ? 'Tùy chọn mục tiêu' : 'Goal options'}
              onClick={() => setActionsOpen(true)}
              style={{ ...iconHit, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-ink)', flexShrink: 0 }}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
        </div>

        <div style={{ padding: '16px 16px 0' }}>
          {/* Hero card */}
          <div style={{
            background: 'var(--c-card)', borderRadius: 16, padding: 18,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 16,
          }}>
            <p style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 4 }}>
              {isVI ? 'Giá trị hiện tại' : 'Current value'}
            </p>
            <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-ink)', marginBottom: 2, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
              {fmt(goal.currentValue)}
            </p>
            {goal.targetAmount && (
              <p style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 12, fontVariantNumeric: 'tabular-nums' }}>
                {fmtCompact(progValue)} / {fmtCompact(goal.targetAmount)} {isVI ? 'mục tiêu' : 'target'}
              </p>
            )}
            {goal.targetAmount && (
              <>
                <div style={{ height: 8, background: 'var(--c-line)', borderRadius: 999, overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{
                    height: '100%', borderRadius: 999,
                    width: `${progress}%`,
                    background: exceededTarget ? 'var(--c-pos)' : 'var(--c-navy)',
                    transition: 'width 0.4s ease',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  <span>
                    {exceededTarget
                      ? (isVI ? 'Đã đạt mục tiêu' : 'Target reached')
                      : `${Math.round(progress)}% ${isVI ? 'hoàn thành' : 'complete'}`}
                  </span>
                </div>
              </>
            )}

            {goal.targetAmount && creditedWithdrawn > 0 && (
              <ProgressCreditNote amount={creditedWithdrawn} isVi={isVI} style={{ marginTop: 8 }} />
            )}

            {/* P/L strip — grid with separator lines */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1,
              marginTop: 16, background: 'var(--c-line)', borderRadius: 8, overflow: 'hidden',
            }}>
              {[
                { label: isVI ? 'Đã đầu tư' : 'Invested', value: fmtCompact(goal.totalInvested), color: 'var(--c-ink)' },
                { label: isVI ? 'Lãi/Lỗ' : 'P/L', value: (isPositive ? '+' : '') + fmtCompact(goal.profitLoss), color: isPositive ? 'var(--c-pos)' : 'var(--c-neg)' },
                { label: isVI ? 'Tỷ suất' : 'Return', value: fmtPct(goal.profitLossPercentage), color: goal.profitLossPercentage >= 0 ? 'var(--c-pos)' : 'var(--c-neg)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: 'var(--c-card)', padding: '10px 12px' }}>
                  <p style={{ fontSize: 10, color: 'var(--c-muted)', marginBottom: 2 }}>{label}</p>
                  <p style={{ fontSize: 13, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Add to this goal — opens the Add-transaction flow prefilled, so the
              sheet is a place you can fund the goal from, not just inspect it. */}
          {onAddToGoal && (
            <button
              data-testid="goal-add-to-goal"
              onClick={onAddToGoal}
              className="cn-btn primary"
              style={{ width: '100%', justifyContent: 'center', gap: 7, marginBottom: 16 }}
            >
              <Plus size={16} strokeWidth={2.4} />
              {isVI ? 'Thêm vào mục tiêu' : 'Add to this goal'}
            </button>
          )}

          {/* Composition bar */}
          {segs.length > 0 && (
            <div data-testid="goal-composition" style={{ background: 'var(--c-card)', borderRadius: 16, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', marginBottom: 10 }}>
                {isVI ? 'Cơ cấu' : 'Composition'}
              </p>
              <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', gap: 1 }}>
                {segs.map((s) => {
                  const total = segs.reduce((a, x) => a + x.value, 0)
                  const pct = total > 0 ? (s.value / total) * 100 : 0
                  return <div key={s.label} style={{ width: `${pct}%`, background: s.color, minWidth: pct > 0 ? 2 : 0 }} />
                })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                {segs.map((s) => {
                  const total = segs.reduce((a, x) => a + x.value, 0)
                  return (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--c-muted)', textTransform: 'capitalize', flex: 1 }}>{s.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                        {total > 0 ? Math.round((s.value / total) * 100) : 0}%
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--c-line)' }}>
            {(['investments', 'calculator', 'history'] as const).map((tab) => {
              const labels = {
                investments: isVI ? 'Khoản đầu tư' : 'Investments',
                calculator: isVI ? 'Tính toán' : 'Calculator',
                history: isVI ? 'Lịch sử' : 'History',
              }
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '10px 10px 10px 0', marginRight: 8,
                    fontSize: 13, fontWeight: 600,
                    color: activeTab === tab ? 'var(--c-ink)' : 'var(--c-muted)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    borderBottom: activeTab === tab ? '2px solid var(--c-navy)' : '2px solid transparent',
                    whiteSpace: 'nowrap', fontFamily: 'inherit',
                  }}
                >
                  {labels[tab]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab content */}
        <div style={{ padding: '12px 16px 80px' }}>

          {/* Investments tab */}
          {activeTab === 'investments' && (
            <div style={{ background: 'var(--c-card)', borderRadius: 16, padding: '0 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              {/* "Ví chờ gộp" — settle-with-hold settlements still pooled. Each shows
                  a chip with "Bỏ chờ gộp" that restores the original deposit. */}
              {(goal.heldForMerge ?? []).length > 0 && (
                <div data-testid="held-pool-section" style={{ padding: '12px 0', borderBottom: '1px solid var(--c-line)', display: 'grid', gap: 8 }}>
                  {(goal.heldForMerge ?? []).map((h) => (
                    <div key={h.transactionId} data-testid={`held-chip-${h.transactionId}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--c-card-2)', color: 'var(--c-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <PiggyBank size={15} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name ?? (isVI ? 'Sổ chờ gộp' : 'Held deposit')}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--c-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                          {fmtCompact(h.amount)} · {isVI ? 'Đang chờ gộp' : 'Held for merge'}
                        </div>
                      </div>
                      <button type="button" data-testid={`unhold-${h.transactionId}`} onClick={() => handleUnhold(h.transactionId)} disabled={unholdingId === h.transactionId}
                        style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', background: 'none', border: '1px solid var(--c-line)', borderRadius: 8, padding: '5px 10px', cursor: unholdingId === h.transactionId ? 'default' : 'pointer', opacity: unholdingId === h.transactionId ? 0.6 : 1, fontFamily: 'inherit' }}>
                        {isVI ? 'Bỏ chờ gộp' : 'Unhold'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {txLoading && <TxRowsSkeleton />}
              {!txLoading && txError && (
                <LoadError isVI={isVI} onRetry={() => setTxReload((n) => n + 1)} />
              )}
              {!txLoading && !txError && invRows.length === 0 && (
                <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
                  {isVI ? 'Chưa có khoản đầu tư nào' : 'No investments yet'}
                </p>
              )}
              {!txLoading && invRows.map((inv, i) => {
                const typeColor = GD_COLORS[inv.type] ?? 'var(--c-muted)'
                return (
                  <div
                    key={inv.id}
                    style={{
                      padding: '14px 0',
                      borderBottom: i === invRows.length - 1 ? 'none' : '1px solid var(--c-line)',
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}
                  >
                    {/* Type icon */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, background: 'var(--c-card-2)',
                      color: typeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <TypeIcon type={inv.type} size={16} />
                    </div>

                    {/* Name + meta — tappable */}
                    <button
                      onClick={() => { setActionInv(inv); setInvestActionOpen(true) }}
                      style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-ink)' }}>
                        {inv.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                        {inv.units != null
                          ? `${inv.units.toLocaleString('vi-VN')} ${isVI ? 'phần' : inv.units === 1 ? 'unit' : 'units'}`
                          : inv.principal != null
                            ? `${isVI ? 'Gốc' : 'Principal'} ${fmtCompact(inv.principal)}`
                            : ''}
                      </div>
                    </button>

                    {/* Value + gain */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(inv.value)}</div>
                      {inv.gainPct != null && (
                        <div style={{ fontSize: 11, color: inv.gainPct >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                          {fmtPct(inv.gainPct)}
                        </div>
                      )}
                    </div>

                    {/* ⋯ button */}
                    <button
                      onClick={() => { setActionInv(inv); setInvestActionOpen(true) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--c-muted)', flexShrink: 0 }}
                      aria-label="Options"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Calculator tab */}
          {activeTab === 'calculator' && (
            <div style={{ display: 'grid', gap: 12 }}>
              {/* Amount input */}
              <div style={{ padding: 16, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  {isVI ? 'Nếu tôi đóng góp mỗi tháng' : 'If I contribute per month'}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--c-canvas,#faf9f7)', border: '2px solid var(--c-navy)', borderRadius: 10, minWidth: 0 }}>
                    <span style={{ fontSize: 15, color: 'var(--c-muted)', flexShrink: 0 }}>₫</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatIntVN(monthlyContrib)}
                      onChange={(e) => setMonthlyContrib(parseIntVN(e.target.value))}
                      placeholder="0"
                      style={{
                        flex: 1, border: 'none', outline: 'none',
                        fontSize: 18, fontWeight: 700, fontFamily: 'inherit',
                        background: 'transparent', color: 'var(--c-ink)',
                        letterSpacing: '-0.02em', minWidth: 0, width: '100%',
                      }}
                    />
                  </div>
                  {goal.targetAmount && neededPerMonth > 0 && (
                    <button
                      onClick={() => setMonthlyContrib(String(Math.round(neededPerMonth)))}
                      style={{
                        flexShrink: 0, padding: '8px 10px',
                        background: 'var(--c-navy-tint)', color: 'var(--c-navy)',
                        border: '1px solid var(--c-navy-tint)', borderRadius: 10,
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        fontFamily: 'inherit', lineHeight: 1.3,
                        textAlign: 'center', whiteSpace: 'nowrap',
                      }}
                    >
                      {isVI ? 'Tối thiểu' : 'Min'}
                    </button>
                  )}
                </div>

                {/* Quick presets */}
                {goal.targetAmount && neededPerMonth > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    {[0.5, 1, 1.5, 2].map((mul) => {
                      const preset = Math.round(neededPerMonth * mul / 100000) * 100000 || Math.round(neededPerMonth * mul)
                      const isActive = monthly === preset
                      return (
                        <button
                          key={mul}
                          onClick={() => setMonthlyContrib(String(preset))}
                          style={{
                            padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500,
                            background: isActive ? 'var(--c-btn-primary)' : 'var(--c-card-2)',
                            color: isActive ? '#fff' : 'var(--c-muted)',
                            border: '1px solid var(--c-line)', cursor: 'pointer',
                            fontFamily: 'inherit', transition: 'all 120ms',
                          }}
                        >
                          {fmtCompact(preset)}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Result card */}
              {monthly > 0 && projectedDate && goal.targetAmount && (
                <div style={{
                  padding: 16, borderRadius: 14,
                  background: isOnTrack ? 'var(--c-pos-tint)' : 'var(--c-warn-tint)',
                  border: `1px solid ${isOnTrack ? 'rgba(4,120,87,0.15)' : 'rgba(180,83,9,0.15)'}`,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: isOnTrack ? 'var(--c-pos)' : 'var(--c-warn)', marginBottom: 6 }}>
                    {isVI ? 'Dự kiến hoàn thành' : 'Projected completion'}
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', color: isOnTrack ? 'var(--c-pos)' : 'var(--c-warn)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                    {projectedDate.toLocaleDateString(isVI ? 'vi-VN' : 'en-GB', { month: 'long', year: 'numeric' })}
                  </div>
                  <div style={{ fontSize: 12, color: isOnTrack ? 'var(--c-pos)' : 'var(--c-warn)', marginTop: 6, opacity: 0.85 }}>
                    {isVI ? `Sau ${projectedMonths} tháng` : `In ${projectedMonths} ${projectedMonths === 1 ? 'month' : 'months'}`}
                    {goal.targetDate && (isOnTrack
                      ? (isVI ? ` · ${monthsLeft - projectedMonths} tháng sớm hơn` : ` · ${monthsLeft - projectedMonths} ${monthsLeft - projectedMonths === 1 ? 'month' : 'months'} early`)
                      : (isVI ? ` · ${projectedMonths - monthsLeft} tháng trễ hạn` : ` · ${projectedMonths - monthsLeft} ${projectedMonths - monthsLeft === 1 ? 'month' : 'months'} late`)
                    )}
                  </div>
                </div>
              )}

              {/* Key numbers */}
              {monthly > 0 && goal.targetAmount && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, background: 'var(--c-line)', borderRadius: 12, overflow: 'hidden' }}>
                  {[
                    { l: isVI ? 'Còn thiếu' : 'Still needed', v: fmtCompact(remaining), c: 'var(--c-ink)' },
                    { l: isVI ? 'Tháng còn lại' : 'Months left', v: String(monthsLeft), c: 'var(--c-ink)' },
                    { l: isVI ? 'Tối thiểu/tháng' : 'Min/month', v: neededPerMonth > 0 ? fmtCompact(neededPerMonth) : '—', c: 'var(--c-muted)' },
                    { l: isOnTrack ? (isVI ? 'Dư/tháng' : 'Surplus/mo') : (isVI ? 'Thiếu/tháng' : 'Gap/month'), v: neededPerMonth > 0 ? fmtCompact(gap) : '—', c: isOnTrack ? 'var(--c-pos)' : 'var(--c-neg)' },
                  ].map((k, i) => (
                    <div key={i} style={{ background: 'var(--c-card)', padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{k.l}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, color: k.c, fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
                    </div>
                  ))}
                </div>
              )}

              {monthly > 0 && goal.targetAmount && creditedWithdrawn > 0 && remaining > 0 && (
                <ProgressGatherNote amount={creditedWithdrawn} isVi={isVI} />
              )}

              {/* Empty state */}
              {monthly <= 0 && (
                <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--c-muted)' }}>
                  <Target size={32} color="var(--c-line-strong)" />
                  <p style={{ margin: '10px 0 0', fontSize: 13 }}>
                    {isVI ? 'Nhập số tiền để xem dự báo' : 'Enter an amount to see your projection'}
                  </p>
                </div>
              )}

              {/* No target set */}
              {!goal.targetAmount && monthly > 0 && (
                <p style={{ fontSize: 13, color: 'var(--c-muted)', textAlign: 'center', padding: '8px 0' }}>
                  {isVI ? 'Đặt mục tiêu để xem dự báo thời gian.' : 'Set a target amount to see projected completion date.'}
                </p>
              )}
            </div>
          )}

          {/* History tab */}
          {activeTab === 'history' && (
            <div style={{ background: 'var(--c-card)', borderRadius: 16, padding: '0 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              {txLoading && <TxRowsSkeleton />}
              {!txLoading && txError && (
                <LoadError isVI={isVI} onRetry={() => setTxReload((n) => n + 1)} />
              )}
              {!txLoading && !txError && transactions.length === 0 && (
                <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
                  {isVI ? 'Chưa có giao dịch nào' : 'No transactions yet'}
                </p>
              )}
              {!txLoading && transactions.map((tx, i) => {
                const isRenewed = !!tx.renewed_from_transaction_id
                const { kind, ink, fill, Icon, sign, name } = describeHistoryRow(tx, isRenewed, isVI)
                return (
                  <div
                    key={tx.transaction_id}
                    data-testid={isRenewed ? 'history-renewed-row' : undefined}
                    style={{
                      padding: '14px 0',
                      borderBottom: i === transactions.length - 1 ? 'none' : '1px solid var(--c-line)',
                      display: 'flex', alignItems: 'center', gap: 12,
                      opacity: isRenewed ? 0.6 : 1,
                    }}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: fill, color: ink,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon size={14} strokeWidth={2.2} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                        {isRenewed && (
                          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: 'var(--c-card-2)', color: 'var(--c-muted)' }}>
                            {isVI ? 'Đã tái tục' : 'Renewed'}
                          </span>
                        )}
                        {(kind === 'held' || kind === 'consumed') && (
                          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: 'var(--c-card-2)', color: 'var(--c-muted)' }}>
                            {kind === 'held' ? (isVI ? 'Chờ gộp' : 'For merge') : (isVI ? 'Đã gộp' : 'Merged')}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2 }}>
                        {fmtTxDate(tx.investment_date, isVI ? 'vi' : 'en')}
                      </div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: ink, fontVariantNumeric: 'tabular-nums' }}>
                      {sign}{fmtCompact(tx.amount_vnd)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sub-sheets */}
      <GoalActionsSheet
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        onEdit={() => { setActionsOpen(false); setTimeout(() => setEditOpen(true), 60) }}
        onDelete={() => { setActionsOpen(false); setTimeout(() => setConfirmDeleteOpen(true), 60) }}
        isDeleting={isDeleting}
      />

      <DeleteGoalConfirmSheet
        open={confirmDeleteOpen}
        goalName={goal.goalName}
        isDeleting={isDeleting}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
      />

      {editOpen && (
        <EditGoalSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          goal={goal}
          onSaved={onDataChanged}
        />
      )}

      <InvestmentActionSheet
        open={investActionOpen}
        onClose={() => setInvestActionOpen(false)}
        inv={actionInv}
        renewalSummary={actionInv ? buildRenewalSummary(transactions as GoalDetailTx[], actionInv.id) : null}
        onViewHistory={() => {
          if (actionInv?.fund) openFundDetail(actionInv.fund)
          else setActiveTab('history')
        }}
        onSell={() => setSellOpen(true)}
        onUnassign={() => setUnassignConfirmOpen(true)}
        onResolve={() => setResolveOpen(true)}
        onChanged={onDataChanged}
      />

      <MaturityResolveSheet
        open={resolveOpen}
        inv={actionInv}
        goalId={goal.goalId}
        siblingDeposits={invRows}
        heldSiblings={(goal.heldForMerge ?? []).map((h) => ({ id: h.transactionId, name: h.name, amount: h.amount }))}
        isVi={isVI}
        onClose={() => setResolveOpen(false)}
        onRenewed={() => { setResolveOpen(false); onDataChanged() }}
        onWithdraw={() => { setResolveOpen(false); setSellOpen(true) }}
      />

      <SellWithdrawSheet
        open={sellOpen}
        item={actionInv ? invToSellItem(actionInv) : null}
        context="goal"
        goalId={goal.goalId}
        goalCurrentValue={goal.currentValue}
        goalTargetAmount={goal.targetAmount}
        onClose={() => setSellOpen(false)}
        onSuccess={() => {
          setSellOpen(false)
          if (actionInv) setUnassignedIds((prev) => [...prev, actionInv.id])
          onDataChanged()
        }}
      />

      <UnassignConfirmSheet
        open={unassignConfirmOpen}
        onClose={() => !unassigning && setUnassignConfirmOpen(false)}
        inv={actionInv}
        onConfirm={handleUnassignConfirm}
        unassigning={unassigning}
      />

      <TransactionHistorySheet
        open={!!(fundDetailId && detailFund)}
        onClose={() => { setFundDetailId(null); setPurchaseHistory([]); setHistoryLoading(false); setHistoryError(false) }}
        fundName={detailFund?.fundName ?? ''}
        currentNAV={detailFund?.currentNAV ?? 0}
        quantity={detailFund?.quantity ?? 0}
        currentValue={detailFund?.currentValue ?? 0}
        purchasePrice={detailFund?.purchasePrice ?? 0}
        profitLoss={detailFund?.profitLoss ?? 0}
        profitLossPercentage={detailFund?.profitLossPercentage ?? 0}
        purchaseHistory={purchaseHistory}
        loading={historyLoading}
        error={historyError}
        onRetry={() => { if (detailFund) openFundDetail(detailFund) }}
      />
    </>
  )
}
