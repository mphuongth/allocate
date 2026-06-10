'use client'

import { useState, useEffect } from 'react'
import {
  ChevronLeft, ChevronRight, MoreHorizontal,
  Edit2, Trash2, Calendar, Download, ArrowDownRight, ArrowUpRight, Target,
} from 'lucide-react'
import { useLocale } from 'next-intl'
import { fmt, fmtCompact, fmtPct } from '@/lib/formatters'
import type { GoalData, FundBreakdownItem } from '../DashboardClient'
import TransactionHistorySheet, { type PurchaseHistoryRow } from './TransactionHistorySheet'
import { SellWithdrawSheet, type SellItem } from './SellWithdrawSheet'
import { GD_COLORS, calcDeadlineMonths, TypeIcon, UnlinkSvg, buildInvRows, BankInfoStrip, type InvRow } from './goalDetailShared'
import { fmtTxDate } from './transactionUtils'
import { TxRowsSkeleton } from './Skeletons'

interface InvestmentTx {
  transaction_id: string
  transaction_type: string
  asset_type: string
  fund_id: string | null
  fund_name: string | null
  fund_code: string | null
  parent_transaction_id: string | null
  investment_date: string
  amount_vnd: number
  units: number | null
  unit_price: number | null
  interest_rate: number | null
  expiry_date: string | null
  notes: string | null
  principal_withdrawn: number | null
  units_withdrawn: number | null
  is_recurring?: boolean
}

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

          {/* Delete */}
          <button
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
    try {
      const res = await fetch(`/api/v1/savings-goals/${goal.goalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_name: name.trim(), target_amount: target ? Number(target) : null }),
      })
      if (!res.ok) {
        const { error: e } = await res.json()
        setError(e ?? (isVI ? 'Không thể lưu' : 'Could not save'))
      } else {
        onSaved()
        onClose()
      }
    } catch {
      setError(isVI ? 'Lỗi kết nối' : 'Connection error')
    }
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
              value={target ? Number(target).toLocaleString('en-US') : ''}
              onChange={(e) => setTarget(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))}
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

// Mirror of DashboardClient.openSellFund / openSellNonFund so the goal-detail
// sell flow submits the same payload the SellWithdrawSheet expects.
function invToSellItem(inv: InvRow): SellItem {
  if (inv.fund) {
    return {
      type: 'fund',
      name: inv.fund.fundName,
      currentValue: inv.fund.currentValue,
      units: inv.fund.quantity,
      navPerUnit: inv.fund.currentNAV,
      gainPct: inv.fund.profitLossPercentage,
      fundId: inv.fund.fundId,
      purchasePrice: inv.fund.purchasePrice,
    }
  }
  const navPerUnit = inv.units && inv.units > 0 ? inv.value / inv.units : undefined
  return {
    type: inv.type as 'bank' | 'gold' | 'stock',
    name: inv.name,
    currentValue: inv.value,
    units: inv.units ?? undefined,
    navPerUnit,
    gainPct: inv.gainPct ?? undefined,
    transactionId: inv.id,
    purchasePrice: inv.principal ?? inv.value,
  }
}

function InvestmentActionSheet({
  open,
  onClose,
  inv,
  onViewHistory,
  onSell,
  onUnassign,
}: {
  open: boolean
  onClose: () => void
  inv: InvRow | null
  onViewHistory: () => void
  onSell: () => void
  onUnassign: () => void
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

  const t = isVI ? {
    title: 'Tùy chọn',
    history: 'Lịch sử giao dịch',
    historySub: 'Xem các lần mua / bán trước đây',
    sell: isBank ? 'Rút tiền' : 'Bán',
    sellSub: isBank ? 'Rút tiền gửi khỏi mục tiêu' : 'Bán khoản đầu tư',
    unassign: 'Bỏ gán mục tiêu',
    unassignSub: 'Chuyển khoản đầu tư này sang trạng thái chưa gán',
  } : {
    title: 'Options',
    history: 'Transaction history',
    historySub: 'View past buys & sells',
    sell: isBank ? 'Withdraw' : 'Sell',
    sellSub: isBank ? 'Withdraw deposit from goal' : 'Liquidate this investment',
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

          {/* Bank info strip — interest rate + maturity + time left (issue #263) */}
          <BankInfoStrip inv={inv} isVi={isVI} />

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

          {/* Sell / Withdraw */}
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

export default function GoalDetailSheet({ goal, open, onClose, onDataChanged, refreshKey }: Props) {
  const isVI = useLocale() === 'vi'
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'investments' | 'calculator' | 'history'>('investments')
  const [transactions, setTransactions] = useState<InvestmentTx[]>([])
  const [goldPricePerChi, setGoldPricePerChi] = useState<number | null>(null)
  const [txLoading, setTxLoading] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [actionInv, setActionInv] = useState<InvRow | null>(null)
  const [investActionOpen, setInvestActionOpen] = useState(false)
  const [sellOpen, setSellOpen] = useState(false)
  const [unassignConfirmOpen, setUnassignConfirmOpen] = useState(false)
  const [unassigning, setUnassigning] = useState(false)
  const [unassignedIds, setUnassignedIds] = useState<string[]>([])
  const [fundDetailId, setFundDetailId] = useState<string | null>(null)
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [monthlyContrib, setMonthlyContrib] = useState('')

  useEffect(() => {
    if (open) {
      setMounted(true)
      setActiveTab('investments')
    } else {
      const t = setTimeout(() => setMounted(false), 220)
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open || !goal) return
    setTxLoading(true)
    // The new server response is the source of truth — drop any locally
    // hidden tx IDs from the unassign flow so a re-assigned tx isn't stuck
    // behind the optimistic filter on subsequent refreshes.
    setUnassignedIds([])
    // cache: 'no-store' — without it the browser can serve a stale list when
    // an investment was just (re)assigned to this goal in the same session.
    // Recurring savings are plan-only (no investment_transactions row), so fetch
    // their realized contributions separately and merge into the history list.
    Promise.all([
      fetch(`/api/v1/investment-transactions?goal_id=${goal.goalId}&limit=200`, { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : { transactions: [] }),
      fetch(`/api/v1/savings-goals/${goal.goalId}/recurring-contributions`, { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : { contributions: [] }),
    ])
      .then(([txRes, recRes]) => {
        const merged: InvestmentTx[] = [...(txRes.transactions ?? []), ...(recRes.contributions ?? [])]
        merged.sort((a, b) => (a.investment_date < b.investment_date ? 1 : a.investment_date > b.investment_date ? -1 : 0))
        setTransactions(merged)
      })
      .catch(() => setTransactions([]))
      .finally(() => setTxLoading(false))
    // Gold is valued at the live market price per chỉ, not its purchase cost —
    // without this the sell sheet would prefill the stale buy price (issue #251).
    fetch('/api/v1/gold-price', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((res) => setGoldPricePerChi(res?.price_per_chi ?? null))
      .catch(() => setGoldPricePerChi(null))
  }, [open, goal, refreshKey])

  async function handleDelete() {
    if (!goal) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/v1/savings-goals/${goal.goalId}`, { method: 'DELETE' })
      if (res.ok) { onDataChanged(); onClose() }
    } finally {
      setIsDeleting(false)
    }
    setActionsOpen(false)
  }

  // Mirror of DesktopGoalDetail.handleUnassign — fund rows aggregate every
  // fund-investment under the same fund, non-fund rows correspond to a
  // single investment_transactions row.
  async function handleUnassignConfirm() {
    if (!actionInv) return
    setUnassigning(true)
    try {
      if (actionInv.fund) {
        const res = await fetch(`/api/v1/fund-investments?fund_id=${actionInv.fund.fundId}`)
        if (!res.ok) throw new Error('fetch failed')
        const data = await res.json() as { investments?: Array<{ id: string }> }
        const investments = data.investments ?? []
        await Promise.all(investments.map((fi) =>
          fetch(`/api/v1/fund-investments/${fi.id}/goal`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ goal_id: null }),
          })
        ))
      } else {
        await fetch(`/api/v1/investment-transactions/${actionInv.id}/assign`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal_id: null }),
        })
      }
      setUnassignedIds((prev) => [...prev, actionInv.id])
      setUnassignConfirmOpen(false)
      setActionInv(null)
      onDataChanged()
    } finally {
      setUnassigning(false)
    }
  }

  async function openFundDetail(fund: FundBreakdownItem) {
    setFundDetailId(fund.fundId)
    setPurchaseHistory([])
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/v1/fund-investments?fund_id=${fund.fundId}`)
      if (res.ok) {
        const items = await res.json()
        setPurchaseHistory(
          (items as Array<{ nav_at_purchase: number | null; units_purchased: number | null; investment_date: string | null; created_at: string; is_dca_seeded?: boolean }>)
            .filter((i) => !(i.is_dca_seeded && i.units_purchased == null))
            .map((i) => ({ purchase_date: i.investment_date ?? i.created_at, units: i.units_purchased, nav_at_purchase: i.nav_at_purchase }))
            .sort((a, b) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime())
        )
      }
    } catch { /* ignore */ }
    setHistoryLoading(false)
  }

  if (!mounted || !goal) return null

  const progress = Math.min(goal.progressPercentage ?? 0, 100)
  const exceededTarget = goal.progressPercentage !== null && goal.progressPercentage >= 100
  const isPositive = goal.profitLoss >= 0

  const fundMap = new Map(goal.funds.map((f) => [f.fundId, f]))

  // Build typed investment rows for the Investments tab, then drop any
  // optimistically-unassigned ones.
  const invRows: InvRow[] = buildInvRows(transactions, goal.funds, goldPricePerChi, isVI)
    .filter((row) => !unassignedIds.includes(row.id))

  // Calculator
  const remaining = goal.targetAmount ? Math.max(goal.targetAmount - goal.currentValue, 0) : 0
  const monthsLeft = calcDeadlineMonths(goal.targetDate)
  const neededPerMonth = remaining > 0 ? remaining / monthsLeft : 0
  const monthly = Math.max(0, parseFloat(monthlyContrib.replace(/,/g, '')) || 0)
  const projectedMonths = monthly > 0 && remaining > 0 ? Math.ceil(remaining / monthly) : 0
  const projectedDate = projectedMonths > 0
    ? (() => { const d = new Date(); d.setMonth(d.getMonth() + projectedMonths); return d })()
    : null
  const isOnTrack = monthly > 0 && monthly >= neededPerMonth
  const gap = Math.abs(neededPerMonth - monthly)

  const detailFund = fundDetailId ? (fundMap.get(fundDetailId) ?? null) : null

  // Composition breakdown by asset type
  const breakdown: Record<string, number> = {}
  invRows.forEach((inv) => { breakdown[inv.type] = (breakdown[inv.type] ?? 0) + inv.value })
  const segs = Object.entries(breakdown).map(([k, v]) => ({ label: k, value: v, color: GD_COLORS[k] ?? 'var(--c-muted)' }))

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
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--c-ink)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
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
              onClick={() => setActionsOpen(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--c-ink)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
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
                {fmtCompact(goal.currentValue)} / {fmtCompact(goal.targetAmount)} {isVI ? 'mục tiêu' : 'target'}
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

          {/* Composition bar */}
          {segs.length > 0 && (
            <div style={{ background: 'var(--c-card)', borderRadius: 16, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
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
              {txLoading && <TxRowsSkeleton />}
              {!txLoading && invRows.length === 0 && (
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
                      type="number"
                      value={monthlyContrib}
                      onChange={(e) => setMonthlyContrib(e.target.value)}
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
              {!txLoading && transactions.length === 0 && (
                <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
                  {isVI ? 'Chưa có giao dịch nào' : 'No transactions yet'}
                </p>
              )}
              {!txLoading && transactions.map((tx, i) => {
                const isWithdraw = tx.transaction_type === 'withdrawal'
                const name = tx.fund_name ?? tx.notes ?? (isVI ? 'Khoản đầu tư' : 'Investment')
                return (
                  <div
                    key={tx.transaction_id}
                    style={{
                      padding: '14px 0',
                      borderBottom: i === transactions.length - 1 ? 'none' : '1px solid var(--c-line)',
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: isWithdraw ? 'var(--c-neg-tint)' : 'var(--c-pos-tint)',
                      color: isWithdraw ? 'var(--c-neg)' : 'var(--c-pos)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isWithdraw
                        ? <ArrowDownRight size={14} strokeWidth={2.2} />
                        : <ArrowUpRight size={14} strokeWidth={2.2} />
                      }
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-ink)' }}>{name}</div>
                      <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2 }}>
                        {fmtTxDate(tx.investment_date, isVI ? 'vi' : 'en')}
                      </div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: isWithdraw ? 'var(--c-neg)' : 'var(--c-pos)', fontVariantNumeric: 'tabular-nums' }}>
                      {isWithdraw ? '-' : '+'}{fmtCompact(tx.amount_vnd)}
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
        onDelete={handleDelete}
        isDeleting={isDeleting}
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
        onViewHistory={() => {
          if (actionInv?.fund) openFundDetail(actionInv.fund)
          else setActiveTab('history')
        }}
        onSell={() => setSellOpen(true)}
        onUnassign={() => setUnassignConfirmOpen(true)}
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
    </>
  )
}
