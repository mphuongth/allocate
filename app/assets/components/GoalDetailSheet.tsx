'use client'

import { useState, useEffect } from 'react'
import {
  ChevronLeft, ChevronRight, MoreHorizontal,
  Edit2, Trash2, Calendar, Download, ArrowDownRight, ArrowUpRight, Target, RefreshCw, PiggyBank, GitMerge, Plus,
} from 'lucide-react'
import { iconHit } from './iconHit'
import { useLocale } from 'next-intl'
import { toast } from 'sonner'
import { fmt, fmtCompact, fmtPct } from '@/lib/formatters'
import { formatIntVN, parseIntVN } from '@/lib/numberFormat'
import type { GoalData, FundBreakdownItem } from '../DashboardClient'
import TransactionHistorySheet, { type PurchaseHistoryRow } from './TransactionHistorySheet'
import { SellWithdrawSheet } from './SellWithdrawSheet'
import { MaturityResolveSheet } from './MaturityResolveSheet'
import { GD_COLORS, buildCompositionSegments, computeGoalCalculator, TypeIcon, UnlinkSvg, buildInvRows, buildRenewalSummary, BankInfoStrip, TopUpControl, RenewalSummaryLine, needsMaturityAction, needsBookMaturityAction, ProgressCreditNote, ProgressGatherNote, progressCredit, type InvRow, type GoalDetailTx } from './goalDetailShared'
import { fmtTxDate, txKind } from './transactionUtils'
import { TxRowsSkeleton } from './Skeletons'
import LoadError from './LoadError'
import { useGoalDetailData } from './useGoalDetailData'
import { deleteGoal, unholdTransaction, unassignInvestment, updateGoal } from './goalActions'
import { invToSellItem } from './invToSellItem'

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

function GoalActionsSheet({
  open,
  onClose,
  onEdit,
  onDelete,
  isDeleting,
}: {
  open: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const isVI = useLocale() === 'vi'
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (open) setMounted(true)
    else { const t = setTimeout(() => setMounted(false), 220); return () => clearTimeout(t) }
  }, [open])
  if (!mounted) return null

  const t = isVI ? {
    title: 'Tùy chọn mục tiêu',
    edit: 'Chỉnh sửa mục tiêu',
    editSub: 'Thay đổi tên, số tiền hoặc ngày mục tiêu',
    delete: 'Xoá mục tiêu',
    deleteSub: 'Xoá mục tiêu và huỷ liên kết tất cả khoản đầu tư',
    cancel: 'Hủy',
  } : {
    title: 'Goal options',
    edit: 'Edit goal',
    editSub: 'Change name, target amount or date',
    delete: 'Delete goal',
    deleteSub: 'Remove goal and unlink all investments',
    cancel: 'Cancel',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.2)',
        zIndex: 150, pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--c-card)', borderRadius: '16px 16px 0 0',
          padding: '0 0 env(safe-area-inset-bottom,0)',
          animation: open
            ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            : 'slide-down 180ms ease forwards',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px' }} />
        <div style={{ padding: '0 16px 20px', display: 'grid', gap: 10 }}>
          {/* Edit */}
          <button
            onClick={onEdit}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 16px',
              background: 'var(--c-card)', border: '1px solid var(--c-line)',
              borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 14,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-card-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--c-card)')}
          >
            <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--c-navy-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Edit2 size={20} color="var(--c-navy)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)' }}>{t.edit}</div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{t.editSub}</div>
            </div>
            <ChevronRight size={16} color="var(--c-muted)" />
          </button>

          {/* Delete — opens a confirm step (does not delete on this tap) */}
          <button
            data-testid="goal-delete-action"
            onClick={onDelete}
            disabled={isDeleting}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 16px',
              background: 'var(--c-card)', border: '1px solid var(--c-line)',
              borderRadius: 14, cursor: isDeleting ? 'default' : 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 14,
              opacity: isDeleting ? 0.5 : 1,
            }}
            onMouseEnter={(e) => { if (!isDeleting) e.currentTarget.style.background = 'var(--c-card-2)' }}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--c-card)')}
          >
            <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--c-neg-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Trash2 size={20} color="var(--c-neg)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-neg)' }}>{isDeleting ? (isVI ? 'Đang xoá…' : 'Deleting…') : t.delete}</div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{t.deleteSub}</div>
            </div>
            <ChevronRight size={16} color="var(--c-muted)" />
          </button>

          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 10,
              border: '1px solid var(--c-line)', background: 'var(--c-card)',
              color: 'var(--c-ink)', fontSize: 15, cursor: 'pointer',
              fontFamily: 'inherit', marginTop: 4,
            }}
          >
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}

