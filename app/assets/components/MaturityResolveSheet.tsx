'use client'

// Term-deposit maturity decision flow. When a bank term deposit reaches (or
// nears) its maturity date the user must decide: renew (roll principal +
// interest, principal only, or change amount/term) or withdraw. This is the
// shared form plus a mobile bottom-sheet and a desktop modal wrapper.
//
// Renewal is a single PUT to the existing transaction: it updates the deposit
// in place (new principal / rate / maturity) and resets `investment_date` to
// today so the compound-interest valuation in buildInvRows restarts from the
// new principal — and so the PUT's future-date guard never trips when maturity
// is tomorrow. Withdrawal hands off to the existing Sell/Withdraw flow rather
// than re-implementing the payout (the parent wires `onWithdraw`).

import { useState, useEffect } from 'react'
import { RefreshCw, Pencil, ArrowDownToLine, AlertTriangle, Check, Building2, X } from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'
import { fmtMaturity, type InvRow } from './goalDetailShared'
import {
  depositMaturityState,
  addMonths,
  monthsBetween,
  renewalPrincipal,
  type RenewMode,
} from '@/lib/maturity'

type Mode = RenewMode | 'withdraw'

const todayIso = () => new Date().toISOString().slice(0, 10)

const fieldLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6,
}
const moneyInput: React.CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box',
  padding: '10px 12px', fontFamily: 'inherit', fontSize: 15,
  fontVariantNumeric: 'tabular-nums', fontWeight: 600,
  background: 'var(--c-canvas,#faf9f7)', border: '1.5px solid var(--c-line)',
  borderRadius: 10, color: 'var(--c-ink)', outline: 'none',
}

function MoneyField({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId?: string }) {
  return (
    <div>
      <div style={fieldLabel}>{label}</div>
      <div style={{ position: 'relative' }}>
        <input data-testid={testId} type="number" value={value} onChange={(e) => onChange(e.target.value)} style={moneyInput} />
        <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--c-muted)', pointerEvents: 'none' }}>₫</span>
      </div>
    </div>
  )
}

/**
 * The shared decision form. Rendered inside the mobile sheet or desktop modal.
 * `onRenewed` fires after a successful PUT; `onWithdraw` hands control to the
 * parent's existing Sell/Withdraw flow.
 */
