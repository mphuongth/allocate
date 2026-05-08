'use client'

import { useState, useEffect, useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowDownRight, ArrowDownToLine, Building, Check, CircleDollarSign, Shield, TrendingUp, Wallet, X } from 'lucide-react'
import { fmt } from '@/lib/formatters'
const fmtVND = (n: number, _locale?: string) => fmt(n)

export interface SellItem {
  type: 'fund' | 'bank' | 'gold' | 'stock'
  name: string
  currentValue: number
  units?: number
  navPerUnit?: number
  gainPct?: number
  interestRate?: number
  // API identifiers
  fundId?: string
  transactionId?: string
  purchasePrice?: number
}

interface Props {
  item: SellItem | null
  open: boolean
  context: 'unallocated' | 'goal'
  onClose: () => void
  onSuccess: () => void
}

const TYPE_ICON = {
  fund: TrendingUp,
  bank: Building,
  gold: CircleDollarSign,
  stock: TrendingUp,
} as const

const TYPE_COLOR = {
  fund: '#2563eb',
  bank: '#047857',
  gold: '#d97706',
  stock: '#7c3aed',
} as const

export function SellWithdrawSheet({ item, open, context, onClose, onSuccess }: Props) {
  const locale = useLocale()
  const t = useTranslations('Dashboard')

  const [amount, setAmount] = useState('')
  const [units, setUnits] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [soldAmount, setSoldAmount] = useState(0)
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
    } else {
      const timer = setTimeout(() => {
        setMounted(false)
        setAmount('')
        setUnits('')
        setSaving(false)
        setError('')
        setConfirmed(false)
        setSoldAmount(0)
      }, 220) // matches slide-down animation duration
      return () => clearTimeout(timer)
    }
  }, [open, item?.name])

  const isFund = item?.type === 'fund'
  const isGold = item?.type === 'gold'
  const isBank = item?.type === 'bank'

  const maxAmount = item?.currentValue ?? 0
  const numAmount = Number(amount) || 0
  const isOverMax = numAmount > maxAmount && maxAmount > 0
  const isValid = numAmount > 0 && !isOverMax && !saving

  const remaining = maxAmount - numAmount

  const gainLoss = useMemo(() => {
    if (!numAmount || item?.gainPct == null) return null
    return numAmount * item.gainPct / (100 + item.gainPct)
  }, [numAmount, item?.gainPct])

  const penaltyAmount = useMemo(() => {
    if (!isBank || !numAmount || !item?.interestRate) return null
    return Math.round(numAmount * (item.interestRate / 100) * 0.5)
  }, [isBank, numAmount, item?.interestRate])

  const taxAmount = useMemo(() => {
    if (!isFund || !numAmount) return null
    return Math.round(numAmount * 0.001)
  }, [isFund, numAmount])

  const showUnits = (isFund || isGold) && item?.units != null
  const navPerUnit = item?.navPerUnit

  function handleAmountChange(val: string) {
    const raw = val.replace(/,/g, '').replace(/[^0-9]/g, '')
    setAmount(raw)
    setError('')
    if (navPerUnit && raw) {
      const u = Number(raw) / navPerUnit
      setUnits(u > 0 ? u.toFixed(2) : '')
    } else {
      setUnits('')
    }
  }

  function handleUnitsChange(val: string) {
    setUnits(val)
    setError('')
    if (navPerUnit && val) {
      const a = Number(val) * navPerUnit
      setAmount(a > 0 ? Math.round(a).toString() : '')
    } else {
      setAmount('')
    }
  }

  function handleSetAll() {
    setAmount(String(maxAmount))
    if (navPerUnit && item?.units != null) setUnits(item.units.toFixed(2))
    setError('')
  }

  async function handleConfirm() {
    if (!item || !isValid) return
    setSaving(true)
    setError('')
    try {
      const today = new Date().toISOString().slice(0, 10)

      if (isFund && item.fundId) {
        const principalWithdrawn = item.purchasePrice
          ? Math.round((numAmount / item.currentValue) * (item.purchasePrice * (item.units ?? 0)))
          : Math.round(numAmount)
        const unitsWithdrawn = navPerUnit ? numAmount / navPerUnit : (item.units ?? 0)
        const res = await fetch('/api/v1/investment-transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction_type: 'withdrawal',
            asset_type: 'fund',
            fund_id: item.fundId,
            investment_date: today,
            amount_vnd: Math.round(numAmount),
            units_withdrawn: parseFloat(unitsWithdrawn.toFixed(4)),
            principal_withdrawn: principalWithdrawn,
            goal_id: null,
          }),
        })
        if (!res.ok) {
          const { error: e } = await res.json()
          setError(e ?? t('sellError'))
          setSaving(false)
          return
        }
      } else if (item.transactionId) {
        const body: Record<string, unknown> = {
          transaction_type: 'withdrawal',
          asset_type: item.type,
          parent_transaction_id: item.transactionId,
          investment_date: today,
          amount_vnd: Math.round(numAmount),
          principal_withdrawn: Math.round(numAmount),
          goal_id: null,
        }
        if (isGold && units && navPerUnit) {
          body.units_withdrawn = parseFloat(units)
        }
        const res = await fetch('/api/v1/investment-transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const { error: e } = await res.json()
          setError(e ?? t('sellError'))
          setSaving(false)
          return
        }
      }

      setSoldAmount(numAmount)
      setConfirmed(true)
      setTimeout(() => {
        setConfirmed(false)
        onSuccess()
        onClose()
      }, 2000)
    } catch {
      setError(t('sellError'))
    }
    setSaving(false)
  }

  const isVI = locale === 'vi'
  const titleText = isBank
    ? (isVI ? 'Rút tiền' : 'Withdraw')
    : (isVI ? 'Bán' : 'Sell')
  const amountLabel = isBank
    ? (isVI ? 'Số tiền muốn rút' : 'Amount to withdraw')
    : (isVI ? 'Số tiền muốn bán' : 'Amount to sell')
  const confirmLabel = isBank
    ? (isVI ? 'Xác nhận rút' : 'Confirm withdrawal')
    : (isVI ? 'Xác nhận bán' : 'Confirm sale')
  const settlementCopy = isFund
    ? (isVI ? 'Tiền về tài khoản sau T+3 ngày làm việc' : 'Proceeds arrive in T+3 business days')
    : (isVI ? 'Tiền về tài khoản trong 1 ngày làm việc' : 'Proceeds arrive within 1 business day')
  const moneyGoesCopy = context === 'goal'
    ? (isVI ? 'Tiền sẽ chuyển về mục "Chưa phân bổ"' : 'Proceeds move to Unallocated')
    : (isVI ? 'Tiền sẽ về tài khoản ngân hàng liên kết' : 'Proceeds go to your linked bank account')

  if (!mounted) return null

  const Icon = item ? (TYPE_ICON[item.type as keyof typeof TYPE_ICON] ?? TrendingUp) : TrendingUp
  const typeColor = item ? (TYPE_COLOR[item.type as keyof typeof TYPE_COLOR] ?? '#94a3b8') : '#94a3b8'

  return (
    <div
      data-testid="sell-sheet"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15, 23, 42, 0.2)',
        zIndex: 100,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: open ? 'fade-in 180ms ease' : 'fade-out 180ms ease forwards',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, maxHeight: '90dvh',
          background: 'var(--c-card)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: '8px 16px 32px',
          overflowY: 'auto',
          animation: open ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'slide-down 180ms ease forwards',
          boxShadow: '0 -8px 24px rgba(0,0,0,0.12)',
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong, #cbd5e1)', borderRadius: 999, margin: '6px auto 14px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{titleText}</h3>
          <button onClick={onClose} style={{ padding: 6, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {confirmed ? (
          // ── Success state ────────────────────────────────────────────────
          <div data-testid="sell-success" style={{ padding: '32px 0', textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 32,
              background: 'var(--c-pos-tint, #dcfce7)', color: 'var(--c-pos, #16a34a)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <Check size={30} strokeWidth={2.5} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{isBank ? (isVI ? 'Đã rút thành công' : 'Withdrawal successful') : (isVI ? 'Đã bán thành công' : 'Sale successful')}</div>
            <div style={{ fontSize: 13, color: 'var(--c-muted)', marginTop: 4 }}>{item?.name}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-pos, #16a34a)', marginTop: 12, letterSpacing: '-0.02em' }}>
              {fmtVND(soldAmount, locale)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 8, padding: '0 24px', lineHeight: 1.5 }}>
              {settlementCopy}
            </div>
          </div>
        ) : (
          // ── Form ────────────────────────────────────────────────────────
          <div style={{ display: 'grid', gap: 14 }}>

            {/* Item summary card */}
            {item && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--c-card-2)', borderRadius: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--c-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: typeColor, border: '1px solid var(--c-line)', flexShrink: 0 }}>
                  <Icon size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>{isVI ? 'Khả dụng' : 'Available'}: <span style={{ fontWeight: 600, color: 'var(--c-ink)' }}>{fmtVND(maxAmount, locale)}</span></span>
                    {item.units != null && <span>{item.units.toLocaleString()} {isVI ? 'phần' : 'units'}</span>}
                    {isBank && item.interestRate && <span>{item.interestRate}%/yr</span>}
                  </div>
                </div>
              </div>
            )}

            {/* Amount input */}
            <div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{amountLabel}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 12px', background: 'var(--c-card)',
                  border: `1.5px solid ${isOverMax ? 'var(--c-neg, #dc2626)' : 'var(--c-navy, #1e3a5f)'}`,
                  borderRadius: 10,
                }}>
                  <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                  <input
                    data-testid="sell-amount-input"
                    type="text"
                    inputMode="numeric"
                    value={amount ? Number(amount).toLocaleString('vi-VN') : ''}
                    onChange={e => handleAmountChange(e.target.value)}
                    placeholder="0"
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontWeight: 600, background: 'transparent', color: isOverMax ? 'var(--c-neg, #dc2626)' : 'var(--c-ink)' }}
                  />
                </div>
                <button
                  data-testid="sell-all-btn"
                  onClick={handleSetAll}
                  style={{ padding: '8px 12px', background: 'var(--c-navy-tint, #e8edf3)', color: 'var(--c-navy, #1e3a5f)', border: '1px solid var(--c-navy-tint, #e8edf3)', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  {isVI ? 'Tất cả' : 'All'}
                </button>
              </div>
              {isOverMax && (
                <div style={{ fontSize: 11, color: 'var(--c-neg, #dc2626)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <X size={12} strokeWidth={2.5} />
                  {isVI ? 'Vượt quá số dư khả dụng' : 'Exceeds available balance'} · {isVI ? 'Tối đa' : 'Max'} {fmtVND(maxAmount, locale)}
                </div>
              )}
            </div>

            {/* Units input — fund & gold only */}
            {showUnits && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{isVI ? 'Số phần' : 'Units'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10 }}>
                  <input
                    type="number"
                    value={units}
                    onChange={e => handleUnitsChange(e.target.value)}
                    placeholder="0.00"
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontWeight: 600, background: 'transparent', color: 'var(--c-ink)' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVI ? 'phần' : 'units'}</span>
                </div>
                {navPerUnit && (
                  <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>
                    {isVI ? 'Giá NAV' : 'NAV'}: <span style={{ fontWeight: 500 }}>{fmtVND(navPerUnit, locale)}</span> / {isVI ? 'phần' : 'unit'}
                  </div>
                )}
              </div>
            )}

            {/* Summary strip */}
            {numAmount > 0 && !isOverMax && (
              <div data-testid="sell-summary-strip" style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                  <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVI ? 'Còn lại sau giao dịch' : 'Remaining after transaction'}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{fmtVND(Math.max(0, remaining), locale)}</span>
                </div>
                {gainLoss != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: (penaltyAmount || taxAmount) ? '1px solid var(--c-line)' : 'none' }}>
                    <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVI ? 'Lãi/Lỗ ước tính' : 'Est. gain / loss'}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: gainLoss >= 0 ? 'var(--c-pos, #16a34a)' : 'var(--c-neg, #dc2626)' }}>
                      {gainLoss >= 0 ? '+' : ''}{fmtVND(gainLoss, locale)}
                    </span>
                  </div>
                )}
                {penaltyAmount != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: taxAmount ? '1px solid var(--c-line)' : 'none' }}>
                    <span style={{ fontSize: 12, color: 'var(--c-warn, #d97706)' }}>{isVI ? 'Lãi mất ước tính' : 'Est. interest forfeited'}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-warn, #d97706)' }}>−{fmtVND(penaltyAmount, locale)}</span>
                  </div>
                )}
                {taxAmount != null && (
                  <div data-testid="sell-tax-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                    <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVI ? 'Thuế TNCN (0.1%)' : 'Personal income tax (0.1%)'}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-muted)' }}>−{fmtVND(taxAmount, locale)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Bank early-withdrawal warning */}
            {isBank && (
              <div data-testid="sell-bank-warning" style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--c-warn-tint, #fffbeb)', borderRadius: 10, border: '1px solid rgba(180,83,9,0.15)' }}>
                <Shield size={16} color="var(--c-warn, #d97706)" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 12, color: 'var(--c-warn, #d97706)', lineHeight: 1.5 }}>
                  {isVI ? 'Rút sớm có thể mất lãi.' : 'Early withdrawal may forfeit accrued interest.'}
                </p>
              </div>
            )}

            {/* Where money goes + settlement */}
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', background: 'var(--c-card-2)', borderRadius: 8 }}>
                <Wallet size={14} color="var(--c-muted)" style={{ marginTop: 1, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.5 }}>{moneyGoesCopy}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', background: 'var(--c-card-2)', borderRadius: 8 }}>
                <ArrowDownToLine size={14} color="var(--c-muted)" style={{ marginTop: 1, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.5 }}>{settlementCopy}</span>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--c-neg, #dc2626)', textAlign: 'center' }}>{error}</p>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              <button onClick={onClose} style={{ flex: 1, padding: '11px 14px', border: '1px solid var(--c-line)', borderRadius: 10, fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--c-ink)', cursor: 'pointer' }}>
                {isVI ? 'Hủy' : 'Cancel'}
              </button>
              <button
                data-testid="sell-confirm-btn"
                onClick={isValid ? handleConfirm : undefined}
                disabled={!isValid}
                style={{
                  flex: 2, padding: '11px 14px',
                  background: isValid ? 'var(--c-neg, #dc2626)' : 'var(--c-line)',
                  color: isValid ? '#fff' : 'var(--c-muted)',
                  border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  cursor: isValid ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'background 120ms, color 120ms',
                }}
              >
                {isBank ? <ArrowDownToLine size={15} strokeWidth={2.2} /> : <ArrowDownRight size={15} strokeWidth={2.2} />}
                {numAmount <= 0
                  ? (isVI ? (isBank ? 'Nhập số tiền rút' : 'Nhập số tiền bán') : (isBank ? 'Enter withdrawal amount' : 'Enter sale amount'))
                  : isOverMax
                  ? (isVI ? 'Vượt quá số dư' : 'Exceeds balance')
                  : saving
                  ? (isVI ? 'Đang xử lý…' : 'Processing…')
                  : confirmLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
