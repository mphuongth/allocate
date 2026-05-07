'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, ChevronRight, RefreshCw, TrendingDown, Target, Building2, Coins, TrendingUp, BarChart2, Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { FundBreakdownItem, NonFundUnallocatedItem } from '../DashboardClient'
import { fmtCompact, fmtNav, fmtPct } from '@/lib/formatters'

const TYPE_ICON: Record<string, React.ElementType> = {
  fund:  TrendingUp,
  bank:  Building2,
  gold:  Coins,
  stock: BarChart2,
}
const TYPE_COLOR: Record<string, string> = {
  fund:  'var(--c-accent-fund)',
  bank:  'var(--c-accent-fixed)',
  gold:  '#a16207',
  stock: 'var(--c-accent-insurance)',
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
  onRefresh: () => void
}

export default function UnallocatedSection({
  unallocatedAmount, funds, nonFunds,
  onFundClick, onAssignToGoal, onSellFund,
  onAssignNonFundToGoal, onSellNonFund, onRefresh,
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

  return (
    <>
      <section>
        {/* ── Collapsible toggle header ── */}
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
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('sectionUnallocated')}
              <span style={{
                display: 'inline-flex', alignItems: 'center',
                fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 999,
                background: 'var(--c-card-2)', color: 'var(--c-muted)',
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

        {/* ── Collapsible body ── */}
        {open && (
          <div style={{
            background: 'var(--c-card)',
            border: '1px solid var(--c-line)',
            borderRadius: 'var(--r-card)',
            boxShadow: 'var(--shadow-card)',
            overflow: 'hidden',
            padding: '4px 14px',
          }}>
            {/* Refresh NAV button row */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 0 0' }}>
              <button
                onClick={onRefresh}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 12, fontWeight: 500, padding: '5px 10px',
                  border: '1px solid var(--c-line)', borderRadius: 'var(--r-control)',
                  background: 'var(--c-card)', color: 'var(--c-ink)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <RefreshCw size={13} />
                {t('refreshNav')}
              </button>
            </div>

            {/* Fund rows */}
            {funds.map((fund) => {
              const plPositive = fund.profitLoss >= 0
              return (
                <button
                  key={fund.fundId}
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
              const Icon = TYPE_ICON[item.type] ?? Building2
              const color = TYPE_COLOR[item.type] ?? 'var(--c-muted)'
              const typeLabel = typeLabelMap[item.type] ?? item.type
              return (
                <button
                  key={item.transactionId}
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

      {/* ── Action sheet overlay ── */}
      {actionTarget && (
        <div
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
              padding: '12px 0 calc(env(safe-area-inset-bottom) + 16px)',
            }}
          >
            {/* Handle */}
            <div style={{
              width: 36, height: 4, borderRadius: 2,
              background: 'var(--c-line)', margin: '0 auto 16px',
            }} />

            {/* Item label */}
            <div style={{ padding: '0 20px 12px', borderBottom: '1px solid var(--c-line)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>
                {actionTarget.kind === 'fund'
                  ? actionTarget.fund.fundName
                  : (actionTarget.item.notes || new Date(actionTarget.item.investmentDate).toLocaleDateString('vi-VN'))
                }
              </div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                {actionTarget.kind === 'fund'
                  ? fmtCompact(actionTarget.fund.currentValue)
                  : fmtCompact(actionTarget.item.currentValue)
                }
              </div>
            </div>

            {/* Actions */}
            <div style={{ padding: '8px 0' }}>
              {/* Assign to Goal */}
              <button
                onClick={() => {
                  closeAction()
                  if (actionTarget.kind === 'fund') onAssignToGoal(actionTarget.fund.fundId)
                  else onAssignNonFundToGoal(actionTarget.item.transactionId)
                }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 20px',
                  background: 'transparent', border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: 'var(--c-navy-tint)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--c-navy)',
                }}>
                  <Target size={18} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--c-ink)' }}>{t('assignToGoal')}</div>
                  <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 1 }}>Link this to a savings goal</div>
                </div>
                <ChevronRight size={16} color="var(--c-muted)" />
              </button>

              {/* Sell / Withdraw */}
              {canSell && (
                <button
                  onClick={() => {
                    closeAction()
                    if (actionTarget.kind === 'fund') onSellFund(actionTarget.fund)
                    else onSellNonFund(actionTarget.item)
                  }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 20px',
                    background: 'transparent', border: 'none',
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: 'var(--c-warn-tint)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--c-warn)',
                  }}>
                    <TrendingDown size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--c-ink)' }}>
                      {actionTarget.kind === 'nonFund' && actionTarget.item.type === 'bank' ? tg('withdraw') : tg('sell')}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 1 }}>Record a sale or withdrawal</div>
                  </div>
                  <ChevronRight size={16} color="var(--c-muted)" />
                </button>
              )}

              {/* Transaction History (fund only) */}
              {actionTarget.kind === 'fund' && (
                <button
                  onClick={() => {
                    closeAction()
                    onFundClick(actionTarget.fund.fundId)
                  }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 20px',
                    background: 'transparent', border: 'none',
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: 'var(--c-card-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--c-muted)',
                  }}>
                    <Clock size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--c-ink)' }}>Transaction History</div>
                    <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 1 }}>View all purchases and sales</div>
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
