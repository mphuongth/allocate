'use client'

import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, X, TrendingUp, Building, CircleDollarSign, BarChart2, MoreHorizontal, Edit2, Trash2, ChevronRight, ArrowDownRight, ArrowUpRight, Target, CalendarDays, Check, ArrowDownToLine, Wallet, Shield } from 'lucide-react'
import { fmt, fmtCompact, fmtPct } from '@/lib/formatters'
import type { GoalData, FundBreakdownItem } from '../DashboardClient'

interface InvestmentTx {
  transaction_id: string
  transaction_type: string
  asset_type: string
  fund_id: string | null
  fund_name: string | null
  investment_date: string
  amount_vnd: number
  units: number | null
  interest_rate: number | null
  notes: string | null
}

interface InvRow {
  id: string
  name: string
  type: string
  value: number
  gainPct: number | null
  units: number | null
  principal: number | null
  interestRate: number | null
  fund: FundBreakdownItem | null
}

interface Props {
  goal: GoalData
  locale: string
  onClose: () => void
  onDataChanged: () => void
}

const GD_COLORS: Record<string, string> = {
  fund: '#2563eb',
  bank: '#047857',
  gold: '#d97706',
  stock: '#7c3aed',
}

function TypeIcon({ type, size = 13 }: { type: string; size?: number }) {
  if (type === 'fund') return <TrendingUp size={size} />
  if (type === 'bank') return <Building size={size} />
  if (type === 'gold') return <CircleDollarSign size={size} />
  return <BarChart2 size={size} />
}

function calcDeadlineMonths(targetDate: string | null): number {
  if (!targetDate) return 12
  const [ty, tm] = targetDate.split('-').map(Number)
  const now = new Date()
  return Math.max(1, (ty - now.getFullYear()) * 12 + (tm - 1 - now.getMonth()))
}

function UnlinkSvg({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <path d="M2 2l20 20" />
    </svg>
  )
}