// Destructive-action confirm for the mobile goal-detail ⋯ menu. Mirrors the
// desktop DeleteGoalModal so deleting a goal is never a single un-undoable tap.
function DeleteGoalConfirmSheet({
  open,
  goalName,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  open: boolean
  goalName: string
  isDeleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const isVI = useLocale() === 'vi'
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (open) setMounted(true)
    else { const t = setTimeout(() => setMounted(false), 220); return () => clearTimeout(t) }
  }, [open])
  if (!mounted) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.2)',
        zIndex: 170, pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={() => { if (!isDeleting) onCancel() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isVI ? 'Xoá mục tiêu?' : 'Delete goal?'}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--c-card)', borderRadius: '16px 16px 0 0',
          padding: '0 0 env(safe-area-inset-bottom,0)',
          animation: open
            ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            : 'slide-down 180ms ease forwards',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px' }} />
        <div style={{ padding: '0 16px 24px', display: 'grid', gap: 16 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: 'var(--c-ink)' }}>
            {isVI ? 'Xoá mục tiêu?' : 'Delete goal?'}
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: 'var(--c-neg-tint)', borderRadius: 10 }}>
            <Trash2 size={15} color="var(--c-neg)" strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg)', lineHeight: 1.5 }}>
              {isVI
                ? `Mục tiêu "${goalName}" và tất cả liên kết đầu tư sẽ bị xoá vĩnh viễn.`
                : `"${goalName}" and all linked investments will be permanently deleted.`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              data-testid="goal-delete-cancel"
              onClick={onCancel}
              disabled={isDeleting}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid var(--c-line)',
                background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 15,
                cursor: isDeleting ? 'default' : 'pointer', fontFamily: 'inherit',
              }}
            >
              {isVI ? 'Huỷ' : 'Cancel'}
            </button>
            <button
              data-testid="goal-delete-confirm"
              onClick={onConfirm}
              disabled={isDeleting}
              style={{
                flex: 2, padding: '12px 0', borderRadius: 10, border: 'none',
                background: 'var(--c-neg)', color: '#fff', fontSize: 15, fontWeight: 600,
                cursor: isDeleting ? 'default' : 'pointer', opacity: isDeleting ? 0.6 : 1,
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Trash2 size={15} />
              {isDeleting ? (isVI ? 'Đang xoá…' : 'Deleting…') : (isVI ? 'Xoá mục tiêu' : 'Delete goal')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditGoalSheet({
  open,
  onClose,
  goal,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  goal: GoalData
  onSaved: () => void
}) {
  const isVI = useLocale() === 'vi'
  const [mounted, setMounted] = useState(false)
  const [name, setName] = useState(goal.goalName)
  const [target, setTarget] = useState(goal.targetAmount ? String(goal.targetAmount) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setName(goal.goalName); setTarget(goal.targetAmount ? String(goal.targetAmount) : ''); setError(''); setMounted(true) }
    else { const t = setTimeout(() => setMounted(false), 220); return () => clearTimeout(t) }
  }, [open, goal])

  async function handleSave() {
    if (!name.trim()) { setError(isVI ? 'Tên mục tiêu là bắt buộc' : 'Goal name is required'); return }
    setSaving(true)
    setError('')
    const r = await updateGoal(goal.goalId, { name: name.trim(), target: target ? Number(target) : null })
    if (!r.ok) setError(r.networkError ? (isVI ? 'Lỗi kết nối' : 'Connection error') : (r.error ?? (isVI ? 'Không thể lưu' : 'Could not save')))
    else { onSaved(); onClose() }
    setSaving(false)
  }

  if (!mounted) return null
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.2)',
        zIndex: 160, pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--c-card)', borderRadius: '16px 16px 0 0',
          padding: '0 0 env(safe-area-inset-bottom,0)',
          animation: open
            ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            : 'slide-down 180ms ease forwards',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px' }} />
        <div style={{ padding: '0 16px 24px' }}>
          <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, color: 'var(--c-ink)' }}>
            {isVI ? 'Chỉnh sửa mục tiêu' : 'Edit goal'}
          </p>
          {error && (
            <p style={{ color: 'var(--c-neg)', fontSize: 13, marginBottom: 10 }}>{error}</p>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 4 }}>
              {isVI ? 'Tên mục tiêu' : 'Goal name'}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', fontSize: 16,
                border: '1px solid var(--c-line)', borderRadius: 10,
                background: 'var(--c-card-2)', color: 'var(--c-ink)',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 4 }}>
              {isVI ? 'Mục tiêu (không bắt buộc)' : 'Target amount (optional)'}
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={formatIntVN(target)}
              onChange={(e) => setTarget(parseIntVN(e.target.value))}
              placeholder="0"
              style={{
                width: '100%', padding: '10px 12px', fontSize: 16,
                border: '1px solid var(--c-line)', borderRadius: 10,
                background: 'var(--c-card-2)', color: 'var(--c-ink)',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid var(--c-line)',
                background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 15, cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {isVI ? 'Huỷ' : 'Cancel'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 10, border: 'none',
                background: 'var(--c-btn-primary)', color: '#fff', fontSize: 15,
                cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
                fontFamily: 'inherit',
              }}
            >
              {saving ? (isVI ? 'Đang lưu…' : 'Saving…') : (isVI ? 'Lưu' : 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function InvestmentActionSheet({
  open,
  onClose,
  inv,
  renewalSummary,
  onViewHistory,
  onSell,
  onUnassign,
  onResolve,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  inv: InvRow | null
  renewalSummary: ReturnType<typeof buildRenewalSummary>
  onViewHistory: () => void
  onSell: () => void
  onUnassign: () => void
  onResolve: () => void
  onChanged: () => void
}) {
  const isVI = useLocale() === 'vi'
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (open) setMounted(true)
    else { const t = setTimeout(() => setMounted(false), 220); return () => clearTimeout(t) }
  }, [open])
  if (!mounted || !inv) return null

  const typeColor = GD_COLORS[inv.type] ?? 'var(--c-muted)'
  const isBank = inv.type === 'bank'
  const isPos = (inv.gainPct ?? 0) >= 0
  // A matured term deposit renews; a matured accumulating book collapses — both
  // open the same "Handle maturity" sheet (it branches internally).
  const needsMaturity = needsMaturityAction(inv, isVI) || needsBookMaturityAction(inv)

  const t = isVI ? {
    title: 'Tùy chọn',
    handle: 'Xử lý đáo hạn',
    handleSub: inv.depositGroupId ? 'Tất toán cả sổ & gửi lại' : 'Tái tục hoặc chuyển sang chờ rút',
    history: 'Lịch sử giao dịch',
    historySub: 'Xem các lần mua / bán trước đây',
    sell: isBank ? 'Rút tiền' : 'Bán',
    sellSub: inv.depositGroupId ? 'Tất toán toàn bộ sổ' : isBank ? 'Rút tiền gửi khỏi mục tiêu' : 'Bán khoản đầu tư',
    unassign: 'Bỏ gán mục tiêu',
    unassignSub: 'Chuyển khoản đầu tư này sang trạng thái chưa gán',
  } : {
    title: 'Options',
    handle: 'Handle maturity',
    handleSub: inv.depositGroupId ? 'Settle the book & re-deposit' : 'Renew or mark for withdrawal',
    history: 'Transaction history',
    historySub: 'View past buys & sells',
    sell: isBank ? 'Withdraw' : 'Sell',
    sellSub: inv.depositGroupId ? 'Close the whole book' : isBank ? 'Withdraw deposit from goal' : 'Liquidate this investment',
    unassign: 'Unassign from goal',
    unassignSub: 'Move this investment to unassigned',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.2)',
        zIndex: 150, pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--c-card)', borderRadius: '16px 16px 0 0',
          padding: '0 0 env(safe-area-inset-bottom,0)',
          animation: open
            ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            : 'slide-down 180ms ease forwards',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px' }} />
        <div style={{ padding: '0 16px 20px', display: 'grid', gap: 12 }}>
          {/* Item summary */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--c-card-2)', borderRadius: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'var(--c-card)', border: '1px solid var(--c-line)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: typeColor, flexShrink: 0,
            }}>
              <TypeIcon type={inv.type} size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-ink)' }}>
                {inv.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(inv.value)}</span>
                {inv.gainPct != null && (
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 999, fontWeight: 600,
                    background: isPos ? 'var(--c-pos-tint)' : 'var(--c-neg-tint)',
                    color: isPos ? 'var(--c-pos)' : 'var(--c-neg)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {fmtPct(inv.gainPct)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Bank info strip — interest rate + maturity + time left (issue #263);
              avg rate + top-up history for an accumulating book. */}
          <BankInfoStrip inv={inv} isVi={isVI} />

          {/* Top up — accumulating books only (renders nothing otherwise) */}
          <TopUpControl inv={inv} isVi={isVI} onDone={() => { onClose(); onChanged() }} />

          {/* Renewal history summary — only when this deposit has been renewed */}
          <RenewalSummaryLine summary={renewalSummary} isVi={isVI} />

          {/* Handle maturity — only for a term deposit at/near its maturity date */}
          {needsMaturity && (
            <button
              data-testid="handle-maturity-btn"
              onClick={() => { onClose(); setTimeout(onResolve, 60) }}
              style={{
                width: '100%', textAlign: 'left', padding: '14px 16px',
                background: 'var(--c-warn-tint)', border: '1px solid rgba(180,83,9,0.18)',
                borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 14,
              }}
            >
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--c-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <RefreshCw size={20} color="var(--c-warn)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-warn)' }}>{t.handle}</div>
                <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{t.handleSub}</div>
              </div>
              <ChevronRight size={16} color="var(--c-warn)" />
            </button>
          )}

          {/* View history */}
          <button
            onClick={() => { onClose(); setTimeout(onViewHistory, 60) }}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 16px',
              background: 'var(--c-card)', border: '1px solid var(--c-line)',
              borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 14,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-card-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--c-card)')}
          >
            <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--c-card-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Calendar size={20} color="var(--c-muted)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)' }}>{t.history}</div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{t.historySub}</div>
            </div>
            <ChevronRight size={16} color="var(--c-muted)" />
          </button>

          {/* Unassign from goal */}
          <button
            onClick={() => { onClose(); setTimeout(onUnassign, 60) }}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 16px',
              background: 'var(--c-card)', border: '1px solid var(--c-line)',
              borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 14,
              transition: 'background 120ms',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-card-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--c-card)')}
          >
            <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--c-warn-tint, #fef3c7)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <UnlinkSvg size={20} color="var(--c-warn, #b45309)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)' }}>{t.unassign}</div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{t.unassignSub}</div>
            </div>
            <ChevronRight size={16} color="var(--c-muted)" />
          </button>

          {/* Sell / Withdraw — for a book this is a FULL close (the sell sheet
              routes it through the book-withdraw endpoint). */}
          <button
            onClick={() => { onClose(); setTimeout(onSell, 60) }}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 16px',
              background: 'var(--c-card)', border: '1px solid var(--c-line)',
              borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 14,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-card-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--c-card)')}
          >
            <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--c-neg-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {isBank ? <Download size={20} color="var(--c-neg)" /> : <ArrowDownRight size={20} color="var(--c-neg)" />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)' }}>{t.sell}</div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{t.sellSub}</div>
            </div>
            <ChevronRight size={16} color="var(--c-muted)" />
          </button>
        </div>
      </div>
    </div>
  )
}

