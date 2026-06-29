'use client'

import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, X, MoreHorizontal, Edit2, Trash2, ChevronRight, ArrowDownRight, ArrowUpRight, Target, CalendarDays, Check, ArrowDownToLine, Wallet, Shield, RefreshCw, PiggyBank, GitMerge, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { fmt, fmtCompact, fmtPct } from '@/lib/formatters'
import type { GoalData } from '../DashboardClient'
import { GD_COLORS, buildCompositionSegments, calcDeadlineMonths, TypeIcon, UnlinkSvg, buildInvRows, buildRenewalSummary, AffectsProgressControl, BankInfoStrip, TopUpControl, RenewalSummaryLine, needsMaturityAction, needsBookMaturityAction, ProgressCreditNote, ProgressGatherNote, progressCredit, type InvRow, type GoalDetailTx } from './goalDetailShared'
import { MaturityResolveModal } from './MaturityResolveSheet'
import { fmtTxDate, txKind } from './transactionUtils'
import { TxRowsSkeleton } from './Skeletons'
import LoadError from './LoadError'
import { todayIso } from '@/lib/dates'

interface InvestmentTx {
  transaction_id: string
  transaction_type: string
  asset_type: string
  fund_id: string | null
  fund_name: string | null
  parent_transaction_id: string | null
  investment_date: string
  amount_vnd: number
  units: number | null
  interest_rate: number | null
  expiry_date: string | null
  notes: string | null
  principal_withdrawn: number | null
  units_withdrawn: number | null
  renewed_from_transaction_id?: string | null
  interest_earned_vnd?: number | null
  is_recurring?: boolean
  held_for_merge?: boolean | null
  consumed_by_inv_id?: string | null
}

interface Props {
  goal: GoalData
  locale: string
  onClose: () => void
  onDataChanged: () => void
  /**
   * Like onDataChanged, but for actions that leave the deposit IN this goal (a
   * renewal): refresh the dashboard data WITHOUT closing the panel, so the user
   * stays on the goal and can see the rolled-forward deposit / renewal-history
   * summary. Falls back to onDataChanged when not provided.
   */
  onRenewed?: () => void
  /**
   * Monotonically increases each time the parent's dashboard data refreshes
   * (e.g. after assigning an investment from Unallocated). Including it in
   * the transactions-fetching useEffect keeps this panel in sync without
   * requiring a hard page reload.
   */
  refreshKey?: number
  /** Opens the Add-transaction flow prefilled with this goal, so a new
   *  contribution is logged straight to it (the goal detail was otherwise a
   *  dead end — no way to add money from here). */
  onAddToGoal?: () => void
}

