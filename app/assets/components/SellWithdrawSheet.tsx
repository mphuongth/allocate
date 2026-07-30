'use client'

import { useState, useMemo } from 'react'
import { useLocale } from 'next-intl'
import { ArrowDownRight, ArrowDownToLine, Building, Check, Coins, Shield, TrendingUp, Wallet, X } from 'lucide-react'
import { iconHit } from './iconHit'
import { fmt } from '@/lib/formatters'
import { todayIso } from '@/lib/dates'
import { formatIntVN, parseIntVN, formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'
import { CairnLoader } from '@/app/components/ui/CairnLoader'
import { AffectsProgressControl } from './goalDetailShared'
import { useDialogMount, useResetOnOpen } from '@/app/(app)/planning/components/useDialogMount'
import { previewBankWithdrawal, estimateReceivedForPrincipal } from '@/lib/bankWithdrawal'
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
  // Set when this bank item is an accumulating book (its anchor id). Switches the
  // sheet to a FULL close: every tranche is withdrawn at once (no partial amount).
  depositGroupId?: string | null
}

interface Props {
  item: SellItem | null
  open: boolean
  context: 'unallocated' | 'goal'
  // When withdrawing from a goal, link the withdrawal to that goal so the
  // goal-detail fetch (filtered by goal_id) returns it and the holding is
  // valued net of the withdrawal (issue #261).
  goalId?: string
  // Goal value & target drive the "count toward goal progress" preview. Only
  // used in the 'goal' context.
  goalCurrentValue?: number
  goalTargetAmount?: number | null
  onClose: () => void
  onSuccess: () => void
  // Desktop renders a centered modal dialog; mobile keeps the bottom sheet.
  desktop?: boolean
}

const TYPE_ICON = {
  fund: TrendingUp,
  bank: Building,
  gold: Coins,
  stock: TrendingUp,
} as const

const TYPE_COLOR = {
  fund: '#2563eb',
  bank: '#047857',
  gold: 'var(--c-fund-gold)',
  stock: '#7c3aed',
} as const

