'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, RefreshCw, TrendingDown, Target, Building2, Coins, TrendingUp, BarChart2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { FundBreakdownItem, NonFundUnallocatedItem } from '../DashboardClient'
import { fmtCompact, fmtNav, fmtPct } from '@/lib/formatters'

// Type icon + color matching design tokens
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

  const typeLabelMap: Record<string, string> = {
    fund:  tt('assetFund'),
    bank:  tt('assetBank'),
    gold:  tt('assetGold'),
    stock: tt('assetStock'),
  }

  const totalItems = funds.length + nonFunds.length

  return (
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>
              {t('sectionUnallocated')}
            </h2>
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 999,
              background: 'var(--c-card-2)', color: 'var(--c-muted)',
            }}>
              {totalItems}
            </span>
          </div>
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
        }}>
          {/* Refresh NAV button row */}
          <div style={{
            display: 'flex', justifyContent: 'flex-end',
            padding: '10px 14px 0',
          }}>
            <button
              onClick={onRefresh}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 12, fontWeight: 500, padding: '5px 10px',
                border: '1px solid var(--c-line)', borderRadius: 8,
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
            const Icon = TYPE_ICON.fund
            const plPositive = fund.profitLoss >= 0
            return (
              <div key={fund.fundId} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                borderTop: '1px solid var(--c-line)',
              }}>
                {/* Icon */}
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: 'var(--c-card-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: TYPE_COLOR.fund,
                }}>
                  <Icon size={16} />
                </div>

                {/* Name + type label */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <button
                    onClick={() => onFundClick(fund.fundId)}
                    style={{
                      background: 'transparent', border: 'none', padding: 0,
                      fontSize: 13, fontWeight: 500, color: 'var(--c-ink)',
                      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', width: '100%',
                    }}
                  >
                    {fund.fundName}
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {fund.quantity.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {tt('unitsDefault')} · NAV {fmtNav(fund.currentNAV)}
                  </div>
                </div>

                {/* Value + gain */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtCompact(fund.currentValue)}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 1, fontVariantNumeric: 'tabular-nums', color: plPositive ? 'var(--c-pos)' : 'var(--c-neg)' }}>
                    {fmtPct(fund.profitLossPercentage)}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexShrink: 0, gap: 4 }}>
                  <button
                    onClick={() => onSellFund(fund)}
                    title={tg('sell')}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 11, fontWeight: 500, padding: '5px 8px',
                      border: '1px solid var(--c-warn)', borderRadius: 7,
                      background: 'var(--c-warn-tint)', color: 'var(--c-warn)',
                      cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                    }}
                  >
                    <TrendingDown size={12} />
                    <span className="hidden sm:inline">{tg('sell')}</span>
                  </button>
                  <button
                    onClick={() => onAssignToGoal(fund.fundId)}
                    title={t('assignToGoal')}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 11, fontWeight: 500, padding: '5px 8px',
                      border: '1px solid var(--c-line)', borderRadius: 7,
                      background: 'var(--c-card)', color: 'var(--c-ink)',
                      cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                    }}
                  >
                    <Target size={12} />
                    <span className="hidden sm:inline">{t('assignToGoal')}</span>
                  </button>
                </div>
              </div>
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
              <div key={item.transactionId} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                borderTop: '1px solid var(--c-line)',
              }}>
                {/* Icon */}
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: 'var(--c-card-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color,
                }}>
                  <Icon size={16} />
                </div>

                {/* Name + meta */}
                <div style={{ flex: 1, minWidth: 0 }}>
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

                {/* Value + gain */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtCompact(item.currentValue)}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 1, fontVariantNumeric: 'tabular-nums', color: plPositive ? 'var(--c-pos)' : 'var(--c-neg)' }}>
                    {fmtPct(plPct)}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexShrink: 0, gap: 4 }}>
                  {(item.type === 'bank' || item.type === 'gold') && (
                    <button
                      onClick={() => onSellNonFund(item)}
                      title={item.type === 'bank' ? tg('withdraw') : tg('sell')}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 11, fontWeight: 500, padding: '5px 8px',
                        border: '1px solid var(--c-warn)', borderRadius: 7,
                        background: 'var(--c-warn-tint)', color: 'var(--c-warn)',
                        cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                      }}
                    >
                      <TrendingDown size={12} />
                      <span className="hidden sm:inline">{item.type === 'bank' ? tg('withdraw') : tg('sell')}</span>
                    </button>
                  )}
                  <button
                    onClick={() => onAssignNonFundToGoal(item.transactionId)}
                    title={t('assignToGoal')}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 11, fontWeight: 500, padding: '5px 8px',
                      border: '1px solid var(--c-line)', borderRadius: 7,
                      background: 'var(--c-card)', color: 'var(--c-ink)',
                      cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                    }}
                  >
                    <Target size={12} />
                    <span className="hidden sm:inline">{t('assignToGoal')}</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
