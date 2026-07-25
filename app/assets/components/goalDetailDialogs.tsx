'use client'

// The mobile goal-detail sheet's dialogs (#467): the goal actions menu, the
// delete/edit-goal sheets, and the per-investment action + unassign-confirm sheets.
// Prop-driven — GoalDetailSheet owns the data + orchestration and passes handlers
// down. The edit-goal write goes through goalActions.updateGoal.
import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { ChevronRight, RefreshCw, Trash2, Edit2, Download, Calendar, ArrowDownRight } from 'lucide-react'
import { fmtCompact, fmtPct } from '@/lib/formatters'
import { formatIntVN, parseIntVN } from '@/lib/numberFormat'
import type { GoalData } from '../DashboardClient'
import { GD_COLORS, TypeIcon, UnlinkSvg, BankInfoStrip, TopUpControl, RenewalSummaryLine, type InvRow } from './goalDetailShared'
import { needsMaturityAction, needsBookMaturityAction } from './goalDetailMaturity'
import { buildRenewalSummary } from './goalDetailRows'
import { updateGoal } from './goalActions'

export function GoalActionsSheet({
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
export function DeleteGoalConfirmSheet({
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

export function EditGoalSheet({
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

export function InvestmentActionSheet({
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

export function UnassignConfirmSheet({
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