export function SellWithdrawSheet({ item, open, context, goalId, goalCurrentValue, goalTargetAmount, onClose, onSuccess, desktop }: Props) {
  const locale = useLocale()
  // Generic fallback shown when the API fails without a message. Inline-localized
  // to match the rest of this file (no next-intl t() here).
  const sellError = locale === 'vi'
    ? 'Đã xảy ra lỗi. Vui lòng thử lại.'
    : 'An error occurred. Please try again.'

  const [amount, setAmount] = useState('')
  const [units, setUnits] = useState('')
  const [received, setReceived] = useState('') // bank: cash actually received
  // Seeded lazily as well as synced below: useResetOnOpen fires on a *transition*
  // into open, so a sheet that mounts already open — which is how it renders when
  // the parent shows it in the same commit — would otherwise never get its gold
  // prefill. Reads item directly because isGold/navPerUnit are derived further
  // down the component.
  const [salePrice, setSalePrice] = useState(
    () => (item?.type === 'gold' && item?.navPerUnit ? String(Math.round(item.navPerUnit)) : ''),
  ) // gold: sale price per chỉ
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [soldAmount, setSoldAmount] = useState(0)
  const [affectsProgress, setAffectsProgress] = useState(true)
  const mounted = useDialogMount(open)

  // The form used to be wiped after the exit animation finished; clearing it on
  // the way back in is equivalent to the user and doesn't need its own timer.
  useResetOnOpen(open, () => {
    setAmount('')
    setUnits('')
    setReceived('')
    setSalePrice('')
    setSaving(false)
    setError('')
    setConfirmed(false)
    setSoldAmount(0)
    setAffectsProgress(true)
  })

  const isFund = item?.type === 'fund'
  const isGold = item?.type === 'gold'
  const isBank = item?.type === 'bank'
  // An accumulating book: a FULL close (all tranches at once), not a partial
  // withdrawal — so the amount is fixed at the book balance and only the cash
  // received is editable (handles an early-withdrawal penalty / the exact payout).
  const isBook = isBank && !!item?.depositGroupId

  const maxAmount = item?.currentValue ?? 0
  const numAmount = Number(amount) || 0
  const navPerUnit = item?.navPerUnit

  // Gold: quantity (chỉ) × sale price → proceeds / cost / profit. Bounded by chỉ
  // held, not by value.
  const numUnits = Number(units) || 0
  const numSalePrice = Number(salePrice) || 0
  const goldMaxUnits = item?.units ?? 0
  const goldBuyUnit = isGold && item && item.units && item.units > 0 && item.purchasePrice != null
    ? Math.round(item.purchasePrice / item.units) : null
  const goldProceeds = isGold ? Math.round(numUnits * numSalePrice) : 0
  const goldCostSold = goldBuyUnit != null ? Math.round(goldBuyUnit * numUnits) : null
  const goldProfit = isGold && goldProceeds > 0 && goldCostSold != null ? goldProceeds - goldCostSold : null
  const goldRemUnits = isGold && item?.units != null ? item.units - numUnits : null
  const isOverUnits = isGold && item?.units != null && numUnits > item.units

  // Bank: the entered amount is the PRINCIPAL leaving the book, and the cash
  // received is editable on top of it — an early withdrawal can forfeit the
  // accrued interest, so only the user's bank slip knows the real payout. The
  // amount used to be a slice of currentValue (principal + projected interest)
  // that got converted back into a principal fraction, which meant the recorded
  // principal was never the number the user typed (#578).
  //
  // A book withdraws the same way (partial up to the principal, "All" = full
  // close) — only the confirm routes to the book endpoint, which spreads the
  // principal across tranches.
  const numReceived = Number(received) || 0
  const bankPrincipal = item?.purchasePrice ?? maxAmount
  const bankPreview = previewBankWithdrawal({ currentPrincipal: bankPrincipal, amount: numAmount, received: numReceived })
  const bankGain = isBank && numReceived > 0 && numAmount > 0 ? bankPreview.interest : null
  // Withdrawals are capped by what the holding actually holds: principal for a
  // bank deposit, current value for anything sold at market.
  const bankPct = bankPrincipal > 0 ? Math.min(1, numAmount / bankPrincipal) : 0

  const withdrawMax = isBank ? bankPrincipal : maxAmount

  // Value released from the holding by this withdrawal. After saving,
  // valueNonFundHolding revalues the deposit from its remaining principal, so the
  // holding falls by the withdrawn principal PLUS its projected interest —
  // calcProjectedInterest is linear in principal, which makes that slice exact.
  // The cash received is not that figure: an early withdrawal can forfeit the
  // interest and still release it from the goal.
  const bankValueReleased = isBank
    ? estimateReceivedForPrincipal({ currentPrincipal: bankPrincipal, currentValue: maxAmount, amount: numAmount })
    : 0
  const isOverMax = isGold ? isOverUnits : (numAmount > withdrawMax && withdrawMax > 0)
  const isValid = isGold
    ? (numUnits > 0 && !isOverUnits && numSalePrice > 0 && !saving)
    : isBank
      ? (numAmount > 0 && !isOverMax && numReceived > 0 && !saving)
      : (numAmount > 0 && !isOverMax && !saving)

  const gainLoss = useMemo(() => {
    if (!numAmount || isBank || item?.gainPct == null) return null
    return numAmount * item.gainPct / (100 + item.gainPct)
  }, [numAmount, isBank, item?.gainPct])

  const taxAmount = useMemo(() => {
    if (!isFund || !numAmount) return null
    return Math.round(numAmount * 0.001)
  }, [isFund, numAmount])

  const showUnits = isFund && item?.units != null

  // Gold: prefill the sale price with the current market price when the sheet
  // opens. navPerUnit is the sync key as well, so a price arriving after the
  // sheet is already open still lands in the field — the old effect listed it as
  // a dependency for exactly that reason.
  useResetOnOpen(open, () => {
    if (isGold && navPerUnit) setSalePrice(String(Math.round(navPerUnit)))
  }, navPerUnit)

  function handleAmountChange(val: string) {
    const raw = parseIntVN(val)
    setAmount(raw)
    setError('')
    // Bank: the received field tracks the amount until edited down, but the
    // amount is principal — so add back the interest accrued on that slice or an
    // unedited field would record a withdrawal that earned nothing.
    if (isBank) {
      setReceived(raw
        ? String(estimateReceivedForPrincipal({ currentPrincipal: bankPrincipal, currentValue: maxAmount, amount: Number(raw) }))
        : '')
    }
    if (navPerUnit && raw) {
      const u = Number(raw) / navPerUnit
      setUnits(u > 0 ? u.toFixed(2) : '')
    } else {
      setUnits('')
    }
  }

  function handleUnitsChange(val: string) {
    const v = parseDecimalVN(val)
    setUnits(v)
    setError('')
    if (navPerUnit && v) {
      const a = Number(v) * navPerUnit
      setAmount(a > 0 ? Math.round(a).toString() : '')
    } else {
      setAmount('')
    }
  }

  function handleSetAll() {
    if (isGold && item?.units != null) {
      setUnits(String(item.units))
      setError('')
      return
    }
    // Bank: "All" is the whole remaining PRINCIPAL, and the payout estimate for
    // it is the full current value — the same figure this field was pre-filled
    // with before the amount became principal.
    setAmount(String(isBank ? bankPrincipal : maxAmount))
    if (isBank) {
      setReceived(String(estimateReceivedForPrincipal({ currentPrincipal: bankPrincipal, currentValue: maxAmount, amount: bankPrincipal })))
    }
    if (navPerUnit && item?.units != null) setUnits(item.units.toFixed(2))
    setError('')
  }

  async function handleConfirm() {
    if (!item || !isValid) return
    setSaving(true)
    setError('')
    try {
      const today = todayIso()
      // Withdrawals from a goal carry that goal's id so the goal-detail view
      // (which fetches by goal_id) sees them; from the unallocated list there
      // is no goal to link to (issue #261).
      const withdrawalGoalId = context === 'goal' ? (goalId ?? null) : null

      if (isBook && item.transactionId) {
        // Full book close: one atomic call writes a withdrawal per tranche.
        const res = await fetch(`/api/v1/investment-transactions/${item.transactionId}/withdraw-book`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            withdraw_principal: bankPreview.principal,
            total_received: bankPreview.received,
            investment_date: today,
            affects_progress: context === 'goal' ? affectsProgress : true,
          }),
        })
        if (!res.ok) {
          const { error: e } = await res.json().catch(() => ({ error: sellError }))
          setError(e ?? sellError)
          setSaving(false)
          return
        }
      } else if (isFund && item.fundId) {
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
            goal_id: withdrawalGoalId,
            affects_progress: context === 'goal' ? affectsProgress : true,
          }),
        })
        if (!res.ok) {
          const { error: e } = await res.json()
          setError(e ?? sellError)
          setSaving(false)
          return
        }
      } else if (item.transactionId) {
        const body: Record<string, unknown> = {
          transaction_type: 'withdrawal',
          asset_type: item.type,
          parent_transaction_id: item.transactionId,
          investment_date: today,
          // Gold: amount = proceeds (qty × sale price), principal = cost basis of
          // the sold chỉ. Bank: amount = cash received, principal = the principal
          // the user entered.
          amount_vnd: isGold ? goldProceeds : isBank ? bankPreview.received : Math.round(numAmount),
          principal_withdrawn: isGold ? (goldCostSold ?? goldProceeds) : isBank ? bankPreview.principal : Math.round(numAmount),
          goal_id: withdrawalGoalId,
          affects_progress: context === 'goal' ? affectsProgress : true,
        }
        if (isGold) {
          body.units_withdrawn = parseFloat(numUnits.toFixed(4))
        }
        const res = await fetch('/api/v1/investment-transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const { error: e } = await res.json()
          setError(e ?? sellError)
          setSaving(false)
          return
        }
      }

      setSoldAmount(isGold ? goldProceeds : isBank ? numReceived : numAmount)
      setConfirmed(true)
      setTimeout(() => {
        setConfirmed(false)
        onSuccess()
        onClose()
      }, 2000)
    } catch {
      setError(sellError)
    }
    setSaving(false)
  }

  const isVI = locale === 'vi'
  const titleText = isBank
    ? (isVI ? 'Rút tiền' : 'Withdraw')
    : (isVI ? 'Bán' : 'Sell')
  // "Principal", explicitly: the field is the principal leaving the book, not a
  // share of the deposit's current value (#578).
  const amountLabel = isBank
    ? (isVI ? 'Số tiền gốc muốn rút' : 'Principal amount to withdraw')
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
        background: desktop ? 'rgba(15, 23, 42, 0.4)' : 'rgba(15, 23, 42, 0.2)',
        zIndex: desktop ? 200 : 100,
        display: 'flex', alignItems: desktop ? 'center' : 'flex-end', justifyContent: 'center',
        padding: desktop ? 24 : 0,
        backdropFilter: desktop ? 'blur(2px)' : undefined,
        animation: open ? 'fade-in 180ms ease' : 'fade-out 180ms ease forwards',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, maxHeight: desktop ? 'calc(100vh - 48px)' : '90dvh',
          background: 'var(--c-card)',
          borderRadius: desktop ? 20 : '20px 20px 0 0',
          display: 'flex', flexDirection: 'column',
          animation: open
            ? (desktop ? 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)' : 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)')
            : (desktop ? 'fade-out 150ms ease forwards' : 'slide-down 180ms ease forwards'),
          boxShadow: desktop
            ? '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)'
            : '0 -8px 24px rgba(0,0,0,0.12)',
        }}
      >
        {/* Drag handle — mobile bottom-sheet affordance only */}
        {!desktop && <div style={{ width: 36, height: 4, background: 'var(--c-line-strong, #cbd5e1)', borderRadius: 999, margin: '6px auto 14px', flexShrink: 0 }} />}

        {/* Header — pinned, sits outside the scrollable body */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: desktop ? '18px 20px 14px' : '0 16px 16px', borderBottom: desktop ? '1px solid var(--c-line)' : undefined, flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{titleText}</h3>
          <button onClick={onClose} aria-label="Close" style={{ ...iconHit, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body — wraps both success and form states. Desktop adds a
            top gap so the item card doesn't sit flush against the header divider
            (issue #256); mobile relies on the header's own bottom padding. */}
        <div data-testid="sell-body" style={{ flex: 1, overflowY: 'auto', padding: desktop ? '16px 16px 32px' : '0 16px 32px' }}>
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
                    {/* Bank: the withdrawable figure is the PRINCIPAL, so show
                        that as available and the current value beside it —
                        offering a value you can't enter is what made the old cap
                        misleading. */}
                    <span>{isBank ? (isVI ? 'Gốc khả dụng' : 'Principal available') : (isVI ? 'Khả dụng' : 'Available')}: <span style={{ fontWeight: 600, color: 'var(--c-ink)' }}>{fmtVND(isBank ? bankPrincipal : maxAmount, locale)}</span></span>
                    {isBank && <span>{isVI ? 'Giá trị' : 'Value'}: <span style={{ fontWeight: 600, color: 'var(--c-ink)' }}>{fmtVND(maxAmount, locale)}</span></span>}
                    {item.units != null && <span>{item.units.toLocaleString()} {isVI ? 'phần' : 'units'}</span>}
                    {isBank && item.interestRate && <span>{item.interestRate}%/yr</span>}
                  </div>
                </div>
              </div>
            )}

            {!isGold ? (
            <>
            {/* Amount input (a book is editable too — partial up to the balance) */}
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
                    value={formatIntVN(amount)}
                    onChange={e => handleAmountChange(e.target.value)}
                    placeholder="0"
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, background: 'transparent', color: isOverMax ? 'var(--c-neg, #dc2626)' : 'var(--c-ink)' }}
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
                  {isBank
                    ? (isVI ? 'Vượt quá tiền gốc còn lại' : 'Exceeds remaining principal')
                    : (isVI ? 'Vượt quá số dư khả dụng' : 'Exceeds available balance')} · {isVI ? 'Tối đa' : 'Max'} {fmtVND(withdrawMax, locale)}
                </div>
              )}
            </div>

            {/* Bank: editable cash received (early withdrawal can cut interest) */}
            {isBank && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{isVI ? 'Số tiền thực nhận' : "Amount you'll receive"}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1.5px solid var(--c-navy, #1e3a5f)', borderRadius: 10 }}>
                  <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                  <input
                    data-testid="sell-received-input"
                    type="text"
                    inputMode="numeric"
                    value={formatIntVN(received)}
                    onChange={e => { setReceived(parseIntVN(e.target.value)); setError('') }}
                    placeholder="0"
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, background: 'transparent', color: 'var(--c-ink)' }}
                  />
                </div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>
                  {isVI ? 'Tạm tính theo giá trị hiện tại — sửa nếu rút sớm bị trừ lãi' : 'Pre-filled at current value — edit down if early withdrawal cuts interest'}
                </div>
              </div>
            )}

            {/* Units input — fund & gold only */}
            {showUnits && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{isVI ? 'Số phần' : 'Units'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10 }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formatDecimalVN(units)}
                    onChange={e => handleUnitsChange(e.target.value)}
                    placeholder="0,00"
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, background: 'transparent', color: 'var(--c-ink)' }}
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

            {/* Fund summary: remaining / gain-loss / tax */}
            {!isBank && numAmount > 0 && !isOverMax && (
              <div data-testid="sell-summary-strip" style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                  <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVI ? 'Còn lại sau giao dịch' : 'Remaining after transaction'}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{fmtVND(Math.max(0, maxAmount - numAmount), locale)}</span>
                </div>
                {gainLoss != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: taxAmount ? '1px solid var(--c-line)' : 'none' }}>
                    <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVI ? 'Lãi/Lỗ ước tính' : 'Est. gain / loss'}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: gainLoss >= 0 ? 'var(--c-pos, #16a34a)' : 'var(--c-neg, #dc2626)' }}>
                      {gainLoss >= 0 ? '+' : ''}{fmtVND(gainLoss, locale)}
                    </span>
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

            {/* Bank summary: principal portion / received / gain-loss / remaining */}
            {isBank && numAmount > 0 && !isOverMax && numReceived > 0 && (
              <div data-testid="sell-summary-strip" style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
                <div data-testid="sell-bank-principal" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                  <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVI ? 'Tiền gốc' : 'Principal'}{bankPct < 0.999 && <span style={{ opacity: 0.7 }}> · {Math.round(bankPct * 100)}%</span>}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{fmtVND(bankPreview.principal, locale)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                  <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVI ? 'Số tiền thực nhận' : "Amount you'll receive"}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{fmtVND(numReceived, locale)}</span>
                </div>
                {bankGain != null && (
                  <div data-testid="sell-bank-gain" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--c-line)' }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{isVI ? 'Lãi/Lỗ' : 'Gain / Loss'}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: bankGain >= 0 ? 'var(--c-pos, #16a34a)' : 'var(--c-neg, #dc2626)' }}>{bankGain >= 0 ? '+' : '−'}{fmtVND(Math.abs(bankGain), locale)}</span>
                  </div>
                )}
                {/* Remaining PRINCIPAL — what the next withdrawal is capped
                    against, and what depositValuation reduces. */}
                <div data-testid="sell-bank-remaining" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                  <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVI ? 'Tiền gốc còn lại' : 'Remaining principal'}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{fmtVND(bankPreview.remainingPrincipal, locale)}</span>
                </div>
              </div>
            )}
            </>
            ) : (
            <>
            {/* Gold: quantity (chỉ) to sell */}
            <div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{isVI ? 'Số lượng bán' : 'Quantity to sell'}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: `1.5px solid ${isOverUnits ? 'var(--c-neg, #dc2626)' : 'var(--c-navy, #1e3a5f)'}`, borderRadius: 10 }}>
                  <input
                    data-testid="sell-gold-qty-input"
                    type="text"
                    inputMode="decimal"
                    value={formatDecimalVN(units)}
                    onChange={e => { setUnits(parseDecimalVN(e.target.value)); setError('') }}
                    placeholder="0,00"
                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, background: 'transparent', color: isOverUnits ? 'var(--c-neg, #dc2626)' : 'var(--c-ink)' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>chỉ</span>
                </div>
                <button data-testid="sell-all-btn" onClick={handleSetAll} style={{ padding: '8px 12px', background: 'var(--c-navy-tint, #e8edf3)', color: 'var(--c-navy, #1e3a5f)', border: '1px solid var(--c-navy-tint, #e8edf3)', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {isVI ? 'Tất cả' : 'All'}
                </button>
              </div>
              {isOverUnits && (
                <div style={{ fontSize: 11, color: 'var(--c-neg, #dc2626)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <X size={12} strokeWidth={2.5} />
                  {isVI ? 'Vượt quá số lượng đang giữ' : 'Exceeds quantity held'} · {isVI ? 'Tối đa' : 'Max'} {goldMaxUnits} chỉ
                </div>
              )}
            </div>

            {/* Gold: sale price per chỉ (prefilled with current market price) */}
            <div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{isVI ? 'Giá bán mỗi chỉ' : 'Sale price per chỉ'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10 }}>
                <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                <input
                  data-testid="sell-gold-price-input"
                  type="text"
                  inputMode="numeric"
                  value={formatIntVN(salePrice)}
                  onChange={e => { setSalePrice(parseIntVN(e.target.value)); setError('') }}
                  placeholder="0"
                  style={{ flex: 1, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, background: 'transparent', color: 'var(--c-ink)' }}
                />
                <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>/chỉ</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>
                {isVI ? 'Tạm tính theo giá hiện tại — sửa theo giá bạn bán được' : 'Pre-filled at current price — edit to what you can sell for'}
              </div>
            </div>

            {/* Gold summary: proceeds / cost / P&L / remaining */}
            {numUnits > 0 && !isOverUnits && numSalePrice > 0 && (
              <div data-testid="sell-summary-strip" style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                  <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVI ? 'Tổng tiền nhận được' : 'Total received'}<span style={{ opacity: 0.7 }}> · {numUnits.toLocaleString('vi-VN')} chỉ × {fmtVND(numSalePrice, locale)}</span></span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{fmtVND(goldProceeds, locale)}</span>
                </div>
                {goldCostSold != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                    <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVI ? 'Giá vốn' : 'Your cost'}{goldBuyUnit != null && <span style={{ opacity: 0.7 }}> · {numUnits.toLocaleString('vi-VN')} chỉ × {fmtVND(goldBuyUnit, locale)}</span>}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{fmtVND(goldCostSold, locale)}</span>
                  </div>
                )}
                {goldProfit != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--c-line)' }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{isVI ? 'Lãi/Lỗ' : 'Profit / Loss'}</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: goldProfit >= 0 ? 'var(--c-pos, #16a34a)' : 'var(--c-neg, #dc2626)' }}>{goldProfit >= 0 ? '+' : '−'}{fmtVND(Math.abs(goldProfit), locale)}</span>
                  </div>
                )}
                {goldRemUnits != null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                    <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVI ? 'Còn lại sau giao dịch' : 'Remaining after transaction'}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{Math.max(0, goldRemUnits).toLocaleString('vi-VN')} chỉ</span>
                  </div>
                )}
              </div>
            )}
            </>
            )}

            {/* Count toward goal progress — only when withdrawing from a goal.
                Keyed off the VALUE released (see bankValueReleased), which is what
                the goal actually loses once the holding is revalued. */}
            {context === 'goal' && (
              <AffectsProgressControl
                checked={affectsProgress}
                onChange={setAffectsProgress}
                isVi={isVI}
                currentValue={goalCurrentValue ?? 0}
                targetAmount={goalTargetAmount ?? null}
                withdrawnValue={isGold ? goldProceeds : isBank ? bankValueReleased : numAmount}
              />
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
                  // Keep the active (red) look while saving so the loader stays
                  // legible and the button reads as "processing", not disabled.
                  background: (isValid || saving) ? 'var(--c-neg, #dc2626)' : 'var(--c-line)',
                  color: (isValid || saving) ? '#fff' : 'var(--c-muted)',
                  border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  cursor: isValid ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'background 120ms, color 120ms',
                }}
              >
                {saving
                  ? <CairnLoader size={14} variant="on-dark" />
                  : isBank ? <ArrowDownToLine size={15} strokeWidth={2.2} /> : <ArrowDownRight size={15} strokeWidth={2.2} />}
                {(isGold ? numUnits <= 0 : numAmount <= 0)
                  ? (isVI
                      ? (isBank ? 'Nhập số tiền gốc rút' : isGold ? 'Nhập số lượng bán' : 'Nhập số tiền bán')
                      : (isBank ? 'Enter principal to withdraw' : isGold ? 'Enter quantity to sell' : 'Enter sale amount'))
                  : (isGold && numSalePrice <= 0)
                  ? (isVI ? 'Nhập giá bán' : 'Enter sale price')
                  : isOverMax
                  ? (isVI
                      ? (isGold ? 'Vượt quá số lượng' : isBank ? 'Vượt quá tiền gốc' : 'Vượt quá số dư')
                      : (isGold ? 'Exceeds quantity' : isBank ? 'Exceeds principal' : 'Exceeds balance'))
                  : (isBank && numReceived <= 0)
                  ? (isVI ? 'Nhập số tiền thực nhận' : 'Enter amount received')
                  : saving
                  ? (isVI ? 'Đang xử lý…' : 'Processing…')
                  : confirmLabel}
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