function UnassignConfirmSheet({
  open,
  onClose,
  inv,
  onConfirm,
  unassigning,
}: {
  open: boolean
  onClose: () => void
  inv: InvRow | null
  onConfirm: () => void
  unassigning: boolean
}) {
  const isVI = useLocale() === 'vi'
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (open) setMounted(true)
    else { const t = setTimeout(() => setMounted(false), 220); return () => clearTimeout(t) }
  }, [open])
  if (!mounted || !inv) return null

  const t = isVI ? {
    title: 'Bỏ gán mục tiêu?',
    body: 'Khoản đầu tư này sẽ được chuyển sang "Chưa gán". Bạn có thể gán lại bất kỳ lúc nào từ trang Kế hoạch.',
    confirm: 'Bỏ gán',
    cancel: 'Hủy',
    working: 'Đang xử lý…',
  } : {
    title: 'Unassign from goal?',
    body: 'This investment will be moved to "Unassigned". You can re-assign it any time from the Planning page.',
    confirm: 'Unassign',
    cancel: 'Cancel',
    working: 'Working…',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.2)',
        zIndex: 160, pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--c-card)', borderRadius: '16px 16px 0 0',
          padding: '0 0 env(safe-area-inset-bottom,0)',
          animation: open
            ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            : 'slide-down 180ms ease forwards',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px' }} />
        <div style={{ padding: '0 16px 20px', display: 'grid', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.title}</h2>

          {/* Item summary */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--c-card-2)', borderRadius: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'var(--c-warn-tint, #fef3c7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              color: 'var(--c-warn, #b45309)',
            }}>
              <TypeIcon type={inv.type} size={15} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.name}</div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(inv.value)}</div>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.55 }}>{t.body}</p>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              disabled={unassigning}
              style={{
                flex: 1, padding: '11px 14px', fontSize: 13, fontWeight: 500,
                background: 'var(--c-card)', border: '1px solid var(--c-line)',
                borderRadius: 10, color: 'var(--c-ink)', fontFamily: 'inherit',
                cursor: unassigning ? 'default' : 'pointer',
              }}
            >
              {t.cancel}
            </button>
            <button
              onClick={onConfirm}
              disabled={unassigning}
              style={{
                flex: 2, padding: '11px 14px', fontSize: 13, fontWeight: 600,
                background: 'var(--c-warn, #b45309)', color: '#fff',
                border: 'none', borderRadius: 10, fontFamily: 'inherit',
                cursor: unassigning ? 'default' : 'pointer',
                opacity: unassigning ? 0.6 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <UnlinkSvg size={14} color="#fff" />
              {unassigning ? t.working : t.confirm}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function GoalDetailSheet({ goal, open, onClose, onDataChanged, refreshKey, onAddToGoal }: Props) {
  const isVI = useLocale() === 'vi'
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
    const ok = await unholdTransaction(heldTxId)
    setUnholdingId(null)
    if (!ok) { toast.error(isVI ? 'Không thể bỏ chờ gộp' : "Couldn't cancel the merge hold"); return }
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
                // Held/merged settlements parked their cash — render neutral (like a
                // snapshot), never the red "−" of a real withdrawal.
                const kind = txKind(tx)
                const isWithdraw = kind === 'withdrawal'
                const neutral = isRenewed || kind === 'held' || kind === 'consumed'
                const ink = neutral ? 'var(--c-muted)' : isWithdraw ? 'var(--c-neg)' : 'var(--c-pos)'
                const fill = neutral ? 'var(--c-card-2)' : isWithdraw ? 'var(--c-neg-tint)' : 'var(--c-pos-tint)'
                const DirIcon = isRenewed ? RefreshCw : kind === 'held' ? PiggyBank : kind === 'consumed' ? GitMerge : isWithdraw ? ArrowDownRight : ArrowUpRight
                const sign = isWithdraw ? '-' : kind === 'investment' ? '+' : ''
                const name = tx.fund_name ?? tx.notes ?? (isVI ? 'Khoản đầu tư' : 'Investment')
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
                      <DirIcon size={14} strokeWidth={2.2} />
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