export default function DesktopGoalDetail({ goal, locale, onClose, onDataChanged }: Props) {
  const isVi = locale === 'vi'
  const [tab, setTab] = useState<'investments' | 'calculator' | 'history'>('investments')
  const [transactions, setTransactions] = useState<InvestmentTx[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [calcAmount, setCalcAmount] = useState('')

  // Investment options state
  const [actionInv, setActionInv] = useState<InvRow | null>(null)
  const [showInvOptions, setShowInvOptions] = useState(false)
  const [showSell, setShowSell] = useState(false)
  const [showUnassignConfirm, setShowUnassignConfirm] = useState(false)
  const [unassigning, setUnassigning] = useState(false)
  const [unassignedIds, setUnassignedIds] = useState<string[]>([])

  useEffect(() => {
    setTxLoading(true)
    setTab('investments')
    setUnassignedIds([])
    fetch(`/api/v1/investment-transactions?goal_id=${goal.goalId}&limit=200`)
      .then((r) => r.ok ? r.json() : { transactions: [] })
      .then((res) => setTransactions(res.transactions ?? []))
      .catch(() => setTransactions([]))
      .finally(() => setTxLoading(false))
  }, [goal.goalId])

  async function handleDelete() {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/v1/savings-goals/${goal.goalId}`, { method: 'DELETE' })
      if (res.ok) { setDeleteOpen(false); onDataChanged() }
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
      setShowUnassignConfirm(false)
      setActionInv(null)
      onDataChanged()
    } finally {
      setUnassigning(false)
    }
  }

  const isPos = goal.profitLoss >= 0
  const isComplete = (goal.progressPercentage ?? 0) >= 100
  const progress = Math.min(goal.progressPercentage ?? 0, 100)

  // Build investment rows
  const investmentRows = transactions.filter((tx) => tx.transaction_type !== 'withdrawal')
  const deduped = new Map<string, InvestmentTx>()
  investmentRows.forEach((tx) => {
    if (tx.fund_id) {
      if (!deduped.has(tx.fund_id)) deduped.set(tx.fund_id, tx)
    } else {
      deduped.set(tx.transaction_id, tx)
    }
  })
  const investTxRows = Array.from(deduped.values())
  const fundMap = new Map(goal.funds.map((f) => [f.fundId, f]))

  const invRows: InvRow[] = investTxRows.map((tx) => {
    const fund = tx.fund_id ? fundMap.get(tx.fund_id) ?? null : null
    const name = fund?.fundName ?? tx.notes ?? (
      tx.asset_type === 'bank' ? (isVi ? 'Tiền gửi' : 'Bank deposit') :
      tx.asset_type === 'gold' ? (isVi ? 'Vàng' : 'Gold') : tx.asset_type
    )
    let value: number, gainPct: number | null, units: number | null, principal: number | null
    if (fund) {
      value = fund.currentValue
      gainPct = fund.profitLossPercentage
      units = fund.quantity
      principal = null
    } else if (tx.asset_type === 'bank' && tx.interest_rate) {
      const months = Math.max(0, Math.floor(
        (Date.now() - new Date(tx.investment_date).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      ))
      value = Math.round(tx.amount_vnd * Math.pow(1 + tx.interest_rate / 100 / 12, months))
      gainPct = tx.amount_vnd > 0 ? ((value - tx.amount_vnd) / tx.amount_vnd) * 100 : 0
      units = null
      principal = tx.amount_vnd
    } else {
      value = tx.amount_vnd
      gainPct = null
      units = tx.units
      principal = tx.amount_vnd
    }
    return { id: tx.transaction_id, name, type: tx.asset_type, value, gainPct, units, principal, interestRate: tx.interest_rate, fund: fund ?? null }
  })

  // Composition segments
  const breakdown: Record<string, number> = {}
  invRows.forEach((inv) => { breakdown[inv.type] = (breakdown[inv.type] ?? 0) + inv.value })
  const segs = Object.entries(breakdown).map(([k, v]) => ({ label: k, value: v, color: GD_COLORS[k] ?? '#94a3b8' }))
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
                <span style={{
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

        {/* Composition */}
        {segs.length > 0 && (
          <div className="cn-card" style={{ padding: '14px 16px' }}>
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
              {txLoading && (
                <p style={{ color: 'var(--c-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                  {isVi ? 'Đang tải…' : 'Loading…'}
                </p>
              )}
              {!txLoading && visibleInvRows.length === 0 && (
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
                        ? `${inv.units.toLocaleString('vi-VN')} ${isVi ? 'phần' : 'units'}`
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
                          background: Number(calcAmount) === preset ? 'var(--c-navy)' : 'var(--c-card-2)',
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
                    {isVi ? `Sau ${monthsToGoal} tháng` : `In ${monthsToGoal} months`}
                    {goal.targetDate && monthsToGoal != null && (isOnTrack
                      ? (isVi ? ` · ${monthsLeft - monthsToGoal} tháng sớm hơn` : ` · ${monthsLeft - monthsToGoal} months early`)
                      : (isVi ? ` · ${monthsToGoal - monthsLeft} tháng trễ hạn` : ` · ${monthsToGoal - monthsLeft} months late`)
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
              {txLoading && (
                <p style={{ color: 'var(--c-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                  {isVi ? 'Đang tải…' : 'Loading…'}
                </p>
              )}
              {!txLoading && transactions.length === 0 && (
                <p style={{ color: 'var(--c-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                  {isVi ? 'Chưa có giao dịch nào' : 'No transactions yet'}
                </p>
              )}
              {!txLoading && transactions.map((tx, i) => {
                const isWithdraw = tx.transaction_type === 'withdrawal'
                const name = tx.fund_name ?? tx.notes ?? (isVi ? 'Khoản đầu tư' : 'Investment')
                return (
                  <div key={tx.transaction_id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '11px 16px',
                    borderBottom: i < transactions.length - 1 ? '1px solid var(--c-line)' : 'none',
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                      background: isWithdraw ? 'var(--c-neg-tint)' : 'var(--c-pos-tint)',
                      color: isWithdraw ? 'var(--c-neg)' : 'var(--c-pos)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isWithdraw
                        ? <ArrowDownRight size={13} strokeWidth={2.2} />
                        : <ArrowUpRight size={13} strokeWidth={2.2} />
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                      <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 1 }}>
                        {new Date(tx.investment_date).toLocaleDateString(isVi ? 'vi-VN' : 'en-US')}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: isWithdraw ? 'var(--c-neg)' : 'var(--c-pos)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {isWithdraw ? '-' : '+'}{fmtCompact(tx.amount_vnd)}
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
          onClose={() => { setShowInvOptions(false) }}
          onHistory={() => { setShowInvOptions(false); setTab('history') }}
          onSell={() => { setShowInvOptions(false); setTimeout(() => setShowSell(true), 80) }}
          onUnassign={() => { setShowInvOptions(false); setTimeout(() => setShowUnassignConfirm(true), 80) }}
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
function InvOptionsModal({ inv, isVi, onClose, onHistory, onSell, onUnassign }: {
  inv: InvRow; isVi: boolean
  onClose: () => void; onHistory: () => void; onSell: () => void; onUnassign: () => void
}) {
  const isBank = inv.type === 'bank'
  const typeColor = GD_COLORS[inv.type] ?? 'var(--c-muted)'

  const actions = [
    {
      icon: <CalendarDays size={18} color="var(--c-muted)" />,
      bg: 'var(--c-card-2)',
      label: isVi ? 'Lịch sử giao dịch' : 'Transaction history',
      sub: isVi ? 'Xem các lần mua / bán trước đây' : 'View past buys & sells',
      onClick: onHistory,
    },
    {
      icon: isBank
        ? <ArrowDownRight size={18} color="var(--c-neg)" />
        : <ArrowDownRight size={18} color="var(--c-neg)" />,
      bg: 'var(--c-neg-tint)',
      label: isBank ? (isVi ? 'Rút tiền' : 'Withdraw') : (isVi ? 'Bán' : 'Sell'),
      sub: isBank
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
function SellModal({ inv, isVi, onClose, onSuccess }: {
  inv: InvRow; isVi: boolean; onClose: () => void; onSuccess: () => void
}) {
  const [amount, setAmount] = useState('')
  const [units, setUnits] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [soldAmount, setSoldAmount] = useState(0)

  const isFund = inv.type === 'fund'
  const isGold = inv.type === 'gold'
  const isBank = inv.type === 'bank'
  const navPerUnit = isFund
    ? (inv.fund?.currentNAV ?? null)
    : (inv.units && inv.units > 0 ? inv.value / inv.units : null)
  const maxAmount = inv.value
  const numAmount = Number(amount) || 0
  const isOverMax = numAmount > maxAmount && maxAmount > 0
  const isValid = numAmount > 0 && !isOverMax && !saving
  const remaining = maxAmount - numAmount

  const gainLoss = useMemo(() => {
    if (!numAmount || inv.gainPct == null) return null
    return numAmount * inv.gainPct / (100 + inv.gainPct)
  }, [numAmount, inv.gainPct])

  const penaltyAmount = useMemo(() => {
    if (!isBank || !numAmount || !inv.interestRate) return null
    return Math.round(numAmount * (inv.interestRate / 100) * 0.5)
  }, [isBank, numAmount, inv.interestRate])

  const taxAmount = useMemo(() => {
    if (!isFund || !numAmount) return null
    return Math.round(numAmount * 0.001)
  }, [isFund, numAmount])

  function handleAmountChange(val: string) {
    const raw = val.replace(/[^0-9]/g, '')
    setAmount(raw)
    if (navPerUnit && raw) setUnits((Number(raw) / navPerUnit).toFixed(2))
    else setUnits('')
  }

  function handleUnitsChange(val: string) {
    setUnits(val)
    if (navPerUnit && val) setAmount(Math.round(Number(val) * navPerUnit).toString())
    else setAmount('')
  }

  function handleSetAll() {
    setAmount(String(maxAmount))
    if (navPerUnit && inv.units != null) setUnits(inv.units.toFixed(2))
  }

  async function handleConfirm() {
    if (!isValid) return
    setSaving(true); setError('')
    try {
      const today = new Date().toISOString().slice(0, 10)
      if (isFund && inv.fund) {
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
            principal_withdrawn: principalWithdrawn, goal_id: null,
          }),
        })
        if (!res.ok) { const { error: e } = await res.json(); setError(e ?? (isVi ? 'Không thể xử lý' : 'Could not process')); setSaving(false); return }
      } else {
        const body: Record<string, unknown> = {
          transaction_type: 'withdrawal', asset_type: inv.type,
          parent_transaction_id: inv.id, investment_date: today,
          amount_vnd: Math.round(numAmount), principal_withdrawn: Math.round(numAmount), goal_id: null,
        }
        if (isGold && units && navPerUnit) body.units_withdrawn = parseFloat(units)
        const res = await fetch('/api/v1/investment-transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) { const { error: e } = await res.json(); setError(e ?? (isVi ? 'Không thể xử lý' : 'Could not process')); setSaving(false); return }
      }
      setSoldAmount(numAmount); setConfirmed(true)
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
                {inv.units != null && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{inv.units.toLocaleString('vi-VN')} {isVi ? 'phần' : 'units'}</span>}
                {isBank && inv.interestRate && <span>{inv.interestRate}%/yr</span>}
              </div>
            </div>
          </div>

          {/* Amount input */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              {isBank ? (isVi ? 'Số tiền muốn rút' : 'Amount to withdraw') : (isVi ? 'Số tiền muốn bán' : 'Amount to sell')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: `1.5px solid ${isOverMax ? 'var(--c-neg)' : 'var(--c-navy)'}`, borderRadius: 10 }}>
                <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                <input
                  autoFocus
                  type="text" inputMode="numeric"
                  value={amount ? Number(amount).toLocaleString('vi-VN') : ''}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  placeholder="0"
                  style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: isOverMax ? 'var(--c-neg)' : 'var(--c-ink)' }}
                />
              </div>
              <button onClick={handleSetAll} style={{ padding: '8px 14px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
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

          {/* Summary strip */}
          {numAmount > 0 && !isOverMax && (() => {
            const rows = [
              { show: true, label: isVi ? 'Còn lại sau giao dịch' : 'Remaining after transaction', value: fmtCompact(Math.max(0, remaining)), color: 'var(--c-ink)' },
              { show: gainLoss != null, label: isVi ? 'Lãi/Lỗ ước tính' : 'Est. gain / loss', value: `${gainLoss! >= 0 ? '+' : ''}${fmtCompact(gainLoss!)}`, color: gainLoss! >= 0 ? 'var(--c-pos)' : 'var(--c-neg)' },
              { show: penaltyAmount != null, label: isVi ? 'Lãi mất ước tính' : 'Est. interest forfeited', value: `−${fmtCompact(penaltyAmount!)}`, color: 'var(--c-warn)' },
              { show: taxAmount != null, label: isVi ? 'Thuế TNCN (0.1%)' : 'Personal income tax (0.1%)', value: `−${fmtCompact(taxAmount!)}`, color: 'var(--c-muted)' },
            ].filter((r) => r.show)
            return (
              <div style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
                {rows.map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: i < rows.length - 1 ? '1px solid var(--c-line)' : 'none' }}>
                    <span style={{ fontSize: 12, color: r.color === 'var(--c-warn)' ? 'var(--c-warn)' : 'var(--c-muted)' }}>{r.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: r.color, fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
                  </div>
                ))}
              </div>
            )
          })()}

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
            <button onClick={isValid ? handleConfirm : undefined} disabled={!isValid} style={{
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
              {numAmount <= 0
                ? (isVi ? (isBank ? 'Nhập số tiền rút' : 'Nhập số tiền bán') : (isBank ? 'Enter withdrawal amount' : 'Enter sale amount'))
                : isOverMax ? (isVi ? 'Vượt quá số dư' : 'Exceeds balance')
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
              {monthsTo} {isVi ? 'tháng' : 'months'}
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
