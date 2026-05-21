'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, ChevronRight, Target, Building, CircleDollarSign, TrendingUp, BarChart2, Clock, ArrowDownToLine, ArrowDownRight, ArrowRight, Wallet, Check, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useLocale } from 'next-intl'
import type { FundBreakdownItem, NonFundUnallocatedItem } from '../DashboardClient'
import { fmtCompact, fmtNav, fmtPct } from '@/lib/formatters'

function DesktopAssignPicker({
  item, goals, loading, selected, onSelect, confirming, error, success, successName,
  isVI, onBack, onConfirm, actionName, actionValue, actionType,
}: {
  item: { kind: 'fund' | 'nonFund' }
  goals: GoalOption[]
  loading: boolean
  selected: string | null
  onSelect: (id: string) => void
  confirming: boolean
  error: string
  success: boolean
  successName: string
  isVI: boolean
  onBack: () => void
  onConfirm: () => void
  actionName: string
  actionValue: number
  actionType: string
}) {
  const ItemIcon = { fund: TrendingUp, bank: Building, gold: CircleDollarSign, stock: BarChart2 }[actionType] ?? TrendingUp
  const selectedGoal = goals.find((g) => g.id === selected)

  if (success) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 0', textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--c-pos-tint)', color: 'var(--c-pos)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <Check size={28} strokeWidth={2.5} />
      </div>
      <p style={{ fontWeight: 600, fontSize: 15, color: 'var(--c-ink)', margin: '0 0 4px' }}>
        {isVI ? 'Đã gán vào' : 'Assigned to'}
      </p>
      <p style={{ fontSize: 13, color: 'var(--c-navy)', fontWeight: 600, margin: 0 }}>{successName}</p>
    </div>
  )

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Item chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--c-card-2)', borderRadius: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--c-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-navy)', border: '1px solid var(--c-line)', flexShrink: 0 }}>
          <ItemIcon size={15} strokeWidth={1.8} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-ink)' }}>{actionName}</div>
          <div style={{ fontSize: 11, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(actionValue)}</div>
        </div>
        <ArrowRight size={14} color="var(--c-muted)" />
        <div style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', background: selectedGoal ? 'var(--c-navy-tint)' : 'var(--c-line)', color: selectedGoal ? 'var(--c-navy)' : 'var(--c-muted)', borderRadius: 8, whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selectedGoal ? selectedGoal.name : (isVI ? 'Chọn...' : 'Choose…')}
        </div>
      </div>

      {error && <p style={{ fontSize: 13, color: 'var(--c-neg)', margin: 0 }}>{error}</p>}

      {/* Goal list */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          {isVI ? 'Chọn mục tiêu' : 'Choose a goal'}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {loading && <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0', margin: 0 }}>{isVI ? 'Đang tải…' : 'Loading…'}</p>}
          {!loading && goals.length === 0 && <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0', margin: 0 }}>{isVI ? 'Chưa có mục tiêu nào' : 'No goals yet'}</p>}
          {!loading && goals.map((g) => {
            const isSel = selected === g.id
            const isComplete = g.progressPercent != null && g.progressPercent >= 100
            const remaining = g.targetAmount != null ? Math.max(0, g.targetAmount - g.currentValue) : null
            return (
              <button key={g.id} onClick={() => onSelect(g.id)} style={{ width: '100%', textAlign: 'left', padding: '12px 14px', background: isSel ? 'var(--c-navy-tint)' : 'var(--c-card)', border: `1.5px solid ${isSel ? 'var(--c-navy)' : 'var(--c-line)'}`, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color 120ms, background 120ms' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isSel ? 'var(--c-navy)' : 'var(--c-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                      {isComplete ? (isVI ? 'Đã hoàn thành' : 'Completed') : remaining != null ? `${fmtCompact(remaining)} ${isVI ? 'còn lại' : 'remaining'}` : fmtCompact(g.currentValue)}
                    </div>
                  </div>
                  {g.progressPercent != null && <div style={{ fontSize: 12, fontWeight: 600, color: isSel ? 'var(--c-navy)' : 'var(--c-ink)', flexShrink: 0 }}>{Math.round(g.progressPercent)}%</div>}
                  {isSel && <div style={{ width: 20, height: 20, borderRadius: 10, background: 'var(--c-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Check size={12} strokeWidth={2.5} color="#fff" /></div>}
                </div>
                {g.progressPercent != null && (
                  <div style={{ height: 4, background: 'var(--c-card-2)', borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
                    <div style={{ height: '100%', borderRadius: 999, width: `${Math.min(100, Math.max(0, g.progressPercent))}%`, background: isComplete ? 'var(--c-pos)' : 'var(--c-navy)' }} />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={onBack} className="cn-btn" style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }}>
          {isVI ? 'Quay lại' : 'Back'}
        </button>
        <button onClick={onConfirm} disabled={!selected || confirming} className={selected && !confirming ? 'cn-btn primary' : 'cn-btn'} style={{ flex: 2, justifyContent: 'center', opacity: !selected || confirming ? 0.5 : 1 }}>
          {confirming ? (isVI ? 'Đang xử lý…' : 'Assigning…') : <><Check size={14} strokeWidth={2.4} />{isVI ? 'Xác nhận gán' : 'Confirm assignment'}</>}
        </button>
      </div>
    </div>
  )
}

interface GoalOption {
  id: string
  name: string
  currentValue: number
  targetAmount: number | null
  progressPercent: number | null
}

const TYPE_ICON: Record<string, React.ElementType> = {
  fund:  TrendingUp,
  bank:  Building,
  gold:  CircleDollarSign,
  stock: BarChart2,
}
const TYPE_COLOR: Record<string, string> = {
  fund:  '#2563eb',
  bank:  '#047857',
  gold:  '#d97706',
  stock: '#7c3aed',
}

type ActionTarget =
  | { kind: 'fund'; fund: FundBreakdownItem }
  | { kind: 'nonFund'; item: NonFundUnallocatedItem }

interface Props {
  unallocatedAmount: number
  funds: FundBreakdownItem[]
  nonFunds: NonFundUnallocatedItem[]
  onFundClick: (fundId: string) => void
  onAssignToGoal: (fundId: string, name: string, value: number, type: string) => void
  onSellFund: (fund: FundBreakdownItem) => void
  onAssignNonFundToGoal: (transactionId: string, name: string, value: number, type: string) => void
  onSellNonFund: (item: NonFundUnallocatedItem) => void
  /** Desktop-only: called when user confirms assignment in the inline two-step modal */
  onDesktopAssign?: (kind: 'fund' | 'nonFund', id: string, goalId: string) => Promise<void>
  desktopCard?: boolean
}

export default function UnallocatedSection({
  unallocatedAmount, funds, nonFunds,
  onFundClick, onAssignToGoal, onSellFund,
  onAssignNonFundToGoal, onSellNonFund,
  onDesktopAssign,
  desktopCard = false,
}: Props) {
  const t = useTranslations('dashboard')
  const tt = useTranslations('transactions')
  const tg = useTranslations('goals')
  const isVI = useLocale() === 'vi'
  const [open, setOpen] = useState(true)
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null)

  // Desktop two-step assign flow
  const [desktopStep, setDesktopStep] = useState<'actions' | 'assign'>('actions')
  const [assignGoals, setAssignGoals] = useState<GoalOption[]>([])
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignSelected, setAssignSelected] = useState<string | null>(null)
  const [assignConfirming, setAssignConfirming] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [assignSuccess, setAssignSuccess] = useState(false)
  const [assignSuccessName, setAssignSuccessName] = useState('')

  const typeLabelMap: Record<string, string> = {
    fund:  tt('assetFund'),
    bank:  tt('assetBank'),
    gold:  tt('assetGold'),
    stock: tt('assetStock'),
  }

  const totalItems = funds.length + nonFunds.length

  function closeAction() {
    setActionTarget(null)
    setDesktopStep('actions')
    setAssignSelected(null)
    setAssignError('')
    setAssignSuccess(false)
  }

  function startDesktopAssign() {
    setDesktopStep('assign')
    setAssignLoading(true)
    setAssignSelected(null)
    setAssignError('')
    setAssignSuccess(false)
    fetch('/api/v1/savings-goals?stats=true')
      .then((r) => r.ok ? r.json() : { goals: [] })
      .then((res: { goals?: Array<{ goal_id: string; goal_name: string; current_value?: number; target_amount?: number | null; progress_percentage?: number | null }> }) => {
        const rows = res.goals ?? []
        setAssignGoals(rows.map((g) => ({
          id: g.goal_id,
          name: g.goal_name,
          currentValue: g.current_value ?? 0,
          targetAmount: g.target_amount ?? null,
          progressPercent: g.progress_percentage ?? null,
        })))
      })
      .catch(() => setAssignGoals([]))
      .finally(() => setAssignLoading(false))
  }

  async function handleDesktopAssignConfirm() {
    if (!assignSelected || !actionTarget || !onDesktopAssign) return
    setAssignConfirming(true)
    setAssignError('')
    try {
      const kind = actionTarget.kind === 'fund' ? 'fund' as const : 'nonFund' as const
      const id = actionTarget.kind === 'fund' ? actionTarget.fund.fundId : actionTarget.item.transactionId
      await onDesktopAssign(kind, id, assignSelected)
      const goalName = assignGoals.find((g) => g.id === assignSelected)?.name ?? ''
      setAssignSuccessName(goalName)
      setAssignSuccess(true)
      setTimeout(() => closeAction(), 1500)
    } catch (e: unknown) {
      setAssignError(e instanceof Error ? e.message : (isVI ? 'Lỗi kết nối' : 'Connection error'))
    }
    setAssignConfirming(false)
  }

  const canSell = actionTarget?.kind === 'fund' || (
    actionTarget?.kind === 'nonFund' && (actionTarget.item.type === 'bank' || actionTarget.item.type === 'gold')
  )

  const actionName = actionTarget?.kind === 'fund'
    ? actionTarget.fund.fundName
    : (actionTarget?.item.notes || (actionTarget ? new Date(actionTarget.item.investmentDate).toLocaleDateString('vi-VN') : ''))

  const actionValue = actionTarget?.kind === 'fund'
    ? actionTarget.fund.currentValue
    : actionTarget?.item.currentValue ?? 0

  const actionGainPct = actionTarget?.kind === 'fund'
    ? actionTarget.fund.profitLossPercentage
    : actionTarget?.kind === 'nonFund'
      ? actionTarget.item.amount > 0 ? ((actionTarget.item.currentValue - actionTarget.item.amount) / actionTarget.item.amount) * 100 : null
      : null

  const actionType = actionTarget?.kind === 'fund' ? 'fund' : actionTarget?.kind === 'nonFund' ? actionTarget.item.type : 'fund'
  const ActionIcon = TYPE_ICON[actionType] ?? TrendingUp
  const actionColor = TYPE_COLOR[actionType] ?? '#94a3b8'

  const isBank = actionTarget?.kind === 'nonFund' && actionTarget.item.type === 'bank'
  const SellIcon = isBank ? ArrowDownToLine : ArrowDownRight

  // Shared rows renderer — padding differs between mobile and desktop
  function renderRows(rowPadding: string) {
    return (
      <>
        {funds.map((fund, i) => {
          const plPositive = fund.profitLoss >= 0
          const isLast = i === funds.length - 1 && nonFunds.length === 0
          return (
            <button
              key={fund.fundId}
              data-testid="unallocated-row"
              onClick={() => setActionTarget({ kind: 'fund', fund })}
              onMouseEnter={desktopCard ? (e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-card-2)' } : undefined}
              onMouseLeave={desktopCard ? (e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' } : undefined}
              style={{
                width: '100%', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 12,
                padding: rowPadding,
                background: 'transparent', border: 'none',
                borderBottom: isLast ? 'none' : '1px solid var(--c-line)',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: desktopCard ? 'background 120ms' : undefined,
              }}
            >
              <div style={{
                width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                background: 'var(--c-card-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: TYPE_COLOR.fund,
              }}>
                <TrendingUp size={14} />
              </div>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fund.fundName}
                </div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {fund.quantity.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {tt('unitsDefault')} · NAV {fmtNav(fund.currentNAV)}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(fund.currentValue)}</div>
                <div style={{ fontSize: 11, marginTop: 1, fontVariantNumeric: 'tabular-nums', color: plPositive ? 'var(--c-pos)' : 'var(--c-neg)' }}>
                  {fmtPct(fund.profitLossPercentage)}
                </div>
              </div>
              <ChevronRight size={14} color="var(--c-muted-2)" style={{ flexShrink: 0 }} />
            </button>
          )
        })}

        {nonFunds.map((item, i) => {
          const pl = item.currentValue - item.amount
          const plPct = item.amount > 0 ? (pl / item.amount) * 100 : 0
          const plPositive = pl >= 0
          const Icon = TYPE_ICON[item.type] ?? Building
          const color = TYPE_COLOR[item.type] ?? 'var(--c-muted)'
          const typeLabel = typeLabelMap[item.type] ?? item.type
          const isLast = i === nonFunds.length - 1
          return (
            <button
              key={item.transactionId}
              data-testid="unallocated-row"
              onClick={() => setActionTarget({ kind: 'nonFund', item })}
              onMouseEnter={desktopCard ? (e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-card-2)' } : undefined}
              onMouseLeave={desktopCard ? (e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' } : undefined}
              style={{
                width: '100%', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 12,
                padding: rowPadding,
                background: 'transparent', border: 'none',
                borderBottom: isLast ? 'none' : '1px solid var(--c-line)',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: desktopCard ? 'background 120ms' : undefined,
              }}
            >
              <div style={{
                width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                background: 'var(--c-card-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color,
              }}>
                <Icon size={14} />
              </div>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.notes || new Date(item.investmentDate).toLocaleDateString('vi-VN')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {typeLabel}
                  {item.interestRate != null && ` · ${item.interestRate}%/yr`}
                  {item.type === 'gold' && item.units != null && ` · ${item.units.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} chi`}
                  {item.expiryDate && ` · ${t('expiry')} ${new Date(item.expiryDate).toLocaleDateString('vi-VN')}`}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(item.currentValue)}</div>
                <div style={{ fontSize: 11, marginTop: 1, fontVariantNumeric: 'tabular-nums', color: plPositive ? 'var(--c-pos)' : 'var(--c-neg)' }}>
                  {fmtPct(plPct)}
                </div>
              </div>
              <ChevronRight size={14} color="var(--c-muted-2)" style={{ flexShrink: 0 }} />
            </button>
          )
        })}
      </>
    )
  }

  // Shared action popup content
  const actionPopupContent = actionTarget && (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px',
        background: 'var(--c-card-2)', borderRadius: 12,
        marginBottom: 12,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: 'var(--c-card)', border: '1px solid var(--c-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: actionColor,
        }}>
          <ActionIcon size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {actionName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(actionValue)}</span>
            {actionGainPct != null && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 999, fontWeight: 500,
                background: actionGainPct >= 0 ? 'var(--c-pos-tint)' : 'var(--c-neg-tint)',
                color: actionGainPct >= 0 ? 'var(--c-pos)' : 'var(--c-neg)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {fmtPct(actionGainPct)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <button
          data-testid="action-assign"
          onClick={() => {
            if (desktopCard && onDesktopAssign) {
              startDesktopAssign()
            } else {
              closeAction()
              if (actionTarget.kind === 'fund') {
                const f = actionTarget.fund
                onAssignToGoal(f.fundId, f.fundName, f.currentValue, 'fund')
              } else {
                const it = actionTarget.item
                const name = it.notes || typeLabelMap[it.type] || it.type
                onAssignNonFundToGoal(it.transactionId, name, it.currentValue, it.type)
              }
            }
          }}
          style={{
            width: '100%', textAlign: 'left', padding: '14px 16px',
            background: 'var(--c-card)', border: '1px solid var(--c-line)',
            borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 14, transition: 'background 120ms',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-card-2)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-card)' }}
        >
          <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: 'var(--c-navy-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-navy)' }}>
            <Target size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)' }}>{t('assignToGoal')}</div>
            <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{t('assignToGoalSub')}</div>
          </div>
          <ChevronRight size={16} color="var(--c-muted)" />
        </button>

        {canSell && (
          <button
            data-testid="action-sell"
            onClick={() => {
              closeAction()
              if (actionTarget.kind === 'fund') onSellFund(actionTarget.fund)
              else onSellNonFund(actionTarget.item)
            }}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 16px',
              background: 'var(--c-card)', border: '1px solid var(--c-line)',
              borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 14, transition: 'background 120ms',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-card-2)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-card)' }}
          >
            <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: 'var(--c-neg-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-neg)' }}>
              <SellIcon size={20} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)' }}>{isBank ? tg('withdraw') : tg('sell')}</div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{isBank ? t('actionWithdrawSub') : t('actionSellSub')}</div>
            </div>
            <ChevronRight size={16} color="var(--c-muted)" />
          </button>
        )}

        {actionTarget.kind === 'fund' && (
          <button
            data-testid="action-history"
            onClick={() => { closeAction(); onFundClick(actionTarget.fund.fundId) }}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 16px',
              background: 'var(--c-card)', border: '1px solid var(--c-line)',
              borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 14, transition: 'background 120ms',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-card-2)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-card)' }}
          >
            <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: 'var(--c-card-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-muted)' }}>
              <Clock size={20} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)' }}>{t('actionHistory')}</div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{t('actionHistorySub')}</div>
            </div>
            <ChevronRight size={16} color="var(--c-muted)" />
          </button>
        )}
      </div>
    </>
  )

  if (desktopCard) {
    return (
      <>
        <div className="cn-card" style={{ overflow: 'hidden' }}>
          <button
            data-testid="unallocated-card-header"
            onClick={() => setOpen((o) => !o)}
            style={{
              width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
              padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'var(--c-card-2)', color: 'var(--c-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Wallet size={15} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                {t('sectionUnallocated')}
                <span style={{
                  fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 999,
                  background: 'var(--c-card-2)', color: 'var(--c-muted)',
                }}>
                  {totalItems}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                {fmtCompact(unallocatedAmount)} {t('availableToAssign')}
              </div>
            </div>
            {open
              ? <ChevronUp size={16} color="var(--c-muted)" />
              : <ChevronDown size={16} color="var(--c-muted)" />
            }
          </button>

          {open && (
            <div style={{ borderTop: '1px solid var(--c-line)' }}>
              {renderRows('12px 16px')}
            </div>
          )}
        </div>

        {/* Desktop: centered modal overlay */}
        {actionTarget && (
          <div
            data-testid="action-sheet"
            onClick={closeAction}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(15, 23, 42, 0.4)',
              zIndex: 300,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 24,
              animation: 'fade-in 150ms ease',
              backdropFilter: 'blur(2px)',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: 460, maxHeight: 'calc(100vh - 48px)',
                background: 'var(--c-card)',
                borderRadius: 16,
                boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)',
                display: 'flex', flexDirection: 'column',
                animation: 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)',
                overflow: 'hidden',
              }}
            >
              {/* Modal header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid var(--c-line)', flexShrink: 0 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
                  {desktopStep === 'assign' ? (isVI ? 'Gán vào mục tiêu' : 'Assign to goal') : (isVI ? 'Tùy chọn' : 'Options')}
                </h3>
                <button onClick={closeAction} aria-label="Close" style={{ padding: 6, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)', display: 'flex' }}>
                  <X size={18} />
                </button>
              </div>

              {/* Modal body */}
              <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto' }}>
                {desktopStep === 'assign' ? (
                  <DesktopAssignPicker
                    item={actionTarget}
                    goals={assignGoals}
                    loading={assignLoading}
                    selected={assignSelected}
                    onSelect={setAssignSelected}
                    confirming={assignConfirming}
                    error={assignError}
                    success={assignSuccess}
                    successName={assignSuccessName}
                    isVI={isVI}
                    onBack={() => setDesktopStep('actions')}
                    onConfirm={handleDesktopAssignConfirm}
                    actionName={actionName}
                    actionValue={actionValue}
                    actionType={actionType}
                  />
                ) : actionPopupContent}
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <section>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            width: '100%', textAlign: 'left',
            background: 'transparent', border: 'none', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', marginBottom: 8, fontFamily: 'inherit',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
              {t('sectionUnallocated')}
              <span style={{
                display: 'inline-flex', alignItems: 'center',
                fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 999,
                background: 'var(--c-card-2)', color: 'var(--c-muted)',
                marginLeft: 8, verticalAlign: 'middle',
              }}>
                {totalItems}
              </span>
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--c-muted)' }}>
              {fmtCompact(unallocatedAmount)} {t('availableToAssign')}
            </p>
          </div>
          {open
            ? <ChevronUp size={18} color="var(--c-muted)" />
            : <ChevronDown size={18} color="var(--c-muted)" />
          }
        </button>

        {open && (
          <div style={{
            background: 'var(--c-card)',
            border: '1px solid var(--c-line)',
            borderRadius: 'var(--r-card)',
            boxShadow: 'var(--shadow-card)',
            overflow: 'hidden',
            padding: '4px 14px',
          }}>
            {renderRows('12px 0')}
          </div>
        )}
      </section>

      {/* Mobile: bottom sheet overlay */}
      {actionTarget && (
        <div
          data-testid="action-sheet"
          onClick={closeAction}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15, 23, 42, 0.2)',
            zIndex: 300,
            display: 'flex', alignItems: 'flex-end',
            animation: 'fade-in 180ms ease',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              background: 'var(--c-card)',
              borderRadius: '20px 20px 0 0',
              padding: '12px 16px calc(env(safe-area-inset-bottom) + 20px)',
              animation: 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
              boxShadow: '0 -8px 24px rgba(0,0,0,0.08)',
            }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--c-line)', margin: '0 auto 16px' }} />
            {actionPopupContent}
          </div>
        </div>
      )}
    </>
  )
}