export default function DesktopGoalDetail({ goal, locale, onClose, onDataChanged, onRenewed, refreshKey, onAddToGoal }: Props) {
  const isVi = locale === 'vi'
  const [tab, setTab] = useState<'investments' | 'calculator' | 'history'>('investments')
  const [transactions, setTransactions] = useState<InvestmentTx[]>([])
  const [goldPricePerChi, setGoldPricePerChi] = useState<number | null>(null)
  const [txLoading, setTxLoading] = useState(false)
  const [txError, setTxError] = useState(false)
  // Bumped by the retry button to re-run the transactions fetch.
  const [txReload, setTxReload] = useState(0)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [calcAmount, setCalcAmount] = useState('')

  // Investment options state
  const [actionInv, setActionInv] = useState<InvRow | null>(null)
  const [showInvOptions, setShowInvOptions] = useState(false)
  const [showResolve, setShowResolve] = useState(false)
  const [showSell, setShowSell] = useState(false)
  const [showUnassignConfirm, setShowUnassignConfirm] = useState(false)
  const [unassigning, setUnassigning] = useState(false)
  const [unassignedIds, setUnassignedIds] = useState<string[]>([])

  useEffect(() => {
    setTxLoading(true)
    setTxError(false)
    // The new server response is the source of truth — drop any locally
    // hidden tx IDs from the unassign flow so a re-assigned tx isn't stuck
    // behind the optimistic filter on subsequent refreshes.
    setUnassignedIds([])
    // cache: 'no-store' — same reason as GoalDetailSheet: prevent the browser
    // from serving a stale list after an assign-from-Unallocated.
    // Recurring savings are plan-only (no investment_transactions row), so fetch
    // their realized contributions separately and merge into the history list.
    Promise.all([
      // The investments list is built from these rows — a failed fetch must
      // surface a retry, not render as "No investments yet".
      fetch(`/api/v1/investment-transactions?goal_id=${goal.goalId}&limit=200&include_history=true`, { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error('load failed'); return r.json() }),
      // Recurring contributions are supplementary — degrade to empty on failure.
      fetch(`/api/v1/savings-goals/${goal.goalId}/recurring-contributions`, { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : { contributions: [] })
        .catch(() => ({ contributions: [] })),
    ])
      .then(([txRes, recRes]) => {
        const merged: InvestmentTx[] = [...(txRes.transactions ?? []), ...(recRes.contributions ?? [])]
        merged.sort((a, b) => (a.investment_date < b.investment_date ? 1 : a.investment_date > b.investment_date ? -1 : 0))
        setTransactions(merged)
      })
      .catch(() => { setTransactions([]); setTxError(true) })
      .finally(() => setTxLoading(false))
    // Gold is valued at the live market price per chỉ, not its purchase cost —
    // without this the sell modal would prefill the stale buy price (issue #251).
    fetch('/api/v1/gold-price', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((res) => setGoldPricePerChi(res?.price_per_chi ?? null))
      .catch(() => setGoldPricePerChi(null))
  }, [goal.goalId, refreshKey, txReload])

  // Reset tab when the selected goal itself changes.
  useEffect(() => {
    setTab('investments')
  }, [goal.goalId])

  async function handleDelete() {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/v1/savings-goals/${goal.goalId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('delete failed')
      setDeleteOpen(false)
      onDataChanged()
    } catch {
      // Keep the confirm modal open so the user can retry; don't claim success.
      toast.error(isVi ? 'Không thể xoá mục tiêu' : "Couldn't delete goal")
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleUnassign() {
    if (!actionInv) return
    setUnassigning(true)
    try {
      if (actionInv.fund) {
        const res = await fetch(`/api/v1/fund-investments?fund_id=${actionInv.fund.fundId}`)
        if (!res.ok) throw new Error('fetch failed')
        const data = await res.json() as { investments?: Array<{ id: string }> }
        const investments = data.investments ?? []
        const results = await Promise.all(investments.map((fi) =>
          fetch(`/api/v1/fund-investments/${fi.id}/goal`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ goal_id: null }),
          })
        ))
        if (results.some((r) => !r.ok)) throw new Error('unassign failed')
      } else {
        const res = await fetch(`/api/v1/investment-transactions/${actionInv.id}/assign`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal_id: null }),
        })
        if (!res.ok) throw new Error('unassign failed')
      }
      setUnassignedIds((prev) => [...prev, actionInv.id])
      setShowUnassignConfirm(false)
      setActionInv(null)
      onDataChanged()
    } catch {
      toast.error(isVi ? 'Không thể huỷ liên kết' : "Couldn't unassign")
    } finally {
      setUnassigning(false)
    }
  }

  const isPos = goal.profitLoss >= 0
  const isComplete = (goal.progressPercentage ?? 0) >= 100
  const progress = Math.min(goal.progressPercentage ?? 0, 100)
  // Bar (progress) vs the big value (net worth) diverge by any affects_progress=false
  // withdrawal added back to progress — surfaced as a reconciling caption.
  const creditedWithdrawn = progressCredit(goal.currentValue, goal.progressValue)

  // Build investment rows (shared with the mobile sheet's valuation logic).
  const invRows: InvRow[] = buildInvRows(transactions, goal.funds, goldPricePerChi, isVi)

  // Composition segments — held-for-merge cash is folded back in (see helper) so the
  // bar reconciles with the headline instead of summing short.
  const heldCompValue = (goal.heldForMerge ?? []).reduce((a, h) => a + h.amount, 0)
  const segs = buildCompositionSegments(invRows, heldCompValue, isVi)
  const segsTotal = segs.reduce((a, x) => a + x.value, 0)

  // Calculator
  const remaining = Math.max(0, (goal.targetAmount ?? 0) - goal.currentValue)
  const monthsLeft = calcDeadlineMonths(goal.targetDate)
  const neededPerMonth = remaining > 0 ? remaining / monthsLeft : 0
  const calcInput = Math.max(0, Number(calcAmount) || 0)
  const monthsToGoal = calcInput > 0 && remaining > 0 ? Math.ceil(remaining / calcInput) : null
  const projectedDate = monthsToGoal != null ? (() => { const d = new Date(); d.setMonth(d.getMonth() + monthsToGoal); return d })() : null
  const isOnTrack = calcInput > 0 && calcInput >= neededPerMonth
  const gap = Math.abs(neededPerMonth - calcInput)

  const visibleInvRows = invRows.filter((inv) => !unassignedIds.includes(inv.id))

  // "Bỏ chờ gộp" — delete the held settlement row, restoring the original deposit;
  // onDataChanged re-fetches so the chip drops and the deposit reappears.
  const [unholdingId, setUnholdingId] = useState<string | null>(null)
  async function handleUnhold(heldTxId: string) {
    setUnholdingId(heldTxId)
    try {
      const res = await fetch(`/api/v1/investment-transactions/${heldTxId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('unhold failed')
      onDataChanged()
    } catch {
      toast.error(isVi ? 'Không thể bỏ chờ gộp' : "Couldn't cancel the merge hold")
    } finally {
      setUnholdingId(null)
    }
  }

  return (
    <>
      <div data-testid="desktop-goal-detail" style={{ display: 'flex', flexDirection: 'column', gap: 14, animation: 'slide-right 200ms cubic-bezier(0.2,0.8,0.2,1)' }}>
        {/* Back */}
        <button
          data-testid="desktop-goal-detail-back"
          onClick={onClose}
          className="cn-btn ghost"
          style={{ alignSelf: 'flex-start', padding: '6px 0', gap: 4, fontSize: 12, color: 'var(--c-muted)' }}
        >
          <ChevronLeft size={14} />
          {isVi ? 'Quay lại' : 'Back'}
        </button>

        {/* Hero card */}
        <div className="cn-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 3 }}>
                {isVi ? 'Mục tiêu' : 'Goal'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {goal.goalName}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {goal.progressPercentage !== null && (
                <span data-testid="desktop-goal-detail-progress" style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                  background: isComplete ? 'var(--c-pos-tint)' : 'var(--c-navy-tint)',
                  color: isComplete ? 'var(--c-pos)' : 'var(--c-navy)',
                }}>
                  {Math.round(progress)}%
                </span>
              )}
              <button
                onClick={() => setActionsOpen(true)}
                className="cn-btn ghost"
                style={{ padding: 5 }}
                aria-label="Goal options"
              >
                <MoreHorizontal size={15} color="var(--c-muted)" />
              </button>
            </div>
          </div>

          <div data-testid="desktop-goal-detail-value" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
            {fmt(goal.currentValue)}
          </div>

          {goal.targetAmount && (
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
              {isVi ? 'Mục tiêu' : 'Target'} {fmtCompact(goal.targetAmount)}
              {goal.targetDate && ` · ${isVi ? 'Hạn' : 'Due'} ${goal.targetDate}`}
            </div>
          )}

          {goal.progressPercentage !== null && (
            <div style={{ height: 6, borderRadius: 999, background: 'var(--c-line)', overflow: 'hidden', marginTop: 12 }}>
              <div style={{
                height: '100%', borderRadius: 999, width: `${progress}%`,
                background: isComplete ? 'var(--c-pos)' : 'var(--c-navy)',
                transition: 'width 400ms ease',
              }} />
            </div>
          )}

          {goal.progressPercentage !== null && creditedWithdrawn > 0 && (
            <ProgressCreditNote amount={creditedWithdrawn} isVi={isVi} style={{ marginTop: 8 }} />
          )}

          {/* P/L grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, marginTop: 12, background: 'var(--c-line)', borderRadius: 8, overflow: 'hidden' }}>
            {[
              { l: isVi ? 'Đã đầu tư' : 'Invested', v: fmtCompact(goal.totalInvested), c: 'var(--c-ink)' },
              { l: isVi ? 'Lãi/Lỗ' : 'P/L', v: (isPos ? '+' : '') + fmtCompact(goal.profitLoss), c: isPos ? 'var(--c-pos)' : 'var(--c-neg)' },
              { l: isVi ? 'Tỷ suất' : 'Return', v: fmtPct(goal.profitLossPercentage), c: isPos ? 'var(--c-pos)' : 'var(--c-neg)' },
            ].map((k, i) => (
              <div key={i} style={{ background: 'var(--c-card)', padding: '9px 10px' }}>
                <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{k.l}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: k.c, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Add to this goal — turns the detail panel from a dead end into a place
            you can fund the goal from. Opens the Add-transaction flow prefilled. */}
        {onAddToGoal && (
          <button
            data-testid="goal-add-to-goal"
            onClick={onAddToGoal}
            className="cn-btn primary"
            style={{ width: '100%', justifyContent: 'center', gap: 7 }}
          >
            <Plus size={15} strokeWidth={2.4} />
            {isVi ? 'Thêm vào mục tiêu' : 'Add to this goal'}
          </button>
        )}

        {/* Composition */}
        {segs.length > 0 && (
          <div data-testid="goal-composition" className="cn-card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 10 }}>
              {isVi ? 'Cơ cấu' : 'Composition'}
            </div>
            <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', gap: 1 }}>
              {segs.map((s) => (
                <div key={s.label} style={{ width: `${segsTotal > 0 ? (s.value / segsTotal) * 100 : 0}%`, background: s.color }} />
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '5px 10px', marginTop: 10 }}>
              {segs.map((s) => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--c-muted)', textTransform: 'capitalize', flex: 1 }}>{s.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                    {segsTotal > 0 ? ((s.value / segsTotal) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs card */}
        <div className="cn-card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--c-line)', padding: '0 16px' }}>
            {([
              { id: 'investments', label: isVi ? 'Khoản đầu tư' : 'Investments' },
              { id: 'calculator',  label: isVi ? 'Tính toán' : 'Calculator' },
              { id: 'history',     label: isVi ? 'Lịch sử' : 'History' },
            ] as const).map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                background: 'transparent', border: 'none', padding: '11px 0', marginRight: 20,
                fontSize: 12, fontWeight: 600,
                color: tab === t.id ? 'var(--c-ink)' : 'var(--c-muted)',
                borderBottom: tab === t.id ? '2px solid var(--c-navy)' : '2px solid transparent',
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}>{t.label}</button>
            ))}
          </div>

          {/* Investments tab */}
          {tab === 'investments' && (
            <>
              {/* "Ví chờ gộp" — pooled settle-with-hold settlements, each with a
                  "Bỏ chờ gộp" action that restores the original deposit. */}
              {(goal.heldForMerge ?? []).length > 0 && (
                <div data-testid="held-pool-section" style={{ padding: '8px 16px 12px', borderBottom: '1px solid var(--c-line)', display: 'grid', gap: 8 }}>
                  {(goal.heldForMerge ?? []).map((h) => (
                    <div key={h.transactionId} data-testid={`held-chip-${h.transactionId}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--c-card-2)', color: 'var(--c-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <PiggyBank size={15} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name ?? (isVi ? 'Sổ chờ gộp' : 'Held deposit')}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--c-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                          {fmtCompact(h.amount)} · {isVi ? 'Đang chờ gộp' : 'Held for merge'}
                        </div>
                      </div>
                      <button type="button" data-testid={`unhold-${h.transactionId}`} onClick={() => handleUnhold(h.transactionId)} disabled={unholdingId === h.transactionId}
                        style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', background: 'none', border: '1px solid var(--c-line)', borderRadius: 8, padding: '5px 10px', cursor: unholdingId === h.transactionId ? 'default' : 'pointer', opacity: unholdingId === h.transactionId ? 0.6 : 1, fontFamily: 'inherit' }}>
                        {isVi ? 'Bỏ chờ gộp' : 'Unhold'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {txLoading && <TxRowsSkeleton />}
              {!txLoading && txError && (
                <LoadError isVI={isVi} onRetry={() => setTxReload((n) => n + 1)} compact />
              )}
              {!txLoading && !txError && visibleInvRows.length === 0 && (
                <p style={{ color: 'var(--c-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                  {isVi ? 'Chưa có khoản đầu tư nào' : 'No investments yet'}
                </p>
              )}
              {!txLoading && visibleInvRows.map((inv, i) => (
                <div key={inv.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 16px',
                  borderBottom: i < visibleInvRows.length - 1 ? '1px solid var(--c-line)' : 'none',
                }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--c-card-2)', color: GD_COLORS[inv.type] ?? 'var(--c-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <TypeIcon type={inv.type} size={13} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-ink)' }}>
                      {inv.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {inv.units != null
                        ? `${inv.units.toLocaleString('vi-VN')} ${isVi ? 'phần' : inv.units === 1 ? 'unit' : 'units'}`
                        : inv.principal != null
                          ? `${isVi ? 'Gốc' : 'Principal'} ${fmtCompact(inv.principal)}`
                          : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(inv.value)}</div>
                    {inv.gainPct != null && (
                      <div style={{ fontSize: 10, color: inv.gainPct >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtPct(inv.gainPct)}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => { setActionInv(inv); setShowInvOptions(true) }}
                    className="cn-btn ghost"
                    style={{ padding: 5, flexShrink: 0 }}
                    aria-label="Options"
                  >
                    <MoreHorizontal size={14} color="var(--c-muted)" />
                  </button>
                </div>
              ))}
            </>
          )}

          {/* Calculator tab */}
          {tab === 'calculator' && (
            <div style={{ padding: '14px 16px', display: 'grid', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  {isVi ? 'Nếu tôi đóng góp mỗi tháng' : 'If I contribute per month'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-canvas,#faf9f7)', border: '2px solid var(--c-navy)', borderRadius: 10, overflow: 'hidden', minWidth: 0 }}>
                    <span style={{ fontSize: 14, color: 'var(--c-muted)', flexShrink: 0 }}>₫</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={calcAmount ? Number(calcAmount).toLocaleString('en-US') : ''}
                      onChange={(e) => setCalcAmount(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))}
                      placeholder="0"
                      style={{ width: '100%', minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', background: 'transparent', color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}
                    />
                  </div>
                  {neededPerMonth > 0 && (
                    <button
                      onClick={() => setCalcAmount(String(Math.round(neededPerMonth)))}
                      style={{ padding: '8px 10px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 10, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {isVi ? 'Tối thiểu' : 'Min'}
                    </button>
                  )}
                </div>
                {neededPerMonth > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {[0.5, 1, 1.5, 2].map((mul) => {
                      const preset = Math.round(neededPerMonth * mul / 100000) * 100000 || Math.round(neededPerMonth * mul)
                      return (
                        <button key={mul} onClick={() => setCalcAmount(String(preset))} style={{
                          padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500,
                          background: Number(calcAmount) === preset ? 'var(--c-btn-primary)' : 'var(--c-card-2)',
                          color: Number(calcAmount) === preset ? '#fff' : 'var(--c-muted)',
                          border: '1px solid var(--c-line)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 120ms',
                        }}>{fmtCompact(preset)}</button>
                      )
                    })}
                  </div>
                )}
              </div>

              {calcInput > 0 && projectedDate && goal.targetAmount && (
                <div style={{
                  padding: 14,
                  background: isOnTrack ? 'var(--c-pos-tint)' : 'var(--c-warn-tint)',
                  border: `1px solid ${isOnTrack ? 'rgba(4,120,87,0.15)' : 'rgba(180,83,9,0.15)'}`,
                  borderRadius: 12,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: isOnTrack ? 'var(--c-pos)' : 'var(--c-warn)', marginBottom: 4 }}>
                    {isVi ? 'Dự kiến hoàn thành' : 'Projected completion'}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.025em', color: isOnTrack ? 'var(--c-pos)' : 'var(--c-warn)', fontVariantNumeric: 'tabular-nums' }}>
                    {projectedDate.toLocaleDateString(isVi ? 'vi-VN' : 'en-GB', { month: 'long', year: 'numeric' })}
                  </div>
                  <div style={{ fontSize: 11, color: isOnTrack ? 'var(--c-pos)' : 'var(--c-warn)', marginTop: 4, opacity: 0.85 }}>
                    {isVi ? `Sau ${monthsToGoal} tháng` : `In ${monthsToGoal} ${monthsToGoal === 1 ? 'month' : 'months'}`}
                    {goal.targetDate && monthsToGoal != null && (isOnTrack
                      ? (isVi ? ` · ${monthsLeft - monthsToGoal} tháng sớm hơn` : ` · ${monthsLeft - monthsToGoal} ${monthsLeft - monthsToGoal === 1 ? 'month' : 'months'} early`)
                      : (isVi ? ` · ${monthsToGoal - monthsLeft} tháng trễ hạn` : ` · ${monthsToGoal - monthsLeft} ${monthsToGoal - monthsLeft === 1 ? 'month' : 'months'} late`)
                    )}
                  </div>
                </div>
              )}

              {calcInput > 0 && goal.targetAmount && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 1, background: 'var(--c-line)', borderRadius: 10, overflow: 'hidden' }}>
                  {[
                    { l: isVi ? 'Còn thiếu' : 'Still needed', v: fmtCompact(remaining), c: 'var(--c-ink)' },
                    { l: isVi ? 'Tháng còn lại' : 'Months left', v: String(monthsLeft), c: 'var(--c-ink)' },
                    { l: isVi ? 'Tối thiểu/tháng' : 'Min/month', v: neededPerMonth > 0 ? fmtCompact(neededPerMonth) : '—', c: 'var(--c-muted)' },
                    { l: isOnTrack ? (isVi ? 'Dư/tháng' : 'Surplus/mo') : (isVi ? 'Thiếu/tháng' : 'Gap/month'), v: fmtCompact(gap), c: isOnTrack ? 'var(--c-pos)' : 'var(--c-neg)' },
                  ].map((k, i) => (
                    <div key={i} style={{ background: 'var(--c-card)', padding: '9px 10px' }}>
                      <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{k.l}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: k.c, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
                    </div>
                  ))}
                </div>
              )}

              {calcInput > 0 && goal.targetAmount && creditedWithdrawn > 0 && remaining > 0 && (
                <ProgressGatherNote amount={creditedWithdrawn} isVi={isVi} />
              )}

              {calcInput <= 0 && (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-muted)' }}>
                  <Target size={28} color="var(--c-line-strong)" />
                  <p style={{ margin: '8px 0 0', fontSize: 12 }}>
                    {isVi ? 'Nhập số tiền để xem dự báo' : 'Enter an amount to see your projection'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* History tab */}
          {tab === 'history' && (
            <>
              {txLoading && <TxRowsSkeleton />}
              {!txLoading && txError && (
                <LoadError isVI={isVi} onRetry={() => setTxReload((n) => n + 1)} compact />
              )}
              {!txLoading && !txError && transactions.length === 0 && (
                <p style={{ color: 'var(--c-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                  {isVi ? 'Chưa có giao dịch nào' : 'No transactions yet'}
                </p>
              )}
              {!txLoading && transactions.map((tx, i) => {
                const isRenewed = !!tx.renewed_from_transaction_id
                // Held/merged settlements parked their cash — render neutral (like a
                // snapshot), never the red "−" of a real withdrawal.
                const kind = txKind(tx)
                const isWithdraw = kind === 'withdrawal'
                const neutral = isRenewed || kind === 'held' || kind === 'consumed'
                const ink = neutral ? 'var(--c-muted)' : isWithdraw ? 'var(--c-neg)' : 'var(--c-pos)'
                const fill = neutral ? 'var(--c-card-2)' : isWithdraw ? 'var(--c-neg-tint)' : 'var(--c-pos-tint)'
                const DirIcon = isRenewed ? RefreshCw : kind === 'held' ? PiggyBank : kind === 'consumed' ? GitMerge : isWithdraw ? ArrowDownRight : ArrowUpRight
                const sign = isWithdraw ? '-' : kind === 'investment' ? '+' : ''
                const name = tx.fund_name ?? tx.notes ?? (isVi ? 'Khoản đầu tư' : 'Investment')
                return (
                  <div key={tx.transaction_id} data-testid={isRenewed ? 'history-renewed-row' : undefined} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '11px 16px',
                    borderBottom: i < transactions.length - 1 ? '1px solid var(--c-line)' : 'none',
                    opacity: isRenewed ? 0.6 : 1,
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                      background: fill, color: ink,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <DirIcon size={13} strokeWidth={2.2} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                        {isRenewed && (
                          <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 600, padding: '1px 6px', borderRadius: 999, background: 'var(--c-card-2)', color: 'var(--c-muted)' }}>
                            {isVi ? 'Đã tái tục' : 'Renewed'}
                          </span>
                        )}
                        {(kind === 'held' || kind === 'consumed') && (
                          <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 600, padding: '1px 6px', borderRadius: 999, background: 'var(--c-card-2)', color: 'var(--c-muted)' }}>
                            {kind === 'held' ? (isVi ? 'Chờ gộp' : 'For merge') : (isVi ? 'Đã gộp' : 'Merged')}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 1 }}>
                        {fmtTxDate(tx.investment_date, locale)}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: ink, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {sign}{fmtCompact(tx.amount_vnd)}
                    </span>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>

      {/* Goal options modal */}
      {actionsOpen && (
        <GoalOptionsModal
          onClose={() => setActionsOpen(false)}
          onEdit={() => { setActionsOpen(false); setTimeout(() => setEditOpen(true), 80) }}
          onDelete={() => { setActionsOpen(false); setTimeout(() => setDeleteOpen(true), 80) }}
          isVi={isVi}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteOpen && (
        <DeleteGoalModal
          goalName={goal.goalName}
          isDeleting={isDeleting}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={handleDelete}
          isVi={isVi}
        />
      )}

      {/* Edit goal modal */}
      {editOpen && (
        <EditGoalModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          goal={goal}
          onSaved={onDataChanged}
          isVi={isVi}
        />
      )}

      {/* Investment options modal */}
      {showInvOptions && actionInv && (
        <InvOptionsModal
          inv={actionInv}
          isVi={isVi}
          renewalSummary={buildRenewalSummary(transactions as GoalDetailTx[], actionInv.id)}
          onClose={() => { setShowInvOptions(false) }}
          onHistory={() => { setShowInvOptions(false); setTab('history') }}
          onResolve={() => { setShowInvOptions(false); setTimeout(() => setShowResolve(true), 80) }}
          onSell={() => { setShowInvOptions(false); setTimeout(() => setShowSell(true), 80) }}
          onUnassign={() => { setShowInvOptions(false); setTimeout(() => setShowUnassignConfirm(true), 80) }}
          onChanged={onDataChanged}
        />
      )}

      {/* Maturity resolve modal */}
      {showResolve && actionInv && (
        <MaturityResolveModal
          inv={actionInv}
          goalId={goal.goalId}
          siblingDeposits={invRows}
          heldSiblings={(goal.heldForMerge ?? []).map((h) => ({ id: h.transactionId, name: h.name, amount: h.amount }))}
          isVi={isVi}
          onClose={() => setShowResolve(false)}
          onRenewed={() => { setShowResolve(false); (onRenewed ?? onDataChanged)() }}
          onWithdraw={() => { setShowResolve(false); setTimeout(() => setShowSell(true), 80) }}
        />
      )}

      {/* Unassign confirmation modal */}
      {showUnassignConfirm && actionInv && (
        <UnassignConfirmModal
          inv={actionInv}
          unassigning={unassigning}
          isVi={isVi}
          onCancel={() => setShowUnassignConfirm(false)}
          onConfirm={handleUnassign}
        />
      )}

      {/* Sell / Withdraw modal */}
      {showSell && actionInv && (
        <SellModal
          inv={actionInv}
          isVi={isVi}
          goalId={goal.goalId}
          goalCurrentValue={goal.currentValue}
          goalTargetAmount={goal.targetAmount}
          onClose={() => setShowSell(false)}
          onSuccess={() => {
            setShowSell(false)
            setUnassignedIds((prev) => [...prev, actionInv.id])
            onDataChanged()
          }}
        />
      )}
    </>
  )
}

// ─── Investment options modal ──────────────────────────────────────────────
function InvOptionsModal({ inv, isVi, renewalSummary, onClose, onHistory, onResolve, onSell, onUnassign, onChanged }: {
  inv: InvRow; isVi: boolean; renewalSummary: ReturnType<typeof buildRenewalSummary>
  onClose: () => void; onHistory: () => void; onResolve: () => void; onSell: () => void; onUnassign: () => void; onChanged: () => void
}) {
  const isBank = inv.type === 'bank'
  const typeColor = GD_COLORS[inv.type] ?? 'var(--c-muted)'
  // A matured term deposit renews; a matured accumulating book collapses — both
  // open the same "Handle maturity" sheet (it branches internally).
  const needsMaturity = needsMaturityAction(inv, isVi) || needsBookMaturityAction(inv)

  const actions = [
    ...(needsMaturity ? [{
      icon: <RefreshCw size={18} color="var(--c-warn,#b45309)" />,
      bg: 'var(--c-warn-tint,#fef3c7)',
      label: isVi ? 'Xử lý đáo hạn' : 'Handle maturity',
      sub: inv.depositGroupId
        ? (isVi ? 'Tất toán cả sổ & gửi lại' : 'Settle the book & re-deposit')
        : (isVi ? 'Tái tục hoặc chuyển sang chờ rút' : 'Renew or mark for withdrawal'),
      onClick: onResolve,
    }] : []),
    {
      icon: <CalendarDays size={18} color="var(--c-muted)" />,
      bg: 'var(--c-card-2)',
      label: isVi ? 'Lịch sử giao dịch' : 'Transaction history',
      sub: isVi ? 'Xem các lần mua / bán trước đây' : 'View past buys & sells',
      onClick: onHistory,
    },
    // A book withdraws as a FULL close (the sell sheet routes it through the book
    // endpoint); a single holding withdraws/sells normally.
    {
      icon: <ArrowDownRight size={18} color="var(--c-neg)" />,
      bg: 'var(--c-neg-tint)',
      label: isBank ? (isVi ? 'Rút tiền' : 'Withdraw') : (isVi ? 'Bán' : 'Sell'),
      sub: inv.depositGroupId
        ? (isVi ? 'Tất toán toàn bộ sổ' : 'Close the whole book')
        : isBank
          ? (isVi ? 'Rút tiền gửi khỏi mục tiêu' : 'Withdraw from goal')
          : (isVi ? 'Bán khoản đầu tư' : 'Liquidate investment'),
      onClick: onSell,
    },
    {
      icon: <UnlinkSvg size={18} color="var(--c-warn,#b45309)" />,
      bg: 'var(--c-warn-tint,#fef3c7)',
      label: isVi ? 'Bỏ gán mục tiêu' : 'Unassign from goal',
      sub: isVi ? 'Chuyển khoản đầu tư sang trạng thái chưa gán' : 'Move this investment to unassigned',
      onClick: onUnassign,
    },
  ]

  return (
    <DModal onClose={onClose} title={isVi ? 'Tùy chọn' : 'Options'} width={380}>
      <div style={{ display: 'grid', gap: 10 }}>
        {/* Item summary */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--c-card-2)', borderRadius: 12, marginBottom: 4 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--c-card)', color: typeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid var(--c-line)' }}>
            <TypeIcon type={inv.type} size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.name}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(inv.value)}</span>
              {inv.gainPct != null && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999,
                  background: inv.gainPct >= 0 ? 'var(--c-pos-tint)' : 'var(--c-neg-tint)',
                  color: inv.gainPct >= 0 ? 'var(--c-pos)' : 'var(--c-neg)',
                }}>
                  {fmtPct(inv.gainPct)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Bank info strip — interest rate + maturity + time left (issue #263);
            avg rate + top-up history for an accumulating book. */}
        <BankInfoStrip inv={inv} isVi={isVi} />

        {/* Top up — accumulating books only (renders nothing otherwise) */}
        <TopUpControl inv={inv} isVi={isVi} onDone={() => { onClose(); onChanged() }} />

        {/* Renewal history summary — only when this deposit has been renewed */}
        <RenewalSummaryLine summary={renewalSummary} isVi={isVi} />

        {actions.map((a, i) => (
          <button key={i} onClick={a.onClick} style={{
            width: '100%', textAlign: 'left', padding: '13px 16px',
            background: 'var(--c-card)', border: '1px solid var(--c-line)',
            borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 14, transition: 'background 120ms',
          }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-card-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--c-card)')}
          >
            <div style={{ width: 40, height: 40, borderRadius: 10, background: a.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {a.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{a.label}</div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2 }}>{a.sub}</div>
            </div>
            <ChevronRight size={14} color="var(--c-muted)" />
          </button>
        ))}
      </div>
    </DModal>
  )
}

// ─── Unassign confirm modal ────────────────────────────────────────────────
function UnassignConfirmModal({ inv, unassigning, isVi, onCancel, onConfirm }: {
  inv: InvRow; unassigning: boolean; isVi: boolean; onCancel: () => void; onConfirm: () => void
}) {
  return (
    <DModal onClose={onCancel} title={isVi ? 'Bỏ gán mục tiêu?' : 'Unassign from goal?'} width={380}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--c-card-2)', borderRadius: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--c-warn-tint,#fef3c7)', color: 'var(--c-warn,#b45309)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <TypeIcon type={inv.type} size={15} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.name}</div>
            <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(inv.value)}</div>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.55 }}>
          {isVi
            ? 'Khoản đầu tư này sẽ được chuyển sang "Chưa gán". Bạn có thể gán lại bất kỳ lúc nào từ trang Kế hoạch.'
            : 'This investment will be moved to "Unassigned". You can re-assign it any time from the Planning page.'}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} className="cn-btn ghost" style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }}>
            {isVi ? 'Hủy' : 'Cancel'}
          </button>
          <button onClick={onConfirm} disabled={unassigning} style={{
            flex: 2, padding: '10px 14px', background: 'var(--c-warn,#b45309)', color: '#fff',
            border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
            cursor: unassigning ? 'default' : 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: unassigning ? 0.6 : 1,
          }}>
            <UnlinkSvg size={14} />
            {unassigning ? (isVi ? 'Đang xử lý…' : 'Unassigning…') : (isVi ? 'Bỏ gán' : 'Unassign')}
          </button>
        </div>
      </div>
    </DModal>
  )
}

// ─── Desktop sell / withdraw modal ────────────────────────────────────────
function SellModal({ inv, isVi, goalId, goalCurrentValue, goalTargetAmount, onClose, onSuccess }: {
  inv: InvRow; isVi: boolean; goalId: string; goalCurrentValue: number; goalTargetAmount: number | null; onClose: () => void; onSuccess: () => void
}) {
  const isFund = inv.type === 'fund'
  const isGold = inv.type === 'gold'
  const isBank = inv.type === 'bank'
  // A book is a FULL close (all tranches via the book endpoint), not a partial
  // withdrawal — amount fixed at the balance, only the received cash editable.
  const isBook = isBank && !!inv.depositGroupId
  const navPerUnit = isFund
    ? (inv.fund?.currentNAV ?? null)
    : (inv.units && inv.units > 0 ? inv.value / inv.units : null)

  const [amount, setAmount] = useState('')
  const [units, setUnits] = useState('')
  const [received, setReceived] = useState('') // bank: cash actually received
  // Gold sale price per chỉ, prefilled with the current market price.
  const [salePrice, setSalePrice] = useState(() => (isGold && navPerUnit ? String(Math.round(navPerUnit)) : ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [soldAmount, setSoldAmount] = useState(0)
  const [affectsProgress, setAffectsProgress] = useState(true)

  const maxAmount = inv.value
  const numAmount = Number(amount) || 0

  // Gold: quantity (chỉ) × sale price → proceeds / cost / profit
  const numUnits = Number(units) || 0
  const numSalePrice = Number(salePrice) || 0
  const goldMaxUnits = inv.units ?? 0
  const goldBuyUnit = isGold && inv.units && inv.units > 0 && inv.principal != null
    ? Math.round(inv.principal / inv.units) : null
  const goldProceeds = isGold ? Math.round(numUnits * numSalePrice) : 0
  const goldCostSold = goldBuyUnit != null ? Math.round(goldBuyUnit * numUnits) : null
  const goldProfit = isGold && goldProceeds > 0 && goldCostSold != null ? goldProceeds - goldCostSold : null
  const goldRemUnits = isGold && inv.units != null ? inv.units - numUnits : null
  const isOverUnits = isGold && inv.units != null && numUnits > inv.units

  // Bank: cash received is editable; split principal out of the withdrawn amount
  // so the summary can show an accurate gain/loss.
  const numReceived = Number(received) || 0
  const bankPrincipal = inv.principal ?? maxAmount
  const bankFraction = maxAmount > 0 ? Math.min(1, numAmount / maxAmount) : 0
  const bankPrincipalPortion = Math.round(bankPrincipal * bankFraction)
  const bankGain = isBank && numReceived > 0 && numAmount > 0 ? numReceived - bankPrincipalPortion : null

  const isOverMax = isGold ? isOverUnits : (numAmount > maxAmount && maxAmount > 0)
  const isValid = isGold
    ? (numUnits > 0 && !isOverUnits && numSalePrice > 0 && !saving)
    : isBank
      ? (numAmount > 0 && !isOverMax && numReceived > 0 && !saving)
      : (numAmount > 0 && !isOverMax && !saving)

  const gainLoss = useMemo(() => {
    if (!numAmount || isBank || inv.gainPct == null) return null
    return numAmount * inv.gainPct / (100 + inv.gainPct)
  }, [numAmount, isBank, inv.gainPct])

  const taxAmount = useMemo(() => {
    if (!isFund || !numAmount) return null
    return Math.round(numAmount * 0.001)
  }, [isFund, numAmount])

  function handleAmountChange(val: string) {
    const raw = val.replace(/[^0-9]/g, '')
    setAmount(raw)
    if (isBank) setReceived(raw)  // received tracks the amount until edited down
    if (navPerUnit && raw) setUnits((Number(raw) / navPerUnit).toFixed(2))
    else setUnits('')
  }

  function handleUnitsChange(val: string) {
    setUnits(val)
    if (navPerUnit && val) setAmount(Math.round(Number(val) * navPerUnit).toString())
    else setAmount('')
  }

  function handleSetAll() {
    if (isGold && inv.units != null) { setUnits(String(inv.units)); return }
    setAmount(String(maxAmount))
    if (isBank) setReceived(String(Math.round(maxAmount)))
    if (navPerUnit && inv.units != null) setUnits(inv.units.toFixed(2))
  }

  async function handleConfirm() {
    if (!isValid) return
    setSaving(true); setError('')
    try {
      const today = todayIso()
      if (isBook) {
        // Book withdrawal: spread the principal across tranches (partial or full).
        const res = await fetch(`/api/v1/investment-transactions/${inv.id}/withdraw-book`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ withdraw_principal: bankPrincipalPortion, total_received: Math.round(numReceived), investment_date: today, affects_progress: affectsProgress }),
        })
        if (!res.ok) { const { error: e } = await res.json().catch(() => ({})); setError(e ?? (isVi ? 'Không thể xử lý' : 'Could not process')); setSaving(false); return }
      } else if (isFund && inv.fund) {
        const unitsWithdrawn = navPerUnit ? numAmount / navPerUnit : (inv.units ?? 0)
        const principalWithdrawn = inv.fund.purchasePrice
          ? Math.round((numAmount / inv.value) * (inv.fund.purchasePrice * (inv.units ?? 0)))
          : Math.round(numAmount)
        const res = await fetch('/api/v1/investment-transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction_type: 'withdrawal', asset_type: 'fund',
            fund_id: inv.fund.fundId, investment_date: today,
            amount_vnd: Math.round(numAmount),
            units_withdrawn: parseFloat(unitsWithdrawn.toFixed(4)),
            principal_withdrawn: principalWithdrawn, goal_id: goalId,
            affects_progress: affectsProgress,
          }),
        })
        if (!res.ok) { const { error: e } = await res.json(); setError(e ?? (isVi ? 'Không thể xử lý' : 'Could not process')); setSaving(false); return }
      } else {
        const body: Record<string, unknown> = {
          transaction_type: 'withdrawal', asset_type: inv.type,
          parent_transaction_id: inv.id, investment_date: today,
          // Gold: amount = proceeds (qty × sale price), principal = cost basis.
          // Bank: amount = cash received, principal = principal portion.
          amount_vnd: isGold ? goldProceeds : isBank ? Math.round(numReceived) : Math.round(numAmount),
          principal_withdrawn: isGold ? (goldCostSold ?? goldProceeds) : isBank ? bankPrincipalPortion : Math.round(numAmount),
          goal_id: goalId,
          affects_progress: affectsProgress,
        }
        if (isGold) body.units_withdrawn = parseFloat(numUnits.toFixed(4))
        const res = await fetch('/api/v1/investment-transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) { const { error: e } = await res.json(); setError(e ?? (isVi ? 'Không thể xử lý' : 'Could not process')); setSaving(false); return }
      }
      setSoldAmount(isGold ? goldProceeds : isBank ? numReceived : numAmount); setConfirmed(true)
      setTimeout(() => { setConfirmed(false); onSuccess(); onClose() }, 2000)
    } catch { setError(isVi ? 'Lỗi kết nối' : 'Connection error') }
    setSaving(false)
  }

  const title = isBank ? (isVi ? 'Rút tiền' : 'Withdraw') : (isVi ? 'Bán' : 'Sell')
  const typeColor = GD_COLORS[inv.type] ?? '#94a3b8'

  return (
    <DModal onClose={onClose} title={title} width={480}>
      {confirmed ? (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 32, background: 'var(--c-pos-tint)', color: 'var(--c-pos)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Check size={30} strokeWidth={2.5} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{isBank ? (isVi ? 'Đã rút thành công' : 'Withdrawal successful') : (isVi ? 'Đã bán thành công' : 'Sale successful')}</div>
          <div style={{ fontSize: 13, color: 'var(--c-muted)', marginTop: 4 }}>{inv.name}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--c-pos)', marginTop: 12, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(soldAmount)}</div>
          <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 8, lineHeight: 1.5 }}>
            {isFund ? (isVi ? 'Tiền về tài khoản sau T+3 ngày làm việc' : 'Proceeds arrive in T+3 business days') : (isVi ? 'Tiền về tài khoản trong 1 ngày làm việc' : 'Proceeds arrive within 1 business day')}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {/* Item summary */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--c-card-2)', borderRadius: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--c-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: typeColor, border: '1px solid var(--c-line)', flexShrink: 0 }}>
              <TypeIcon type={inv.type} size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.name}</div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span>{isVi ? 'Khả dụng' : 'Available'}: <span style={{ fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(maxAmount)}</span></span>
                {inv.units != null && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{inv.units.toLocaleString('vi-VN')} {isVi ? 'phần' : inv.units === 1 ? 'unit' : 'units'}</span>}
                {isBank && inv.interestRate && <span>{inv.interestRate}%/yr</span>}
              </div>
            </div>
          </div>

          {!isGold ? (
          <>
          {/* Amount input (a book is editable too — partial up to the balance) */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              {isBank ? (isVi ? 'Số tiền muốn rút' : 'Amount to withdraw') : (isVi ? 'Số tiền muốn bán' : 'Amount to sell')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: `1.5px solid ${isOverMax ? 'var(--c-neg)' : 'var(--c-navy)'}`, borderRadius: 10 }}>
                <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                <input
                  data-testid="sell-amount-input"
                  autoFocus
                  type="text" inputMode="numeric"
                  value={amount ? Number(amount).toLocaleString('vi-VN') : ''}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  placeholder="0"
                  style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: isOverMax ? 'var(--c-neg)' : 'var(--c-ink)' }}
                />
              </div>
              <button data-testid="sell-all-btn" onClick={handleSetAll} style={{ padding: '8px 14px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                {isVi ? 'Tất cả' : 'All'}
              </button>
            </div>
            {isOverMax && (
              <div style={{ fontSize: 11, color: 'var(--c-neg)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                <X size={12} strokeWidth={2.5} />
                {isVi ? 'Vượt quá số dư khả dụng' : 'Exceeds available balance'} · {isVi ? 'Tối đa' : 'Max'} {fmtCompact(maxAmount)}
              </div>
            )}
          </div>

          {/* Bank: editable cash received (early withdrawal can cut interest) */}
          {isBank && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{isVi ? 'Số tiền thực nhận' : "Amount you'll receive"}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1.5px solid var(--c-navy)', borderRadius: 10 }}>
                <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                <input
                  type="text" inputMode="numeric"
                  value={received ? Number(received).toLocaleString('vi-VN') : ''}
                  onChange={(e) => { setReceived(e.target.value.replace(/[^0-9]/g, '')); setError('') }}
                  placeholder="0"
                  style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: 'var(--c-ink)' }}
                />
              </div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{isVi ? 'Tạm tính theo giá trị hiện tại — sửa nếu rút sớm bị trừ lãi' : 'Pre-filled at current value — edit down if early withdrawal cuts interest'}</div>
            </div>
          )}

          {/* Units input — fund & gold only */}
          {(isFund || isGold) && inv.units != null && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{isVi ? 'Số phần' : 'Units'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10 }}>
                <input type="number" value={units} onChange={(e) => handleUnitsChange(e.target.value)} placeholder="0.00"
                  style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: 'var(--c-ink)' }} />
                <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVi ? 'phần' : 'units'}</span>
              </div>
              {navPerUnit && (
                <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>
                  NAV: <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(navPerUnit)}</span> / {isVi ? 'phần' : 'unit'} · {isVi ? 'Hai trường tự động liên kết' : 'Fields auto-linked'}
                </div>
              )}
            </div>
          )}

          {/* Fund summary: remaining / gain-loss / tax */}
          {!isBank && numAmount > 0 && !isOverMax && (() => {
            const rows = [
              { show: true, label: isVi ? 'Còn lại sau giao dịch' : 'Remaining after transaction', value: fmtCompact(Math.max(0, maxAmount - numAmount)), color: 'var(--c-ink)' },
              { show: gainLoss != null, label: isVi ? 'Lãi/Lỗ ước tính' : 'Est. gain / loss', value: `${gainLoss! >= 0 ? '+' : ''}${fmtCompact(gainLoss!)}`, color: gainLoss! >= 0 ? 'var(--c-pos)' : 'var(--c-neg)' },
              { show: taxAmount != null, label: isVi ? 'Thuế TNCN (0.1%)' : 'Personal income tax (0.1%)', value: `−${fmtCompact(taxAmount!)}`, color: 'var(--c-muted)' },
            ].filter((r) => r.show)
            return (
              <div style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
                {rows.map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: i < rows.length - 1 ? '1px solid var(--c-line)' : 'none' }}>
                    <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{r.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: r.color, fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Bank summary: principal portion / received / gain-loss / remaining */}
          {isBank && numAmount > 0 && !isOverMax && numReceived > 0 && (
            <div style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVi ? 'Tiền gốc' : 'Principal'}{bankFraction < 0.999 && <span style={{ opacity: 0.7 }}> · {Math.round(bankFraction * 100)}%</span>}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(bankPrincipalPortion)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVi ? 'Số tiền thực nhận' : "Amount you'll receive"}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(numReceived)}</span>
              </div>
              {bankGain != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--c-line)' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{isVi ? 'Lãi/Lỗ' : 'Gain / Loss'}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: bankGain >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', fontVariantNumeric: 'tabular-nums' }}>{bankGain >= 0 ? '+' : '−'}{fmtCompact(Math.abs(bankGain))}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVi ? 'Còn lại sau giao dịch' : 'Remaining after transaction'}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(Math.max(0, maxAmount - numAmount))}</span>
              </div>
            </div>
          )}
          </>
          ) : (
          <>
          {/* Gold: quantity (chỉ) to sell */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{isVi ? 'Số lượng bán' : 'Quantity to sell'}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: `1.5px solid ${isOverUnits ? 'var(--c-neg)' : 'var(--c-navy)'}`, borderRadius: 10 }}>
                <input autoFocus type="number" step="0.1" value={units} onChange={(e) => { setUnits(e.target.value); setError('') }} placeholder="0.00"
                  style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: isOverUnits ? 'var(--c-neg)' : 'var(--c-ink)' }} />
                <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>chỉ</span>
              </div>
              <button onClick={handleSetAll} style={{ padding: '8px 14px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{isVi ? 'Tất cả' : 'All'}</button>
            </div>
            {isOverUnits && (
              <div style={{ fontSize: 11, color: 'var(--c-neg)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                <X size={12} strokeWidth={2.5} /> {isVi ? 'Vượt quá số lượng đang giữ' : 'Exceeds quantity held'} · {isVi ? 'Tối đa' : 'Max'} {goldMaxUnits} chỉ
              </div>
            )}
          </div>

          {/* Gold: sale price per chỉ */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{isVi ? 'Giá bán mỗi chỉ' : 'Sale price per chỉ'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10 }}>
              <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
              <input data-testid="sell-gold-price-input" type="number" value={salePrice} onChange={(e) => { setSalePrice(e.target.value); setError('') }} placeholder="0"
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: 'var(--c-ink)' }} />
              <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>/chỉ</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{isVi ? 'Tạm tính theo giá hiện tại — sửa theo giá bạn bán được' : 'Pre-filled at current price — edit to what you can sell for'}</div>
          </div>

          {/* Gold summary */}
          {numUnits > 0 && !isOverUnits && numSalePrice > 0 && (
            <div style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVi ? 'Tổng tiền nhận được' : 'Total received'}<span style={{ opacity: 0.7 }}> · {numUnits.toLocaleString('vi-VN')} chỉ × {fmtCompact(numSalePrice)}</span></span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(goldProceeds)}</span>
              </div>
              {goldCostSold != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                  <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVi ? 'Giá vốn' : 'Your cost'}{goldBuyUnit != null && <span style={{ opacity: 0.7 }}> · {numUnits.toLocaleString('vi-VN')} chỉ × {fmtCompact(goldBuyUnit)}</span>}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(goldCostSold)}</span>
                </div>
              )}
              {goldProfit != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--c-line)' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{isVi ? 'Lãi/Lỗ' : 'Profit / Loss'}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: goldProfit >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', fontVariantNumeric: 'tabular-nums' }}>{goldProfit >= 0 ? '+' : '−'}{fmtCompact(Math.abs(goldProfit))}</span>
                </div>
              )}
              {goldRemUnits != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                  <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVi ? 'Còn lại sau giao dịch' : 'Remaining after transaction'}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{Math.max(0, goldRemUnits).toLocaleString('vi-VN')} chỉ</span>
                </div>
              )}
            </div>
          )}
          </>
          )}

          {/* Count toward goal progress — SellModal is always goal-scoped */}
          <AffectsProgressControl
            checked={affectsProgress}
            onChange={setAffectsProgress}
            isVi={isVi}
            currentValue={goalCurrentValue}
            targetAmount={goalTargetAmount}
            withdrawnValue={isGold ? goldProceeds : numAmount}
          />

          {/* Bank early withdrawal warning */}
          {isBank && (
            <div style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--c-warn-tint,#fffbeb)', borderRadius: 10, border: '1px solid rgba(180,83,9,0.15)' }}>
              <Shield size={15} color="var(--c-warn)" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ margin: 0, fontSize: 12, color: 'var(--c-warn)', lineHeight: 1.5 }}>
                {isVi ? 'Rút sớm có thể mất lãi.' : 'Early withdrawal may forfeit accrued interest.'}
              </p>
            </div>
          )}

          {/* Where money goes + settlement */}
          <div style={{ display: 'grid', gap: 6 }}>
            {[
              { icon: <Wallet size={14} color="var(--c-muted)" />, text: isVi ? 'Tiền sẽ chuyển về mục "Chưa phân bổ"' : 'Proceeds move to Unallocated' },
              { icon: <ArrowDownToLine size={14} color="var(--c-muted)" />, text: isFund ? (isVi ? 'Tiền về tài khoản sau T+3 ngày làm việc' : 'Proceeds arrive in T+3 business days') : (isVi ? 'Tiền về tài khoản trong 1 ngày làm việc' : 'Proceeds arrive within 1 business day') },
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', background: 'var(--c-card-2)', borderRadius: 8 }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}>{r.icon}</span>
                <span style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.5 }}>{r.text}</span>
              </div>
            ))}
          </div>

          {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--c-neg)', textAlign: 'center' }}>{error}</p>}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <button onClick={onClose} className="cn-btn ghost" style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }}>
              {isVi ? 'Hủy' : 'Cancel'}
            </button>
            <button data-testid="sell-confirm-btn" onClick={isValid ? handleConfirm : undefined} disabled={!isValid} style={{
              flex: 2, padding: '11px 14px',
              background: isValid ? 'var(--c-neg)' : isOverMax ? 'var(--c-neg-tint)' : 'var(--c-line)',
              color: isValid ? '#fff' : isOverMax ? 'var(--c-neg)' : 'var(--c-muted)',
              border: isOverMax ? '1px solid var(--c-neg)' : 'none',
              borderRadius: 10, fontSize: 13, fontWeight: 600,
              cursor: isValid ? 'pointer' : 'default',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'background 120ms, color 120ms',
            }}>
              {isBank ? <ArrowDownToLine size={15} strokeWidth={2.2} /> : <ArrowDownRight size={15} strokeWidth={2.2} />}
              {(isGold ? numUnits <= 0 : numAmount <= 0)
                ? (isVi ? (isBank ? 'Nhập số tiền rút' : isGold ? 'Nhập số lượng bán' : 'Nhập số tiền bán') : (isBank ? 'Enter withdrawal amount' : isGold ? 'Enter quantity to sell' : 'Enter sale amount'))
                : (isGold && numSalePrice <= 0) ? (isVi ? 'Nhập giá bán' : 'Enter sale price')
                : isOverMax ? (isVi ? (isGold ? 'Vượt quá số lượng' : 'Vượt quá số dư') : (isGold ? 'Exceeds quantity' : 'Exceeds balance'))
                : (isBank && numReceived <= 0) ? (isVi ? 'Nhập số tiền thực nhận' : 'Enter amount received')
                : saving ? (isVi ? 'Đang xử lý…' : 'Processing…')
                : isBank ? (isVi ? 'Xác nhận rút' : 'Confirm withdrawal') : (isVi ? 'Xác nhận bán' : 'Confirm sale')}
            </button>
          </div>
        </div>
      )}
    </DModal>
  )
}

