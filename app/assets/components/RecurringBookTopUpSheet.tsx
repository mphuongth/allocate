'use client'

// Prefilled top-up sheet for a recurring saving that's linked to an accumulating
// book. The Plan page's "Saved" pill opens this with amount = the planned monthly
// amount, date = today, and rate = the book's suggested rate — a one-tap confirm
// when nothing changed, or edit the rate when the bank's rate moved this month
// (a recurring saving doesn't store a rate, and each tranche locks its own). On
// confirm it POSTs to the recurring's topup endpoint, which atomically adds the
// tranche AND marks the month fulfilled (no double-count).

import { useEffect, useState, type CSSProperties } from 'react'
import { formatIntVN, parseIntVN, formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'
import { fmtCompact } from '@/lib/formatters'

export interface BookTopUpTarget {
  savingId: string
  bookId: string
  bookName: string
  ym: string
  planId: string | null
  amount: number
  rate: number | null
}

const field: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 15, fontWeight: 600,
  background: 'var(--c-canvas,#faf9f7)', border: '1.5px solid var(--c-line)', borderRadius: 10,
  color: 'var(--c-ink)', outline: 'none', fontVariantNumeric: 'tabular-nums',
}
const lbl: CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6, display: 'block' }

export default function RecurringBookTopUpSheet({
  target, isVi, onClose, onDone,
}: {
  target: BookTopUpTarget | null
  isVi: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Re-seed the form whenever a new target opens.
  useEffect(() => {
    if (!target) return
    setAmount(String(target.amount))
    setRate(target.rate != null ? String(Math.round(target.rate * 10) / 10) : '')
    setDate(new Date().toISOString().slice(0, 10))
    setError('')
  }, [target])

  if (!target) return null
  const amt = Number(amount)

  async function submit() {
    if (!target) return
    if (!(amt > 0)) { setError(isVi ? 'Cần nhập số tiền' : 'Amount is required'); return }
    if (!(Number(rate) > 0)) { setError(isVi ? 'Cần nhập lãi suất' : 'Rate is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/v1/recurring-savings/${target.savingId}/topup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book_id: target.bookId,
          amount_vnd: Math.round(amt),
          interest_rate: Number(rate),
          investment_date: date,
          ym: target.ym,
          plan_id: target.planId,
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? (isVi ? 'Lỗi' : 'Error')); setSaving(false); return }
      onDone(); onClose()
    } catch { setError(isVi ? 'Lỗi kết nối' : 'Connection error') } finally { setSaving(false) }
  }

  return (
    <div onClick={() => !saving && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 340, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} data-testid="recurring-topup-modal" style={{ width: 380, maxWidth: '100%', background: 'var(--c-card)', borderRadius: 14, padding: 20, display: 'grid', gap: 12, boxShadow: '0 20px 50px rgba(15,23,42,0.25)' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{isVi ? 'Nạp vào sổ tích luỹ' : 'Top up accumulating book'}</div>
          <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {target.bookName} · {isVi ? 'định kỳ tháng này' : "this month's recurring"}
          </div>
        </div>
        <div>
          <label style={lbl}>{isVi ? 'Số tiền nạp (₫)' : 'Top-up amount (₫)'}</label>
          <input data-testid="recurring-topup-amount" type="text" inputMode="numeric"
            value={formatIntVN(amount)}
            onChange={(e) => setAmount(parseIntVN(e.target.value))}
            style={field} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={lbl}>{isVi ? 'Lãi suất lần này' : 'Rate this top-up'}</label>
            <input data-testid="recurring-topup-rate" type="text" inputMode="decimal" value={formatDecimalVN(rate)} onChange={(e) => setRate(parseDecimalVN(e.target.value))} placeholder="3,5" style={field} />
          </div>
          <div>
            <label style={lbl}>{isVi ? 'Ngày nạp' : 'Date'}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: -2 }}>
          {isVi ? `Gợi ý ${fmtCompact(target.amount)} theo kế hoạch — sửa lãi suất nếu kỳ này khác.` : `Suggested ${fmtCompact(target.amount)} from your plan — adjust the rate if it changed this cycle.`}
        </div>
        {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--c-line)', background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>{isVi ? 'Huỷ' : 'Cancel'}</button>
          <button type="button" data-testid="recurring-topup-submit" onClick={submit} disabled={saving || !(amt > 0)} style={{ flex: 2, padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--c-btn-primary)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', opacity: saving || !(amt > 0) ? 0.6 : 1 }}>{isVi ? 'Nạp & ghi nhận' : 'Top up & record'}</button>
        </div>
      </div>
    </div>
  )
}
