'use client'

import { useState } from 'react'
import { ChevronLeft, X, MoreHorizontal, Edit2, Trash2, ChevronRight, ArrowDownRight, Target, CalendarDays, RefreshCw, PiggyBank, Plus } from 'lucide-react'
import { iconHit } from './iconHit'
import { toast } from 'sonner'
import { fmt, fmtCompact, fmtPct } from '@/lib/formatters'
import { formatIntVN, parseIntVN } from '@/lib/numberFormat'
import type { GoalData } from '@/features/dashboard/contracts'
import { GD_COLORS, TypeIcon, UnlinkSvg, BankInfoStrip, TopUpControl, RenewalSummaryLine, ProgressCreditNote, ProgressGatherNote, progressCredit, type InvRow, type GoalDetailTx } from './goalDetailShared'
import { buildCompositionSegments, buildInvRows, buildRenewalSummary } from './goalDetailRows'
import { needsMaturityAction, needsBookMaturityAction } from './goalDetailMaturity'
import { computeGoalCalculator, describeHistoryRow } from './goalDetailModel'
import { MaturityResolveModal } from './MaturityResolveSheet'
import { fmtTxDate } from './transactionUtils'
import { TxRowsSkeleton } from './Skeletons'
import LoadError from './LoadError'
import { useGoalDetailData } from './useGoalDetailData'
import { deleteGoal, unholdTransaction, unassignInvestment, updateGoal } from './goalActions'
import { SellWithdrawSheet } from './SellWithdrawSheet'
import { invToSellItem } from './invToSellItem'
import { useTranslations } from 'next-intl'
import { useResetOnOpen, useResetOnChange } from '@/components/ui/useDialogMount'
import { monthsUntilYm } from '@/lib/dates'

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
  const td = useTranslations('deleteTransaction')
  const [tab, setTab] = useState<'investments' | 'calculator' | 'history'>('investments')
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

  // Transactions + gold price load (shared with GoalDetailSheet, #467). The
  // panel is always mounted, so it always loads; each load clears the optimistic
  // unassign filter.
  const { transactions, bookNames, txLoading, txError, goldPricePerChi } = useGoalDetailData({
    goalId: goal.goalId,
    enabled: true,
    refreshKey,
    txReload,
    onLoadStart: () => setUnassignedIds([]),
  })

  // Reset the tab when the selected goal changes. During render, so switching
  // goals never paints the previous goal's tab for a frame.
  useResetOnChange(goal.goalId, () => setTab('investments'))

  async function handleDelete() {
    setIsDeleting(true)
    const ok = await deleteGoal(goal.goalId)
    setIsDeleting(false)
    if (!ok) {
      // Keep the confirm modal open so the user can retry; don't claim success.
      toast.error(isVi ? 'Không thể xoá mục tiêu' : "Couldn't delete goal")
      return
    }
    setDeleteOpen(false)
    onDataChanged()
  }

  async function handleUnassign() {
    if (!actionInv) return
    setUnassigning(true)
    const ok = await unassignInvestment(actionInv, goal.goalId)
    setUnassigning(false)
    if (!ok) { toast.error(isVi ? 'Không thể huỷ liên kết' : "Couldn't unassign"); return }
    setUnassignedIds((prev) => [...prev, actionInv.id])
    setShowUnassignConfirm(false)
    setActionInv(null)
    onDataChanged()
  }

  const isPos = goal.profitLoss >= 0
  const isComplete = (goal.progressPercentage ?? 0) >= 100
  const progress = Math.min(goal.progressPercentage ?? 0, 100)
  // Bar (progress) vs the big value (net worth) diverge by any affects_progress=false
  // withdrawal added back to progress — surfaced as a reconciling caption.
  const creditedWithdrawn = progressCredit(goal.currentValue, goal.progressValue)

  // Build investment rows (shared with the mobile sheet's valuation logic).
  const invRows: InvRow[] = buildInvRows(transactions, goal.funds, goldPricePerChi, isVi, bookNames)

  // Composition segments — held-for-merge cash is folded back in (see helper) so the
  // bar reconciles with the headline instead of summing short.
  const heldCompValue = (goal.heldForMerge ?? []).reduce((a, h) => a + h.amount, 0)
  const segs = buildCompositionSegments(invRows, heldCompValue, isVi)
  const segsTotal = segs.reduce((a, x) => a + x.value, 0)

  // Calculator (shared projection math — #467). `calcInput` is parsed here (plain
  // number on this surface) and drives the shared derivation.
  const calcInput = Math.max(0, Number(calcAmount) || 0)
  const { remaining, monthsLeft, neededPerMonth, monthsToGoal, projectedDate, isOnTrack, gap } = computeGoalCalculator(goal, calcInput)

  const visibleInvRows = invRows.filter((inv) => !unassignedIds.includes(inv.id))

  // "Bỏ chờ gộp" — delete the held settlement row, restoring the original deposit;
  // onDataChanged re-fetches so the chip drops and the deposit reappears.
  const [unholdingId, setUnholdingId] = useState<string | null>(null)
  async function handleUnhold(heldTxId: string) {
    setUnholdingId(heldTxId)
    const result = await unholdTransaction(heldTxId)
    setUnholdingId(null)
    // Each refusal reads differently — a completed merge can't be undone, while a
    // pending settlement can be cancelled — so one generic message isn't enough
    // (#550). not_found is the exception: the row really is gone, so refresh
    // rather than leave it on screen for another doomed attempt.
    if (!result.ok) {
      toast.error(td(result.code))
      if (result.code === 'not_found') onDataChanged()
      return
    }
    onDataChanged()
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
                style={{ ...iconHit }}
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
                    <div style={{ fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, color: 'var(--c-ink)' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.name}</span>
                      {inv.isRecurring && (
                        <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 999, background: 'var(--c-card-2)', color: 'var(--c-muted)', flexShrink: 0 }}>
                          {isVi ? 'Định kỳ' : 'Recurring'}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {inv.units != null
                        ? `${inv.units.toLocaleString('vi-VN')} ${isVi ? 'phần' : inv.units === 1 ? 'unit' : 'units'}`
                        : inv.isRecurring
                          ? (isVi ? 'Góp theo kế hoạch — sửa ở mục Kế hoạch' : 'Plan-driven — manage it in Planning')
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
                  {/* A recurring saving has no transaction behind it: every action
                      in this menu would post an id the API rejects (#640). */}
                  {!inv.isRecurring && (
                    <button
                      onClick={() => { setActionInv(inv); setShowInvOptions(true) }}
                      className="cn-btn ghost"
                      style={{ ...iconHit, flexShrink: 0 }}
                      aria-label="Options"
                    >
                      <MoreHorizontal size={14} color="var(--c-muted)" />
                    </button>
                  )}
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
                      value={formatIntVN(calcAmount)}
                      onChange={(e) => setCalcAmount(parseIntVN(e.target.value))}
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
                const { kind, ink, fill, Icon, sign, name } = describeHistoryRow(tx, isRenewed, isVi)
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
                      <Icon size={13} strokeWidth={2.2} />
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
          siblingDeposits={invRows.filter((r) => !r.isRecurring)}
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
        <SellWithdrawSheet
          desktop
          open
          item={invToSellItem(actionInv)}
          context="goal"
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
          <button onClick={onClose} className="cn-btn ghost" style={{ ...iconHit }} aria-label="Close"><X size={18} /></button>
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

  useResetOnOpen(open, () => {
    setName(goal.goalName)
    setTarget(goal.targetAmount ? String(goal.targetAmount) : '')
    setDate(goal.targetDate ? goal.targetDate.slice(0, 7) : '')
    setError('')
  }, goal)

  const monthsTo = date ? monthsUntilYm(date) : 1
  const perMonth = target ? Number(target) / monthsTo : 0

  async function handleSave() {
    if (!name.trim()) { setError(isVi ? 'Tên mục tiêu là bắt buộc' : 'Goal name is required'); return }
    setSaving(true); setError('')
    const r = await updateGoal(goal.goalId, {
      name: name.trim(),
      target: target ? Number(target) : null,
      date: date ? `${date}-01` : null,
    })
    if (!r.ok) setError(r.networkError ? (isVi ? 'Lỗi kết nối' : 'Connection error') : (r.error ?? (isVi ? 'Không thể lưu' : 'Could not save')))
    else { onSaved(); onClose() }
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
            value={formatIntVN(target)}
            onChange={(e) => setTarget(parseIntVN(e.target.value))}
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
