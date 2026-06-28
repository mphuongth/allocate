'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft, ArrowUpRight, ArrowDownRight, Plus } from 'lucide-react'
import { useLocale } from 'next-intl'
import { fmtCompact, fmtNav, fmtPct, fmtUnits } from '@/lib/formatters'
import { TxRowsSkeleton } from './Skeletons'
import LoadError from './LoadError'

export interface PurchaseHistoryRow {
  purchase_date: string
  units: number | null
  nav_at_purchase: number | null
}

interface Props {
  open: boolean
  onClose: () => void
  fundName: string
  currentNAV: number
  quantity: number
  currentValue: number
  purchasePrice: number
  profitLoss: number
  profitLossPercentage: number
  purchaseHistory: PurchaseHistoryRow[]
  loading?: boolean
  /** The history fetch failed — show a retry state instead of "no history". */
  error?: boolean
  onRetry?: () => void
  onAddTransaction?: () => void
}

export default function TransactionHistorySheet({
  open, onClose,
  fundName, currentNAV, quantity, currentValue, purchasePrice,
  profitLoss, profitLossPercentage, purchaseHistory, loading, error, onRetry, onAddTransaction,
}: Props) {
  const isVI = useLocale() === 'vi'
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (open) setMounted(true)
    else {
      const t = setTimeout(() => setMounted(false), 220)
      return () => clearTimeout(t)
    }
  }, [open])

  if (!mounted) return null

  const isPositive = profitLoss >= 0
  const totalInvested = quantity * purchasePrice

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
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
            onClick={onClose}
            aria-label={isVI ? 'Quay lại' : 'Back'}
            data-testid="history-back-btn"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 6, color: 'var(--c-ink)',
              display: 'flex', alignItems: 'center', flexShrink: 0,
            }}
          >
            <ChevronLeft size={20} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11, color: 'var(--c-muted)', letterSpacing: '0.06em',
              textTransform: 'uppercase', fontWeight: 600,
            }}>
              {isVI ? 'Khoản nắm giữ' : 'Holding'}
            </div>
            <h1 style={{
              margin: 0, fontSize: 22, fontWeight: 600,
              letterSpacing: '-0.015em', color: 'var(--c-ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {fundName}
            </h1>
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 16px calc(env(safe-area-inset-bottom,0) + 40px)', display: 'grid', gap: 12 }}>
        {/* Hero — current value + gain */}
        <div style={{ background: 'var(--c-card)', borderRadius: 16, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 4 }}>
            {isVI ? 'Giá trị hiện tại' : 'Current value'}
          </p>
          <p style={{
            fontSize: 30, fontWeight: 700, color: 'var(--c-ink)',
            fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, letterSpacing: '-0.02em',
          }}>
            {fmtCompact(currentValue)}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '2px 7px', borderRadius: 999, fontSize: 12, fontWeight: 600,
              background: isPositive ? 'var(--c-pos-tint)' : 'var(--c-neg-tint)',
              color: isPositive ? 'var(--c-pos)' : 'var(--c-neg)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {isPositive
                ? <ArrowUpRight size={12} strokeWidth={2.2} />
                : <ArrowDownRight size={12} strokeWidth={2.2} />}
              {fmtPct(profitLossPercentage)}
            </span>
            <span style={{
              fontSize: 13, fontVariantNumeric: 'tabular-nums',
              color: isPositive ? 'var(--c-pos)' : 'var(--c-neg)',
            }}>
              {isPositive ? '+' : ''}{fmtCompact(profitLoss)}
            </span>
          </div>
        </div>

        {/* Stats — 3 cols matching design */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1,
          background: 'var(--c-line)', borderRadius: 12, overflow: 'hidden',
        }}>
          {[
            { label: isVI ? 'Đã đầu tư' : 'Invested', value: fmtCompact(totalInvested) },
            { label: isVI ? 'Số CCQ' : 'Units', value: fmtUnits(quantity) },
            { label: 'NAV', value: fmtNav(currentNAV) },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--c-card)', padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--c-muted)', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Transaction history */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 10px' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', margin: 0 }}>
              {isVI ? 'Lịch sử giao dịch' : 'Transaction history'}
            </p>
            <button
              onClick={onAddTransaction}
              aria-label={isVI ? 'Thêm giao dịch' : 'Add transaction'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', borderRadius: 8, border: 'none',
                background: 'transparent', color: 'var(--c-muted)',
                fontSize: 12, fontWeight: 500, cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <Plus size={12} strokeWidth={2.4} />
              {isVI ? 'Thêm giao dịch' : 'Add transaction'}
            </button>
          </div>
          <div style={{ background: 'var(--c-card)', borderRadius: 16, padding: '0 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            {loading && <TxRowsSkeleton />}
            {!loading && error && (
              <LoadError isVI={isVI} onRetry={() => onRetry?.()} />
            )}
            {!loading && !error && purchaseHistory.length === 0 && (
              <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
                {isVI ? 'Chưa có lịch sử giao dịch' : 'No transaction history'}
              </p>
            )}
            {!loading && !error && purchaseHistory.map((row, i) => {
              const amountPaid = row.units != null && row.nav_at_purchase != null
                ? Math.round(row.units * row.nav_at_purchase)
                : null
              // Parse the plain YYYY-MM-DD as a local date so the displayed day
              // never shifts a month/year for users behind UTC (new Date(str)
              // would read it as UTC midnight).
              const [py, pm, pd] = row.purchase_date.slice(0, 10).split('-').map(Number)
              const purchaseDate = new Date(py, (pm ?? 1) - 1, pd ?? 1)
              return (
                <div
                  key={i}
                  style={{
                    padding: '12px 0',
                    borderBottom: i === purchaseHistory.length - 1 ? 'none' : '1px solid var(--c-line)',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}
                >
                  <div style={{
                    width: 30, height: 30, borderRadius: 6, flexShrink: 0,
                    background: 'var(--c-pos-tint)', color: 'var(--c-pos)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <ArrowUpRight size={14} strokeWidth={2.2} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-ink)' }}>
                      {isVI ? 'Mua' : 'Buy'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {purchaseDate.toLocaleDateString(isVI ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {row.units != null && <>{' · '}{fmtUnits(row.units)} {isVI ? 'CCQ' : 'units'}</>}
                    </div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-pos)', fontVariantNumeric: 'tabular-nums' }}>
                    {amountPaid != null ? `+${fmtCompact(amountPaid)}` : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