// ─── Shared DModal ─────────────────────────────────────────────────────────
function DModal({ onClose, title, width = 380, children }: {
  onClose: () => void; title: string; width?: number; children: React.ReactNode
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        animation: 'fade-in 150ms ease', backdropFilter: 'blur(2px)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: width, maxHeight: 'calc(100vh - 48px)',
          background: 'var(--c-card)', borderRadius: 16,
          boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)',
          display: 'flex', flexDirection: 'column',
          animation: 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid var(--c-line)', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</h3>
          <button onClick={onClose} className="cn-btn ghost" style={{ padding: 6 }} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  )
}

function GoalOptionsModal({ onClose, onEdit, onDelete, isVi }: {
  onClose: () => void; onEdit: () => void; onDelete: () => void; isVi: boolean
}) {
  const actions = [
    { icon: <Edit2 size={18} color="var(--c-navy)" />, bg: 'var(--c-navy-tint)', label: isVi ? 'Chỉnh sửa mục tiêu' : 'Edit goal', sub: isVi ? 'Thay đổi tên, số tiền hoặc ngày' : 'Change name, target or date', labelColor: 'var(--c-ink)', onClick: onEdit },
    { icon: <Trash2 size={18} color="var(--c-neg)" />, bg: 'var(--c-neg-tint)', label: isVi ? 'Xoá mục tiêu' : 'Delete goal', sub: isVi ? 'Xoá và huỷ liên kết tất cả khoản' : 'Remove and unlink all investments', labelColor: 'var(--c-neg)', onClick: onDelete },
  ]
  return (
    <DModal onClose={onClose} title={isVi ? 'Tùy chọn mục tiêu' : 'Goal options'}>
      <div style={{ display: 'grid', gap: 10 }}>
        {actions.map((a, i) => (
          <button key={i} onClick={a.onClick} style={{ width: '100%', textAlign: 'left', padding: '13px 16px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 14, transition: 'background 120ms' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-card-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--c-card)')}
          >
            <div style={{ width: 40, height: 40, borderRadius: 10, background: a.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{a.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: a.labelColor }}>{a.label}</div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2 }}>{a.sub}</div>
            </div>
            <ChevronRight size={14} color="var(--c-muted)" />
          </button>
        ))}
      </div>
    </DModal>
  )
}

