'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft, ArrowUpRight } from 'lucide-react'
import { useLocale } from 'next-intl'
import { fmt, fmtNav, fmtPct, fmtUnits } from '@/lib/formatters'

export interface PurchaseHistoryRow {
  purchase_date: string
  units: number
  nav_at_purchase: number
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
}

export default function TransactionHistorySheet({
  open, onClose,
  fundName, currentNAV, quantity, currentValue, purchasePrice,
  profitLoss, profitLossPercentage, purchaseHistory, loading,
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
        padding: 'calc(env(safe-area-inset-top,0) + 14px) 16px 10px',
        borderBottom: '1px solid var(--c-line)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
          <button
            onClick={onClose}
            aria-label={isVI ? 'Quay lại' : 'Back'}
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
              {isVI ? 'Lịch sử giao dịch' : 'Transaction history'}
            </div>
            <h1 style={{
              margin: 0, fontSize: 18, fontWeight: 600,
              letterSpacing: '-0.015em', color: 'var(--c-ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {fundName}
            </h1>
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 16px calc(env(safe-area-inset-bottom,0) + 40px)', display: 'grid', gap: 12 }}>
        {/* Hero — current value */}
        <div style={{ background: 'var(--c-card)', borderRadius: 16, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 4 }}>
            {isVI ? 'Giá trị hiện tại' : 'Current value'}
          </p>
          <p style={{
            fontSize: 26, fontWeight: 800, color: 'var(--c-ink)',
            fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, marginBottom: 14,
          }}>
            {fmt(currentValue)}
          </p>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1,
            background: 'var(--c-line)', borderRadius: 8, overflow: 'hidden',
          }}>
            {[
              {
                label: isVI ? 'Đã đầu tư' : 'Invested',
                value: fmt(quantity * purchasePrice),
                color: 'var(--c-ink)',
              },
              {
                label: isVI ? 'Lãi/Lỗ' : 'P/L',
                value: (isPositive ? '+' : '') + fmt(profitLoss),
                color: isPositive ? 'var(--c-pos)' : 'var(--c-neg)',
              },
              {
                label: isVI ? 'Tỷ suất' : 'Return',
                value: fmtPct(profitLossPercentage),
                color: isPositive ? 'var(--c-pos)' : 'var(--c-neg)',
              },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: 'var(--c-card)', padding: '10px 12px' }}>
                <p style={{ fontSize: 10, color: 'var(--c-muted)', marginBottom: 2 }}>{label}</p>
                <p style={{ fontSize: 12, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Stat chips */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1,
          background: 'var(--c-line)', borderRadius: 12, overflow: 'hidden',
        }}>
          {[
            { label: isVI ? 'NAV hiện tại' : 'Current NAV', value: fmtNav(currentNAV) },
            { label: isVI ? 'Số CCQ nắm giữ' : 'Units held', value: fmtUnits(quantity) },
            { label: isVI ? 'NAV trung bình mua' : 'Avg buy NAV', value: fmtNav(purchasePrice) },
            { label: isVI ? 'Số lần mua' : 'Purchases', value: String(purchaseHistory.length) },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--c-card)', padding: '12px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--c-muted)', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Purchase history */}
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', margin: '4px 0 10px' }}>
            {isVI ? 'Lịch sử mua' : 'Purchase history'}
          </p>
          <div style={{ background: 'var(--c-card)', borderRadius: 16, padding: '0 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            {loading && (
              <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
                {isVI ? 'Đang tải…' : 'Loading…'}
              </p>
            )}
            {!loading && purchaseHistory.length === 0 && (
              <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
                {isVI ? 'Chưa có lịch sử giao dịch' : 'No transaction history'}
              </p>
            )}
            {!loading && purchaseHistory.map((row, i) => {
              const amountPaid = Math.round(row.units * row.nav_at_purchase)
              return (
                <div
                  key={i}
                  style={{
                    padding: '14px 0',
                    borderBottom: i === purchaseHistory.length - 1 ? 'none' : '1px solid var(--c-line)',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: 'var(--c-pos-tint)', color: 'var(--c-pos)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <ArrowUpRight size={14} strokeWidth={2.2} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtUnits(row.units)} {isVI ? 'CCQ' : 'units'} @ {fmtNav(row.nav_at_purchase)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2 }}>
                      {new Date(row.purchase_date).toLocaleDateString(isVI ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(amountPaid)}
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