export function MaturityResolveBody({
  inv, isVi, onClose, onRenewed, onWithdraw,
}: {
  inv: InvRow
  isVi: boolean
  onClose: () => void
  onRenewed: () => void
  onWithdraw: () => void
}) {
  const principal = inv.principal ?? inv.value ?? 0
  // Best real-data estimate of interest earned this cycle: current (compounded)
  // value minus the principal still held.
  const estInterest = Math.max(0, Math.round((inv.value ?? 0) - principal))
  const m = fmtMaturity(inv.expiryDate, isVi)
  const state = depositMaturityState(m?.diffDays ?? 0)
  const matured = state === 'matured'

  // Suggest the original term length (open date → maturity), falling back to 12
  // months when we can't derive it (no stored open date).
  const derivedTerm = inv.investmentDate && inv.expiryDate ? monthsBetween(inv.investmentDate, inv.expiryDate) : 0
  const [mode, setMode] = useState<Mode>('principal_interest')
  const [interest, setInterest] = useState(String(estInterest))
  const [term, setTerm] = useState(String(derivedTerm > 0 ? derivedTerm : 12))
  const [rate, setRate] = useState(inv.interestRate != null ? String(inv.interestRate) : '')
  const [newAmount, setNewAmount] = useState(String(principal))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<null | { newPrincipal: number; newMaturity: string }>(null)

  const iNum = Number(interest) || 0
  const tNum = Number(term) || 0
  // Pass null (not 0) for an empty "new amount" so renewalPrincipal can fall
  // back to the current principal rather than writing 0₫ to the deposit.
  const newAmountNum = newAmount.trim() === '' ? null : Number(newAmount)
  const newPrincipal = mode === 'withdraw'
    ? principal
    : renewalPrincipal(mode, principal, iNum, newAmountNum)
  // Extend from today for an already-matured deposit (so the new maturity is
  // always in the future), otherwise from the existing maturity date.
  const baseDate = matured || !inv.expiryDate ? todayIso() : inv.expiryDate
  const newMaturity = addMonths(baseDate, tNum > 0 ? tNum : 0)
  const newMaturityFmt = fmtMaturity(newMaturity, isVi)?.formatted ?? newMaturity
  const payout = principal + iNum

  // Guard against writing a zero/empty principal, a non-positive term, or
  // clearing the rate (which would drop the deposit out of maturity tracking).
  const rateValid = rate.trim() !== '' && Number(rate) > 0
  const amountValid = mode !== 'change' || (newAmount.trim() !== '' && Number(newAmount) > 0)
  const canRenew = tNum > 0 && rateValid && amountValid && newPrincipal > 0

  const t = isVi ? {
    summarySuffix: 'năm', perYr: 'năm', mo: 'tháng',
    why: matured
      ? 'Sổ đã đáo hạn. Nếu không xử lý, ngân hàng thường tự tái tục theo kỳ hạn cũ. Hãy ghi nhận quyết định của bạn.'
      : 'Sổ sắp đáo hạn. Chọn cách xử lý cho kỳ tiếp theo.',
    prompt: 'Bạn muốn làm gì?',
    newAmount: 'Số tiền kỳ mới', interestReceived: 'Lãi thực nhận',
    interestPaidOut: 'Lãi thực nhận (rút ra)',
    newTerm: 'Kỳ hạn mới', newRate: 'Lãi suất kỳ mới',
    newCycle: 'Kỳ mới', newMaturityLabel: 'Ngày đáo hạn mới',
    interestIn: 'Lãi nhập gốc', interestOut: 'Lãi rút ra',
    totalPayout: 'Tổng nhận về',
    cancel: 'Hủy', confirmRenew: 'Xác nhận tái tục', confirmWithdraw: 'Đánh dấu chờ rút',
    renewed: 'Đã tái tục', renewedSub: (p: string, d: string) => `Kỳ mới ${p} · đáo hạn ${d}`,
  } : {
    summarySuffix: 'yr', perYr: 'yr', mo: 'mo',
    why: matured
      ? 'This deposit has matured. Banks usually auto-renew at the same term — record what you decided.'
      : 'This deposit is about to mature. Choose how to handle the next cycle.',
    prompt: 'What do you want to do?',
    newAmount: 'New amount', interestReceived: 'Interest received',
    interestPaidOut: 'Interest received (paid out)',
    newTerm: 'New term', newRate: 'New interest rate',
    newCycle: 'New cycle', newMaturityLabel: 'New maturity',
    interestIn: 'Interest added', interestOut: 'Interest out',
    totalPayout: 'Total payout',
    cancel: 'Cancel', confirmRenew: 'Confirm renewal', confirmWithdraw: 'Mark for withdrawal',
    renewed: 'Deposit renewed', renewedSub: (p: string, d: string) => `New term ${p} · matures ${d}`,
  }

  const POLICIES: { id: Mode; icon: React.ReactNode; label: string; sub: string; danger?: boolean }[] = [
    { id: 'principal_interest', icon: <RefreshCw size={16} />, label: isVi ? 'Tái tục gốc + lãi' : 'Renew principal + interest', sub: isVi ? 'Cộng lãi vào gốc cho kỳ mới' : 'Roll interest into the new principal' },
    { id: 'principal_only', icon: <RefreshCw size={16} />, label: isVi ? 'Tái tục chỉ gốc' : 'Renew principal only', sub: isVi ? 'Lãi chuyển ra ngoài (về ví)' : 'Interest paid out to your wallet' },
    { id: 'change', icon: <Pencil size={16} />, label: isVi ? 'Đổi số tiền / kỳ hạn' : 'Change amount / term', sub: isVi ? 'Điều chỉnh gốc hoặc kỳ hạn kỳ mới' : 'Adjust principal or term for the new cycle' },
    { id: 'withdraw', icon: <ArrowDownToLine size={16} />, label: isVi ? 'Không tái tục — rút' : 'Don’t renew — withdraw', sub: isVi ? 'Rút toàn bộ số dư' : 'Withdraw the full balance', danger: true },
  ]

  async function handleConfirm() {
    if (mode === 'withdraw') { onClose(); setTimeout(onWithdraw, 60); return }
    if (!canRenew) return
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/v1/investment-transactions/${inv.id}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_vnd: Math.round(newPrincipal),
          interest_rate: Number(rate),
          expiry_date: newMaturity,
          // Reset the accrual base so the value calc restarts from the new
          // principal and the future-date guard never trips. The route rolls the
          // active row forward in place and appends a history snapshot of the
          // cycle that just closed.
          investment_date: todayIso(),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? (isVi ? 'Không thể tái tục' : 'Could not renew'))
        setSaving(false)
        return
      }
      setDone({ newPrincipal: Math.round(newPrincipal), newMaturity })
      setTimeout(() => { onRenewed(); onClose() }, 1700)
    } catch {
      setError(isVi ? 'Lỗi kết nối' : 'Connection error')
      setSaving(false)
    }
  }

  // ─── Success state ───
  if (done) {
    return (
      <div data-testid="maturity-renewed" style={{ padding: '24px 4px 8px', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: 'var(--c-pos-tint)', color: 'var(--c-pos)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <Check size={26} strokeWidth={2.4} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{t.renewed}</div>
        <div style={{ fontSize: 13, color: 'var(--c-muted)', marginTop: 6, lineHeight: 1.5 }}>
          {t.renewedSub(fmtCompact(done.newPrincipal), newMaturityFmt)}
        </div>
      </div>
    )
  }

  const pill = (() => {
    if (state === 'matured') {
      const n = Math.abs(m?.diffDays ?? 0)
      return { text: isVi ? (n === 0 ? 'Đã đáo hạn' : `Quá hạn ${n} ngày`) : (n === 0 ? 'Matured' : `${n}d overdue`), color: 'var(--c-neg)', bg: 'var(--c-neg-tint)' }
    }
    const n = m?.diffDays ?? 0
    return { text: isVi ? (n === 0 ? 'Đáo hạn hôm nay' : 'Đáo hạn ngày mai') : (n === 0 ? 'Matures today' : 'Matures tomorrow'), color: 'var(--c-warn)', bg: 'var(--c-warn-tint)' }
  })()

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Deposit summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--c-card-2)', borderRadius: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--c-card)', color: '#047857', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--c-line)', flexShrink: 0 }}>
          <Building2 size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.name}</div>
          <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCompact(principal)}{inv.interestRate != null ? ` · ${inv.interestRate}%/${t.perYr}` : ''}
          </div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: pill.bg, color: pill.color }}>{pill.text}</span>
      </div>

      {/* Why this needs a decision */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 13px', background: 'var(--c-warn-tint)', borderRadius: 10 }}>
        <AlertTriangle size={15} color="var(--c-warn)" strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c-warn)', lineHeight: 1.5 }}>{t.why}</p>
      </div>

      {/* Decision picker */}
      <div>
        <div style={fieldLabel}>{t.prompt}</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {POLICIES.map((p) => {
            const active = mode === p.id
            const accent = p.danger ? 'var(--c-neg)' : 'var(--c-navy)'
            const tint = p.danger ? 'var(--c-neg-tint)' : 'var(--c-navy-tint)'
            return (
              <button key={p.id} type="button" onClick={() => setMode(p.id)} style={{
                width: '100%', textAlign: 'left', padding: '11px 12px',
                background: active ? tint : 'var(--c-card)',
                border: `1.5px solid ${active ? accent : 'var(--c-line)'}`,
                borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 11, transition: 'all 120ms',
              }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: active ? 'var(--c-card)' : 'var(--c-card-2)', color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {p.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: active ? accent : 'var(--c-ink)' }}>{p.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--c-muted)', marginTop: 1, lineHeight: 1.4 }}>{p.sub}</div>
                </div>
                <div style={{ width: 18, height: 18, borderRadius: 9, border: `1.5px solid ${active ? accent : 'var(--c-line-strong)'}`, background: active ? accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {active && <Check size={11} strokeWidth={3} color="#fff" />}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Inputs per mode */}
      {mode !== 'withdraw' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {mode === 'change'
              ? <MoneyField label={t.newAmount} value={newAmount} onChange={setNewAmount} testId="maturity-new-amount" />
              : <MoneyField label={t.interestReceived} value={interest} onChange={setInterest} />}
            <div>
              <div style={fieldLabel}>{t.newTerm}</div>
              <div style={{ position: 'relative' }}>
                <input data-testid="maturity-term-input" type="number" value={term} onChange={(e) => setTerm(e.target.value)} style={moneyInput} />
                <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--c-muted)', pointerEvents: 'none' }}>{t.mo}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: mode === 'change' ? '1fr 1fr' : '1fr', gap: 10 }}>
            <div>
              <div style={fieldLabel}>{t.newRate}</div>
              <div style={{ position: 'relative' }}>
                <input type="number" step="0.1" value={rate} onChange={(e) => setRate(e.target.value)} style={moneyInput} />
                <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--c-muted)', pointerEvents: 'none' }}>%/{t.perYr}</span>
              </div>
            </div>
            {mode === 'change' && <MoneyField label={t.interestPaidOut} value={interest} onChange={setInterest} />}
          </div>

          {/* Preview */}
          <div style={{ border: '1px solid var(--c-line)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', background: 'var(--c-navy-tint)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-navy)' }}>{t.newCycle}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span data-testid="maturity-new-principal" style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-navy)', fontVariantNumeric: 'tabular-nums' }}>{fmt(newPrincipal)}</span>
                {rate !== '' && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--c-card)', color: 'var(--c-navy)' }}>{rate}%/{t.perYr}</span>}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--c-line)' }}>
              <div style={{ background: 'var(--c-card)', padding: '9px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{t.newMaturityLabel}</div>
                <div data-testid="maturity-new-date" style={{ fontSize: 13, fontWeight: 600, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{newMaturityFmt}</div>
              </div>
              <div style={{ background: 'var(--c-card)', padding: '9px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{mode === 'principal_interest' ? t.interestIn : t.interestOut}</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, color: 'var(--c-pos)', fontVariantNumeric: 'tabular-nums' }}>+{fmtCompact(iNum)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === 'withdraw' && (
        <div style={{ border: '1px solid var(--c-line)', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--c-card-2)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-muted)' }}>{t.totalPayout}</span>
          <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(payout)}</span>
        </div>
      )}

      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg)' }}>{error}</p>}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onClose} className="cn-btn ghost" style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }}>{t.cancel}</button>
        <button type="button" onClick={handleConfirm} disabled={saving || (mode !== 'withdraw' && !canRenew)} style={{
          flex: 2, justifyContent: 'center', gap: 7, padding: '10px 14px', borderRadius: 10, border: 'none',
          fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
          cursor: saving || (mode !== 'withdraw' && !canRenew) ? 'default' : 'pointer',
          opacity: saving || (mode !== 'withdraw' && !canRenew) ? 0.6 : 1, color: '#fff',
          background: mode === 'withdraw' ? 'var(--c-neg)' : 'var(--c-btn-primary)',
          display: 'flex', alignItems: 'center',
        }}>
          {mode === 'withdraw' ? <ArrowDownToLine size={14} strokeWidth={2.2} /> : <RefreshCw size={14} strokeWidth={2.2} />}
          {mode === 'withdraw' ? t.confirmWithdraw : t.confirmRenew}
        </button>
      </div>
    </div>
  )
}

// ─── Mobile bottom-sheet wrapper ───────────────────────────────────────────
export function MaturityResolveSheet({
  open, inv, isVi, onClose, onRenewed, onWithdraw,
}: {
  open: boolean
  inv: InvRow | null
  isVi: boolean
  onClose: () => void
  onRenewed: () => void
  onWithdraw: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !inv) return null
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.2)', zIndex: 170 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--c-card)', borderRadius: '16px 16px 0 0',
          padding: '0 0 env(safe-area-inset-bottom,0)', maxHeight: '92vh', overflowY: 'auto',
          animation: 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px' }} />
        <div style={{ padding: '0 16px 20px' }}>
          <h2 style={{ margin: '0 0 14px', fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>
            {isVi ? 'Xử lý đáo hạn' : 'Handle maturity'}
          </h2>
          <MaturityResolveBody inv={inv} isVi={isVi} onClose={onClose} onRenewed={onRenewed} onWithdraw={onWithdraw} />
        </div>
      </div>
    </div>
  )
}

// ─── Desktop modal wrapper ─────────────────────────────────────────────────
export function MaturityResolveModal({
  inv, isVi, onClose, onRenewed, onWithdraw,
}: {
  inv: InvRow
  isVi: boolean
  onClose: () => void
  onRenewed: () => void
  onWithdraw: () => void
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
          width: '100%', maxWidth: 460, maxHeight: 'calc(100vh - 48px)',
          background: 'var(--c-card)', borderRadius: 16,
          boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)',
          display: 'flex', flexDirection: 'column',
          animation: 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid var(--c-line)', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{isVi ? 'Xử lý đáo hạn' : 'Handle maturity'}</h3>
          <button onClick={onClose} className="cn-btn ghost" style={{ padding: 6 }} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto' }}>
          <MaturityResolveBody inv={inv} isVi={isVi} onClose={onClose} onRenewed={onRenewed} onWithdraw={onWithdraw} />
        </div>
      </div>
    </div>
  )
}
