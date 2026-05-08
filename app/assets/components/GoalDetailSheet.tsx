'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft, MoreHorizontal, X, Check } from 'lucide-react'
import { useLocale } from 'next-intl'
import { fmt, fmtShort, fmtPct } from '@/lib/formatters'
import type { GoalData, FundBreakdownItem } from '../DashboardClient'
import dynamic from 'next/dynamic'

const FundDetailModal = dynamic(() => import('./FundDetailModal'))

interface InvestmentTx {
  transaction_id: string
  transaction_type: string
  asset_type: string
  fund_id: string | null
  fund_name: string | null
  fund_code: string | null
  investment_date: string
  amount_vnd: number
  units: number | null
  unit_price: number | null
  interest_rate: number | null
  expiry_date: string | null
  notes: string | null
  principal_withdrawn: number | null
  units_withdrawn: number | null
}

interface Props {
  goal: GoalData | null
  open: boolean
  onClose: () => void
  onDataChanged: () => void
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
        <div style={{ padding: '0 16px 16px' }}>
          <button
            onClick={onEdit}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
              padding: '14px 0',
              background: 'none', border: 'none', borderBottom: '1px solid var(--c-line)',
              color: 'var(--c-ink)', fontSize: 15, cursor: 'pointer',
            }}
          >
            Edit goal
          </button>
          <button
            onClick={onDelete}
            disabled={isDeleting}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
              padding: '14px 0', background: 'none', border: 'none',
              color: 'var(--c-neg)', fontSize: 15, cursor: 'pointer',
              opacity: isDeleting ? 0.5 : 1,
            }}
          >
            {isDeleting ? 'Deleting…' : 'Delete goal'}
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
                width: '100%', padding: '10px 12px', fontSize: 15,
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
                width: '100%', padding: '10px 12px', fontSize: 15,
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
              }}
            >
              {isVI ? 'Huỷ' : 'Cancel'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 10, border: 'none',
                background: 'var(--c-navy)', color: '#fff', fontSize: 15,
                cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
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
  fund,
  onViewHistory,
  onSell,
}: {
  open: boolean
  onClose: () => void
  fund: FundBreakdownItem | null
  onViewHistory: () => void
  onSell: () => void
}) {
  const isVI = useLocale() === 'vi'
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (open) setMounted(true)
    else { const t = setTimeout(() => setMounted(false), 220); return () => clearTimeout(t) }
  }, [open])
  if (!mounted || !fund) return null
  const pl = fund.profitLoss
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
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ background: 'var(--c-card-2)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
            <p style={{ fontWeight: 700, fontSize: 15, color: 'var(--c-ink)', marginBottom: 4 }}>{fund.fundName}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--c-muted)' }}>{isVI ? 'Giá trị' : 'Value'}</span>
              <span style={{ color: 'var(--c-ink)', fontWeight: 600 }}>{fmt(fund.currentValue)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
              <span style={{ color: 'var(--c-muted)' }}>P/L</span>
              <span style={{ color: pl >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', fontWeight: 600 }}>
                {pl >= 0 ? '+' : ''}{fmt(pl)} ({fmtPct(fund.profitLossPercentage)})
              </span>
            </div>
          </div>
          <button
            onClick={() => { onClose(); setTimeout(onViewHistory, 60) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
              padding: '14px 0', background: 'none', border: 'none',
              borderBottom: '1px solid var(--c-line)',
              color: 'var(--c-ink)', fontSize: 15, cursor: 'pointer',
            }}
          >
            {isVI ? 'Lịch sử giao dịch' : 'Transaction history'}
          </button>
          <button
            onClick={() => { onClose(); setTimeout(onSell, 60) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
              padding: '14px 0', background: 'none', border: 'none',
              color: 'var(--c-neg)', fontSize: 15, cursor: 'pointer',
            }}
          >
            {isVI ? 'Bán / Rút' : 'Sell / Withdraw'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function GoalDetailSheet({ goal, open, onClose, onDataChanged }: Props) {
  const isVI = useLocale() === 'vi'
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'investments' | 'calculator' | 'history'>('investments')
  const [transactions, setTransactions] = useState<InvestmentTx[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [actionFund, setActionFund] = useState<FundBreakdownItem | null>(null)
  const [investActionOpen, setInvestActionOpen] = useState(false)
  const [fundDetailId, setFundDetailId] = useState<string | null>(null)
  const [purchaseHistory, setPurchaseHistory] = useState<{ purchase_date: string; units: number; nav_at_purchase: number }[]>([])
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
    fetch(`/api/v1/investment-transactions?goal_id=${goal.goalId}&limit=200`)
      .then((r) => r.ok ? r.json() : { transactions: [] })
      .then((res) => setTransactions(res.transactions ?? []))
      .catch(() => setTransactions([]))
      .finally(() => setTxLoading(false))
  }, [open, goal])

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

  async function openFundDetail(fund: FundBreakdownItem) {
    setFundDetailId(fund.fundId)
    try {
      const res = await fetch(`/api/v1/fund-investments?fund_id=${fund.fundId}`)
      if (res.ok) {
        const items = await res.json()
        setPurchaseHistory(
          (items as Array<{ nav_at_purchase: number; units_purchased: number; investment_date: string | null; created_at: string }>)
            .map((i) => ({ purchase_date: i.investment_date ?? i.created_at, units: i.units_purchased, nav_at_purchase: i.nav_at_purchase }))
            .sort((a, b) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime())
        )
      }
    } catch { /* ignore */ }
  }

  if (!mounted || !goal) return null

  const progress = Math.min(goal.progressPercentage ?? 0, 100)
  const exceededTarget = goal.progressPercentage !== null && goal.progressPercentage >= 100
  const investmentRows = transactions.filter((tx) => tx.transaction_type !== 'withdrawal')
  const deduped = new Map<string, InvestmentTx>()
  investmentRows.forEach((tx) => {
    if (tx.fund_id) {
      if (!deduped.has(tx.fund_id)) deduped.set(tx.fund_id, tx)
    } else {
      deduped.set(tx.transaction_id, tx)
    }
  })
  const investRows = Array.from(deduped.values())

  const fundItems = goal.funds
  const fundMap = new Map(fundItems.map((f) => [f.fundId, f]))

  const allFundValue = fundItems.reduce((s, f) => s + f.currentValue, 0)

  const monthly = parseFloat(monthlyContrib.replace(/,/g, '')) || 0
  const annualReturn = 0.12
  const remaining = goal.targetAmount ? Math.max(goal.targetAmount - goal.currentValue, 0) : 0
  let projectedMonths = 0
  if (monthly > 0 && remaining > 0) {
    const r = annualReturn / 12
    if (r === 0) {
      projectedMonths = Math.ceil(remaining / monthly)
    } else {
      projectedMonths = Math.ceil(Math.log(1 + (remaining * r) / monthly) / Math.log(1 + r))
    }
  }
  const projectedDate = projectedMonths > 0
    ? new Date(Date.now() + projectedMonths * 30 * 24 * 60 * 60 * 1000).toLocaleDateString(isVI ? 'vi-VN' : 'en-US', { month: 'short', year: 'numeric' })
    : null

  const detailFund = fundDetailId ? (fundMap.get(fundDetailId) ?? null) : null

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
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--c-line)',
          background: 'var(--c-card)', position: 'sticky', top: 0, zIndex: 10,
        }}>
          <button
            data-testid="goal-back-btn"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--c-ink)', display: 'flex', alignItems: 'center' }}
          >
            <ChevronLeft size={20} />
          </button>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 11, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {isVI ? 'Mục tiêu' : 'Goal'}
            </p>
            <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-ink)', lineHeight: 1.2 }}>{goal.goalName}</p>
          </div>
          <button
            onClick={() => setActionsOpen(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--c-ink)', display: 'flex', alignItems: 'center' }}
          >
            <MoreHorizontal size={18} />
          </button>
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
            <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-ink)', marginBottom: 2 }}>
              {fmt(goal.currentValue)}
            </p>
            {goal.targetAmount && (
              <p style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 12 }}>
                {fmt(goal.currentValue)} / {fmt(goal.targetAmount)} {isVI ? 'mục tiêu' : 'target'}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--c-muted)' }}>
                  <span>
                    {exceededTarget
                      ? (isVI ? 'Đã đạt mục tiêu' : 'Target reached')
                      : `${Math.round(progress)}% ${isVI ? 'hoàn thành' : 'complete'}`}
                  </span>
                  <span>{transactions.length} {isVI ? 'giao dịch' : 'transactions'}</span>
                </div>
              </>
            )}

            {/* P/L grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--c-line)' }}>
              {[
                { label: isVI ? 'Đã đầu tư' : 'Invested', value: fmtShort(goal.totalInvested), color: 'var(--c-ink)' },
                { label: 'P/L', value: (goal.profitLoss >= 0 ? '+' : '') + fmtShort(goal.profitLoss), color: goal.profitLoss >= 0 ? 'var(--c-pos)' : 'var(--c-neg)' },
                { label: isVI ? 'Lợi nhuận' : 'Return', value: fmtPct(goal.profitLossPercentage), color: goal.profitLossPercentage >= 0 ? 'var(--c-pos)' : 'var(--c-neg)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 11, color: 'var(--c-muted)', marginBottom: 2 }}>{label}</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color }}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Composition bar */}
          {fundItems.length > 0 && (
            <div style={{ background: 'var(--c-card)', borderRadius: 16, padding: 16, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', marginBottom: 10 }}>
                {isVI ? 'Cơ cấu' : 'Composition'}
              </p>
              <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', gap: 1 }}>
                {fundItems.map((f, i) => {
                  const pct = allFundValue > 0 ? (f.currentValue / allFundValue) * 100 : 0
                  const colors = ['#2563eb', '#047857', '#d97706', '#7c3aed', '#ef4444', '#0891b2']
                  return <div key={f.fundId} style={{ width: `${pct}%`, background: colors[i % colors.length], minWidth: pct > 0 ? 2 : 0 }} />
                })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginTop: 10 }}>
                {fundItems.map((f, i) => {
                  const colors = ['#2563eb', '#047857', '#d97706', '#7c3aed', '#ef4444', '#0891b2']
                  return (
                    <div key={f.fundId} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: colors[i % colors.length], flexShrink: 0 }} />
                      <span style={{ color: 'var(--c-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.fundName}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--c-line)', marginBottom: 0 }}>
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
                    flex: 1, padding: '10px 0', fontSize: 13, fontWeight: activeTab === tab ? 700 : 400,
                    color: activeTab === tab ? 'var(--c-navy)' : 'var(--c-muted)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    borderBottom: activeTab === tab ? '2px solid var(--c-navy)' : '2px solid transparent',
                  }}
                >
                  {labels[tab]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab content */}
        <div style={{ padding: '16px 16px 80px' }}>
          {/* Investments tab */}
          {activeTab === 'investments' && (
            <div>
              {txLoading && (
                <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
                  {isVI ? 'Đang tải…' : 'Loading…'}
                </p>
              )}
              {!txLoading && investRows.length === 0 && (
                <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
                  {isVI ? 'Chưa có khoản đầu tư nào' : 'No investments yet'}
                </p>
              )}
              {!txLoading && investRows.map((tx) => {
                const fund = tx.fund_id ? fundMap.get(tx.fund_id) ?? null : null
                const name = fund?.fundName ?? tx.notes ?? (tx.asset_type === 'bank' ? (isVI ? 'Tiền gửi' : 'Bank deposit') : tx.asset_type === 'gold' ? (isVI ? 'Vàng' : 'Gold') : tx.asset_type)
                const value = fund?.currentValue ?? tx.amount_vnd
                const pl = fund?.profitLoss ?? 0
                const plPct = fund?.profitLossPercentage ?? 0
                return (
                  <div
                    key={tx.fund_id ?? tx.transaction_id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 0', borderBottom: '1px solid var(--c-line)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--c-muted)' }}>
                        {tx.asset_type}
                        {fund && ` · ${fmtShort(fund.purchasePrice * fund.quantity)} ${isVI ? 'đầu tư' : 'invested'}`}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', marginRight: 8 }}>
                      <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-ink)' }}>{fmtShort(value)}</p>
                      <p style={{ fontSize: 12, color: pl >= 0 ? 'var(--c-pos)' : 'var(--c-neg)' }}>
                        {pl >= 0 ? '+' : ''}{fmtPct(plPct)}
                      </p>
                    </div>
                    {fund && (
                      <button
                        onClick={() => { setActionFund(fund); setInvestActionOpen(true) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--c-muted)' }}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Calculator tab */}
          {activeTab === 'calculator' && (
            <div style={{ background: 'var(--c-card)', borderRadius: 16, padding: 18 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 6 }}>
                  {isVI ? 'Đóng góp hàng tháng (₫)' : 'Monthly contribution (₫)'}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={monthlyContrib}
                  onChange={(e) => setMonthlyContrib(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="0"
                  style={{
                    width: '100%', padding: '10px 12px', fontSize: 16,
                    border: '1px solid var(--c-line)', borderRadius: 10,
                    background: 'var(--c-card-2)', color: 'var(--c-ink)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              {goal.targetAmount ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span style={{ color: 'var(--c-muted)' }}>{isVI ? 'Còn lại' : 'Remaining'}</span>
                    <span style={{ fontWeight: 600, color: 'var(--c-ink)' }}>{fmt(remaining)}</span>
                  </div>
                  {monthly > 0 && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                        <span style={{ color: 'var(--c-muted)' }}>{isVI ? 'Cần mỗi tháng' : 'Needed/month'}</span>
                        <span style={{ fontWeight: 600, color: 'var(--c-ink)' }}>{fmt(monthly)}</span>
                      </div>
                      {projectedDate && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                          <span style={{ color: 'var(--c-muted)' }}>{isVI ? 'Dự kiến đạt' : 'Projected completion'}</span>
                          <span style={{ fontWeight: 700, color: 'var(--c-pos)' }}>{projectedDate}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 14, color: 'var(--c-muted)' }}>
                  {isVI
                    ? 'Đặt mục tiêu để xem dự báo thời gian.'
                    : 'Set a target amount to see projected completion date.'}
                  {monthly > 0 && goal.currentValue > 0 && (
                    <p style={{ marginTop: 12, color: 'var(--c-ink)' }}>
                      {isVI ? 'Lợi suất hàng năm ước tính: ' : 'Estimated annual return at current pace: '}
                      <strong>~12%</strong>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* History tab */}
          {activeTab === 'history' && (
            <div>
              {txLoading && (
                <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
                  {isVI ? 'Đang tải…' : 'Loading…'}
                </p>
              )}
              {!txLoading && transactions.length === 0 && (
                <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
                  {isVI ? 'Chưa có giao dịch nào' : 'No transactions yet'}
                </p>
              )}
              {!txLoading && transactions.map((tx) => {
                const isWithdraw = tx.transaction_type === 'withdrawal'
                const typeLabel = isWithdraw
                  ? (tx.asset_type === 'bank' ? (isVI ? 'Rút' : 'Withdraw') : (isVI ? 'Bán' : 'Sell'))
                  : (tx.asset_type === 'bank' ? (isVI ? 'Nạp' : 'Deposit') : (isVI ? 'Mua' : 'Buy'))
                const name = tx.fund_name ?? tx.notes ?? tx.asset_type
                return (
                  <div
                    key={tx.transaction_id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 0', borderBottom: '1px solid var(--c-line)',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999,
                          textTransform: 'uppercase',
                          background: isWithdraw ? 'var(--c-neg-tint)' : 'var(--c-pos-tint)',
                          color: isWithdraw ? 'var(--c-neg)' : 'var(--c-pos)',
                        }}>
                          {typeLabel}
                        </span>
                        <p style={{ fontSize: 13, color: 'var(--c-ink)', fontWeight: 500 }}>{name}</p>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--c-muted)' }}>
                        {new Date(tx.investment_date).toLocaleDateString(isVI ? 'vi-VN' : 'en-US')}
                      </p>
                    </div>
                    <p style={{ fontWeight: 600, fontSize: 14, color: isWithdraw ? 'var(--c-neg)' : 'var(--c-ink)' }}>
                      {isWithdraw ? '-' : '+'}{fmtShort(tx.amount_vnd)}
                    </p>
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
        fund={actionFund}
        onViewHistory={() => actionFund && openFundDetail(actionFund)}
        onSell={() => { /* SellWithdrawSheet integration point */ }}
      />

      {detailFund && (
        <FundDetailModal
          open={!!fundDetailId}
          onOpenChange={(o) => { if (!o) { setFundDetailId(null); setPurchaseHistory([]) } }}
          fundId={detailFund.fundId}
          fundName={detailFund.fundName}
          currentNAV={detailFund.currentNAV}
          quantity={detailFund.quantity}
          currentValue={detailFund.currentValue}
          purchasePrice={detailFund.purchasePrice}
          profitLoss={detailFund.profitLoss}
          profitLossPercentage={detailFund.profitLossPercentage}
          purchaseHistory={purchaseHistory}
          onClose={() => { setFundDetailId(null); setPurchaseHistory([]) }}
        />
      )}
    </>
  )
}
