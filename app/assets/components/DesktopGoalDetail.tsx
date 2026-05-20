'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft, TrendingUp, Building, CircleDollarSign, BarChart2, MoreHorizontal, Edit2, Trash2, ChevronRight, Calendar, Download, ArrowDownRight, Target } from 'lucide-react'
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

export default function DesktopGoalDetail({ goal, locale, onClose, onDataChanged }: Props) {
  const isVi = locale === 'vi'
  const [tab, setTab] = useState<'investments' | 'calculator' | 'history'>('investments')
  const [transactions, setTransactions] = useState<InvestmentTx[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [calcAmount, setCalcAmount] = useState('')

  useEffect(() => {
    setTxLoading(true)
    setTab('investments')
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
      if (res.ok) { onDataChanged() }
    } finally {
      setIsDeleting(false)
      setActionsOpen(false)
    }
  }

  const isPos = goal.profitLoss >= 0
  const isComplete = (goal.progressPercentage ?? 0) >= 100
  const progress = Math.min(goal.progressPercentage ?? 0, 100)

  // Build investment rows (same logic as GoalDetailSheet)
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
    return { id: tx.transaction_id, name, type: tx.asset_type, value, gainPct, units, principal, fund: fund ?? null }
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

  return (
    <>
      <div data-testid="desktop-goal-detail" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
              {!txLoading && invRows.length === 0 && (
                <p style={{ color: 'var(--c-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                  {isVi ? 'Chưa có khoản đầu tư nào' : 'No investments yet'}
                </p>
              )}
              {!txLoading && invRows.map((inv, i) => (
                <div key={inv.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 16px',
                  borderBottom: i < invRows.length - 1 ? '1px solid var(--c-line)' : 'none',
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
                      type="number"
                      value={calcAmount}
                      onChange={(e) => setCalcAmount(e.target.value)}
                      placeholder="0"
                      style={{ width: '100%', minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', background: 'transparent', color: 'var(--c-ink)' }}
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
                        : <ChevronLeft size={13} strokeWidth={2.2} style={{ transform: 'rotate(180deg)' }} />
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

      {/* Goal actions sheet */}
      {actionsOpen && (
        <GoalActionsSheet
          open={actionsOpen}
          onClose={() => setActionsOpen(false)}
          onEdit={() => { setActionsOpen(false); setTimeout(() => setEditOpen(true), 60) }}
          onDelete={handleDelete}
          isDeleting={isDeleting}
          isVi={isVi}
        />
      )}

      {/* Edit goal sheet */}
      {editOpen && (
        <EditGoalSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          goal={goal}
          onSaved={onDataChanged}
          isVi={isVi}
        />
      )}
    </>
  )
}

function GoalActionsSheet({ open, onClose, onEdit, onDelete, isDeleting, isVi }: {
  open: boolean; onClose: () => void; onEdit: () => void; onDelete: () => void; isDeleting: boolean; isVi: boolean
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (open) setMounted(true)
    else { const t = setTimeout(() => setMounted(false), 220); return () => clearTimeout(t) }
  }, [open])
  if (!mounted) return null

  const t = isVi ? {
    edit: 'Chỉnh sửa mục tiêu', editSub: 'Thay đổi tên, số tiền hoặc ngày mục tiêu',
    delete: 'Xoá mục tiêu', deleteSub: 'Xoá mục tiêu và huỷ liên kết tất cả khoản đầu tư',
    cancel: 'Hủy',
  } : {
    edit: 'Edit goal', editSub: 'Change name, target amount or date',
    delete: 'Delete goal', deleteSub: 'Remove goal and unlink all investments',
    cancel: 'Cancel',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.2)', zIndex: 150, pointerEvents: open ? 'auto' : 'none' }} onClick={onClose}>
      <div
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'var(--c-card)', borderRadius: '16px 16px 0 0', padding: '0 0 env(safe-area-inset-bottom,0)', animation: open ? 'slide-up 220ms cubic-bezier(0.2,0.8,0.2,1)' : 'slide-down 180ms ease forwards' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px' }} />
        <div style={{ padding: '0 16px 20px', display: 'grid', gap: 10 }}>
          <button onClick={onEdit} style={{ width: '100%', textAlign: 'left', padding: '14px 16px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 14 }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-card-2)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--c-card)')}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--c-navy-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Edit2 size={20} color="var(--c-navy)" /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)' }}>{t.edit}</div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{t.editSub}</div>
            </div>
            <ChevronRight size={16} color="var(--c-muted)" />
          </button>
          <button onClick={onDelete} disabled={isDeleting} style={{ width: '100%', textAlign: 'left', padding: '14px 16px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 14, cursor: isDeleting ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 14, opacity: isDeleting ? 0.5 : 1 }} onMouseEnter={(e) => { if (!isDeleting) e.currentTarget.style.background = 'var(--c-card-2)' }} onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--c-card)')}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--c-neg-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Trash2 size={20} color="var(--c-neg)" /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-neg)' }}>{isDeleting ? (isVi ? 'Đang xoá…' : 'Deleting…') : t.delete}</div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{t.deleteSub}</div>
            </div>
            <ChevronRight size={16} color="var(--c-muted)" />
          </button>
          <button onClick={onClose} style={{ width: '100%', padding: '12px 0', borderRadius: 10, border: '1px solid var(--c-line)', background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 15, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>{t.cancel}</button>
        </div>
      </div>
    </div>
  )
}

function EditGoalSheet({ open, onClose, goal, onSaved, isVi }: {
  open: boolean; onClose: () => void; goal: GoalData; onSaved: () => void; isVi: boolean
}) {
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
    if (!name.trim()) { setError(isVi ? 'Tên mục tiêu là bắt buộc' : 'Goal name is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/v1/savings-goals/${goal.goalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_name: name.trim(), target_amount: target ? Number(target) : null }),
      })
      if (!res.ok) {
        const { error: e } = await res.json()
        setError(e ?? (isVi ? 'Không thể lưu' : 'Could not save'))
      } else { onSaved(); onClose() }
    } catch { setError(isVi ? 'Lỗi kết nối' : 'Connection error') }
    setSaving(false)
  }

  if (!mounted) return null
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.2)', zIndex: 160, pointerEvents: open ? 'auto' : 'none' }} onClick={onClose}>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'var(--c-card)', borderRadius: '16px 16px 0 0', padding: '0 0 env(safe-area-inset-bottom,0)', animation: open ? 'slide-up 220ms cubic-bezier(0.2,0.8,0.2,1)' : 'slide-down 180ms ease forwards' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px' }} />
        <div style={{ padding: '0 16px 24px' }}>
          <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, color: 'var(--c-ink)' }}>{isVi ? 'Chỉnh sửa mục tiêu' : 'Edit goal'}</p>
          {error && <p style={{ color: 'var(--c-neg)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 4 }}>{isVi ? 'Tên mục tiêu' : 'Goal name'}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid var(--c-line)', borderRadius: 10, background: 'var(--c-card-2)', color: 'var(--c-ink)', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 4 }}>{isVi ? 'Mục tiêu (không bắt buộc)' : 'Target amount (optional)'}</label>
            <input type="text" inputMode="numeric" value={target ? Number(target).toLocaleString('en-US') : ''} onChange={(e) => setTarget(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))} placeholder="0" style={{ width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid var(--c-line)', borderRadius: 10, background: 'var(--c-card-2)', color: 'var(--c-ink)', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid var(--c-line)', background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>{isVi ? 'Huỷ' : 'Cancel'}</button>
            <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: 'none', background: 'var(--c-navy)', color: '#fff', fontSize: 15, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'inherit' }}>
              {saving ? (isVi ? 'Đang lưu…' : 'Saving…') : (isVi ? 'Lưu' : 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
