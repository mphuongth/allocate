'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, ChevronRight, Target, Building, CircleDollarSign, TrendingUp, BarChart2, Clock, ArrowDownToLine, ArrowDownRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { FundBreakdownItem, NonFundUnallocatedItem } from '../DashboardClient'
import { fmtCompact, fmtNav, fmtPct } from '@/lib/formatters'

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
  onAssignToGoal: (fundId: string) => void
  onSellFund: (fund: FundBreakdownItem) => void
  onAssignNonFundToGoal: (transactionId: string) => void
  onSellNonFund: (item: NonFundUnallocatedItem) => void
}

export default function UnallocatedSection({
  unallocatedAmount, funds, nonFunds,
  onFundClick, onAssignToGoal, onSellFund,
  onAssignNonFundToGoal, onSellNonFund,
}: Props) {
  const t = useTranslations('dashboard')
  const tt = useTranslations('transactions')
  const tg = useTranslations('goals')
  const [open, setOpen] = useState(true)
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null)

  const typeLabelMap: Record<string, string> = {
    fund:  tt('assetFund'),
    bank:  tt('assetBank'),
    gold:  tt('assetGold'),
    stock: tt('assetStock'),
  }

  const totalItems = funds.length + nonFunds.length

  function closeAction() { setActionTarget(null) }

  const canSell = actionTarget?.kind === 'fund' || (
    actionTarget?.kind === 'nonFund' && (actionTarget.item.type === 'bank' || actionTarget.item.type === 'gold')
  )

  // Derive display info for the tapped item
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

  return (
    <>
      <section>
        {/* Collapsible toggle header */}
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

        {/* Collapsible body */}
        {open && (
          <div style={{
            background: 'var(--c-card)',
            border: '1px solid var(--c-line)',
            borderRadius: 'var(--r-card)',
            boxShadow: 'var(--shadow-card)',
            overflow: 'hidden',
            padding: '4px 14px',
          }}>
            {/* Fund rows */}
            {funds.map((fund) => {
              const plPositive = fund.profitLoss >= 0
              return (
                <button
                  key={fund.fundId}
                  data-testid="unallocated-row"
                  onClick={() => setActionTarget({ kind: 'fund', fund })}
                  style={{
                    width: '100%', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 0',
                    background: 'transparent', border: 'none',
                    borderBottom: '1px solid var(--c-line)',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: 'var(--c-card-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: TYPE_COLOR.fund,
                  }}>
                    <TrendingUp size={16} />
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
                    <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtCompact(fund.currentValue)}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 1, fontVariantNumeric: 'tabular-nums', color: plPositive ? 'var(--c-pos)' : 'var(--c-neg)' }}>
                      {fmtPct(fund.profitLossPercentage)}
                    </div>
                  </div>
                  <ChevronRight size={16} color="var(--c-muted)" style={{ flexShrink: 0 }} />
                </button>
              )
            })}

            {/* Non-fund rows */}
            {nonFunds.map((item) => {
              const pl = item.currentValue - item.amount
              const plPct = item.amount > 0 ? (pl / item.amount) * 100 : 0
              const plPositive = pl >= 0
              const Icon = TYPE_ICON[item.type] ?? Building
              const color = TYPE_COLOR[item.type] ?? 'var(--c-muted)'
              const typeLabel = typeLabelMap[item.type] ?? item.type
              return (
                <button
                  key={item.transactionId}
                  data-testid="unallocated-row"
                  onClick={() => setActionTarget({ kind: 'nonFund', item })}
                  style={{
                    width: '100%', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 0',
                    background: 'transparent', border: 'none',
                    borderBottom: '1px solid var(--c-line)',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: 'var(--c-card-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color,
                  }}>
                    <Icon size={16} />
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
                    <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtCompact(item.currentValue)}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 1, fontVariantNumeric: 'tabular-nums', color: plPositive ? 'var(--c-pos)' : 'var(--c-neg)' }}>
                      {fmtPct(plPct)}
                    </div>
                  </div>
                  <ChevronRight size={16} color="var(--c-muted)" style={{ flexShrink: 0 }} />
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Action sheet overlay */}
      {actionTarget && (
        <div
          data-testid="action-sheet"
          onClick={closeAction}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            zIndex: 300,
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              background: 'var(--c-card)',
              borderRadius: '20px 20px 0 0',
              padding: '12px 16px calc(env(safe-area-inset-bottom) + 20px)',
            }}
          >
            {/* Handle */}
            <div style={{
              width: 36, height: 4, borderRadius: 2,
              background: 'var(--c-line)', margin: '0 auto 16px',
            }} />

            {/* Item summary card */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px',
              background: 'var(--c-card-2)', borderRadius: 12,
              marginBottom: 12,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: 'var(--c-card)',
                border: '1px solid var(--c-line)',
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
                  <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtCompact(actionValue)}
                  </span>
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

            {/* Actions */}
            <div style={{ display: 'grid', gap: 12 }}>
              {/* Assign to Goal */}
              <button
                data-testid="action-assign"
                onClick={() => {
                  closeAction()
                  if (actionTarget.kind === 'fund') onAssignToGoal(actionTarget.fund.fundId)
                  else onAssignNonFundToGoal(actionTarget.item.transactionId)
                }}
                style={{
                  width: '100%', textAlign: 'left', padding: '14px 16px',
                  background: 'var(--c-card)', border: '1px solid var(--c-line)',
                  borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}
              >
                <div style={{
                  width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                  background: 'var(--c-navy-tint)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--c-navy)',
                }}>
                  <Target size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)' }}>{t('assignToGoal')}</div>
                  <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{t('assignToGoalSub')}</div>
                </div>
                <ChevronRight size={16} color="var(--c-muted)" />
              </button>

              {/* Sell / Withdraw */}
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
                    display: 'flex', alignItems: 'center', gap: 14,
                  }}
                >
                  <div style={{
                    width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                    background: 'var(--c-neg-tint)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--c-neg)',
                  }}>
                    <SellIcon size={20} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)' }}>
                      {isBank ? tg('withdraw') : tg('sell')}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>
                      {isBank ? t('actionWithdrawSub') : t('actionSellSub')}
                    </div>
                  </div>
                  <ChevronRight size={16} color="var(--c-muted)" />
                </button>
              )}

              {/* Transaction History (fund only) */}
              {actionTarget.kind === 'fund' && (
                <button
                  data-testid="action-history"
                  onClick={() => {
                    closeAction()
                    onFundClick(actionTarget.fund.fundId)
                  }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '14px 16px',
                    background: 'var(--c-card)', border: '1px solid var(--c-line)',
                    borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', gap: 14,
                  }}
                >
                  <div style={{
                    width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                    background: 'var(--c-card-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--c-muted)',
                  }}>
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
          </div>
        </div>
      )}
    </>
  )
}