function DeleteGoalModal({ goalName, isDeleting, onCancel, onConfirm, isVi }: {
  goalName: string; isDeleting: boolean; onCancel: () => void; onConfirm: () => void; isVi: boolean
}) {
  return (
    <DModal onClose={onCancel} title={isVi ? 'Xoá mục tiêu?' : 'Delete goal?'}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: 'var(--c-neg-tint)', borderRadius: 10 }}>
          <Trash2 size={15} color="var(--c-neg)" strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg)', lineHeight: 1.5 }}>
            {isVi
              ? `Mục tiêu "${goalName}" và tất cả liên kết đầu tư sẽ bị xoá vĩnh viễn.`
              : `"${goalName}" and all linked investments will be permanently deleted.`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} className="cn-btn ghost" style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }}>{isVi ? 'Hủy' : 'Cancel'}</button>
          <button onClick={onConfirm} disabled={isDeleting} style={{ flex: 2, padding: '10px 14px', background: 'var(--c-neg)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: isDeleting ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: isDeleting ? 0.6 : 1 }}>
            <Trash2 size={14} />
            {isDeleting ? (isVi ? 'Đang xoá…' : 'Deleting…') : (isVi ? 'Xoá mục tiêu' : 'Delete goal')}
          </button>
        </div>
      </div>
    </DModal>
  )
}

function EditGoalModal({ open, onClose, goal, onSaved, isVi }: {
  open: boolean; onClose: () => void; goal: GoalData; onSaved: () => void; isVi: boolean
}) {
  const [name, setName] = useState(goal.goalName)
  const [target, setTarget] = useState(goal.targetAmount ? String(goal.targetAmount) : '')
  const [date, setDate] = useState(goal.targetDate ? goal.targetDate.slice(0, 7) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setName(goal.goalName)
      setTarget(goal.targetAmount ? String(goal.targetAmount) : '')
      setDate(goal.targetDate ? goal.targetDate.slice(0, 7) : '')
      setError('')
    }
  }, [open, goal])

  const monthsTo = (() => {
    if (!date) return 1
    const [y, m] = date.split('-').map(Number)
    const now = new Date()
    return Math.max(1, (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()))
  })()
  const perMonth = target ? Number(target) / monthsTo : 0

  async function handleSave() {
    if (!name.trim()) { setError(isVi ? 'Tên mục tiêu là bắt buộc' : 'Goal name is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/v1/savings-goals/${goal.goalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal_name: name.trim(),
          target_amount: target ? Number(target) : null,
          target_date: date ? `${date}-01` : null,
        }),
      })
      if (!res.ok) {
        const { error: e } = await res.json()
        setError(e ?? (isVi ? 'Không thể lưu' : 'Could not save'))
      } else { onSaved(); onClose() }
    } catch { setError(isVi ? 'Lỗi kết nối' : 'Connection error') }
    setSaving(false)
  }

  if (!open) return null
  return (
    <DModal onClose={onClose} title={isVi ? 'Chỉnh sửa mục tiêu' : 'Edit goal'} width={460}>
      <div style={{ display: 'grid', gap: 16 }}>
        {error && <p style={{ margin: 0, color: 'var(--c-neg)', fontSize: 13 }}>{error}</p>}
        <div>
          <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 6 }}>{isVi ? 'Tên mục tiêu' : 'Goal name'}</label>
          <input autoFocus type="text" value={name} onChange={(e) => setName(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: '1.5px solid var(--c-navy)', borderRadius: 10, background: 'var(--c-card)', color: 'var(--c-ink)', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }} />
        </div>
        <div>
          <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 6 }}>{isVi ? 'Số tiền mục tiêu (₫)' : 'Target amount (₫)'}</label>
          <input
            type="text"
            inputMode="numeric"
            value={target ? Number(target).toLocaleString('en-US') : ''}
            onChange={(e) => setTarget(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))}
            style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid var(--c-line)', borderRadius: 10, background: 'var(--c-card-2)', color: 'var(--c-ink)', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
        </div>
        <div>
          <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 6 }}>{isVi ? 'Hạn hoàn thành' : 'Target date'}</label>
          <input type="month" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid var(--c-line)', borderRadius: 10, background: 'var(--c-card-2)', color: 'var(--c-ink)', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }} />
        </div>
        {perMonth > 0 && (
          <div style={{ background: 'var(--c-navy-tint)', border: '1px solid var(--c-navy-tint)', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-navy)', marginBottom: 4 }}>
                {isVi ? 'Cần tiết kiệm' : 'Save per month'}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-navy)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                {new Intl.NumberFormat(isVi ? 'vi-VN' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(perMonth)} / {isVi ? 'tháng' : 'month'}
              </div>
            </div>
            <span style={{ background: 'var(--c-card)', color: 'var(--c-navy)', fontWeight: 600, fontSize: 12, padding: '4px 10px', borderRadius: 999, border: '1px solid var(--c-line)' }}>
              {monthsTo} {isVi ? 'tháng' : monthsTo === 1 ? 'month' : 'months'}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onClose} className="cn-btn ghost" style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }}>{isVi ? 'Huỷ' : 'Cancel'}</button>
          <button onClick={handleSave} disabled={saving} className="cn-btn primary" style={{ flex: 2, justifyContent: 'center', opacity: saving ? 0.7 : 1 }}>
            {saving ? (isVi ? 'Đang lưu…' : 'Saving…') : (isVi ? 'Lưu thay đổi' : 'Save changes')}
          </button>
        </div>
      </div>
    </DModal>
  )
}
