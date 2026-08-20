'use client'

// The way out of a book the bank will not top up (#638): open the next one and
// put this contribution there. Everything that identifies the money — goal,
// bank, currency — comes from the old book, so the form only asks for what the
// bank decides fresh for a new deposit: its maturity and its rate.
//
// The same sheet serves both entry points. Opened from a book's own top-up
// control it just moves the contribution; opened from the monthly plan it also
// carries the recurring saving, whose month is filed and whose link moves to the
// new book in the same request.

import { useEffect, useState, type CSSProperties } from 'react'
import { formatIntVN, parseIntVN, formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'
import { fmtCompact } from '@/lib/formatters'
import DialogShell from '@/components/ui/DialogShell'
import { classifyAccumulatingTopUp } from '@/lib/accumulatingTopUp'

export interface SuccessorTarget {
  bookId: string
  bookName: string
  amount: number
  date: string
  rate: number | null
  lockDays: number | null
  /** The old book's maturity. The contribution date is editable here, and a date
   *  the old book still accepts is a top-up, not a reason to replace it. */
  sourceExpiry: string | null
  /** Set when the contribution is a recurring saving's month, not a one-off. */
  savingId?: string | null
  ym?: string | null
  planId?: string | null
}

const field: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 16, fontWeight: 600,
  background: 'var(--c-canvas,#faf9f7)', border: '1.5px solid var(--c-line)', borderRadius: 10,
  color: 'var(--c-ink)', outline: 'none', fontVariantNumeric: 'tabular-nums',
}
// The visible title is the dialog's accessible name, so the two cannot drift.
const TITLE_ID = 'successor-book-title'
const lbl: CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6, display: 'block' }

export default function SuccessorBookSheet({
  target, isVi, onClose, onDone,
}: {
  target: SuccessorTarget | null
  isVi: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [date, setDate] = useState('')
  const [expiry, setExpiry] = useState('')
  const [lockDays, setLockDays] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Re-seed whenever a new target opens. The rate is only a suggestion: a new
  // book is a new deposit, so its rate is whatever the bank quotes today.
  useEffect(() => {
    if (!target) return
    setAmount(String(target.amount))
    setRate(target.rate != null ? String(Math.round(target.rate * 10) / 10) : '')
    setDate(target.date)
    setExpiry('')
    setLockDays(target.lockDays != null ? String(target.lockDays) : '')
    setError('')
  }, [target])

  if (!target) return null
  const amt = Number(amount)
  const datesOk = !!expiry && !!date && expiry > date
  // The new book opens holding money, so it needs the rate that money earns.
  const rateOk = Number(rate) > 0
  // The date is editable, so the reason for opening a successor can evaporate
  // while the sheet is open: on a date the old book still accepts, this is an
  // ordinary top-up — and the server would refuse the handover anyway.
  const sourceStillOpen = classifyAccumulatingTopUp({
    topUpDate: date, expiryDate: target.sourceExpiry, lockDays: target.lockDays,
  }).status === 'allowed'

  async function submit() {
    if (!target) return
    if (!(amt > 0)) { setError(isVi ? 'Cần nhập số tiền' : 'Amount is required'); return }
    if (!expiry) { setError(isVi ? 'Cần nhập ngày đáo hạn của sổ mới' : "The new book's maturity is required"); return }
    if (!datesOk) { setError(isVi ? 'Ngày đáo hạn phải sau ngày nạp' : 'Maturity must come after the contribution'); return }
    if (!rateOk) { setError(isVi ? 'Cần nhập lãi suất' : 'Rate is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/v1/investment-transactions/${target.bookId}/successor`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_vnd: Math.round(amt),
          interest_rate: Number(rate),
          investment_date: date,
          expiry_date: expiry,
          top_up_lock_days: lockDays === '' ? null : Number(lockDays),
          saving_id: target.savingId ?? null,
          ym: target.ym ?? null,
          plan_id: target.planId ?? null,
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? (isVi ? 'Lỗi' : 'Error')); setSaving(false); return }
      onDone(); onClose()
    } catch { setError(isVi ? 'Lỗi kết nối' : 'Connection error') } finally { setSaving(false) }
  }

  // Record it where it actually belongs: the recurring endpoint when the month
  // came from the plan (it files the fulfillment too), the ordinary top-up
  // otherwise.
  async function topUpInstead() {
    if (!target) return
    if (!(amt > 0)) { setError(isVi ? 'Cần nhập số tiền' : 'Amount is required'); return }
    setSaving(true); setError('')
    try {
      const res = target.savingId
        ? await fetch(`/api/v1/recurring-savings/${target.savingId}/topup`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ book_id: target.bookId, amount_vnd: Math.round(amt), interest_rate: Number(rate), investment_date: date, ym: target.ym, plan_id: target.planId ?? null }),
          })
        : await fetch('/api/v1/investment-transactions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tops_up_deposit_id: target.bookId, asset_type: 'bank', investment_date: date, amount_vnd: Math.round(amt), interest_rate: rate ? Number(rate) : null }),
          })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? (isVi ? 'Lỗi' : 'Error')); setSaving(false); return }
      onDone(); onClose()
    } catch { setError(isVi ? 'Lỗi kết nối' : 'Connection error') } finally { setSaving(false) }
  }

  return (
    <DialogShell
      onClose={onClose}
      // A save in flight owns the sheet: a stray click outside must not discard
      // a form that is already writing.
      dismissOnClickAway={!saving}
      labelledBy={TITLE_ID}
      overlayStyle={{ zIndex: 330, padding: 24 }}
      panelStyle={{ width: 400, maxWidth: '100%', background: 'var(--c-card)', borderRadius: 14, padding: 20, display: 'grid', gap: 12, boxShadow: '0 20px 50px rgba(15,23,42,0.25)' }}
      panelProps={{ 'data-testid': 'successor-modal' }}
    >
        <div>
          <div id={TITLE_ID} style={{ fontSize: 15, fontWeight: 700 }}>{isVi ? 'Mở sổ kế nhiệm' : 'Open successor book'}</div>
          <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--c-muted)' }}>
            {isVi
              ? `${target.bookName} không nhận nạp thêm nữa. Khoản ${fmtCompact(target.amount)} này sẽ vào sổ mới, và sổ cũ được ghi nhận sẽ gộp vào đây khi đáo hạn.`
              : `${target.bookName} takes no more top-ups. This ${fmtCompact(target.amount)} opens the new book, and the old one is recorded as merging into it at maturity.`}
          </p>
        </div>
        <div>
          <label style={lbl}>{isVi ? 'Số tiền nạp (₫)' : 'Contribution (₫)'}</label>
          <input data-testid="successor-amount" type="text" inputMode="numeric" value={formatIntVN(amount)} onChange={(e) => setAmount(parseIntVN(e.target.value))} style={field} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={lbl}>{isVi ? 'Ngày nạp' : 'Contribution date'}</label>
            <input data-testid="successor-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} />
          </div>
          <div>
            <label style={lbl}>{isVi ? 'Đáo hạn sổ mới' : 'New maturity'}</label>
            <input data-testid="successor-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} style={field} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={lbl}>{isVi ? 'Lãi suất (%)' : 'Rate (%)'}</label>
            <input data-testid="successor-rate" type="text" inputMode="decimal" value={formatDecimalVN(rate)} onChange={(e) => setRate(parseDecimalVN(e.target.value))} placeholder="4,2" style={field} />
          </div>
          <div>
            <label style={lbl}>{isVi ? 'Khoá nạp (ngày)' : 'Lock window (days)'}</label>
            <input data-testid="successor-lock" type="text" inputMode="numeric" value={lockDays} onChange={(e) => setLockDays(e.target.value.replace(/\D/g, ''))} placeholder="30" style={field} />
          </div>
        </div>
        {sourceStillOpen && (
          <div data-testid="successor-not-needed" style={{ margin: 0, padding: '9px 10px', borderRadius: 10, background: 'var(--c-warn-tint)', color: 'var(--c-warn)', fontSize: 12, lineHeight: 1.45 }}>
            {isVi
              ? `${target.bookName} vẫn nhận nạp vào ngày này, nên đây là một lần nạp thêm chứ chưa cần sổ mới.`
              : `${target.bookName} still accepts a contribution on that date, so this is a top-up rather than a new book.`}
            <button type="button" data-testid="record-topup-instead" disabled={saving} onClick={topUpInstead}
              style={{ display: 'block', marginTop: 6, padding: 0, border: 'none', background: 'none', color: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
              {isVi ? 'Ghi thành nạp thêm vào sổ cũ' : 'Record it as a top-up instead'}
            </button>
          </div>
        )}
        {error && <p data-testid="successor-error" style={{ margin: 0, fontSize: 13, color: 'var(--c-neg)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--c-line)', background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>{isVi ? 'Huỷ' : 'Cancel'}</button>
          <button type="button" data-testid="successor-submit" onClick={submit} disabled={saving || !(amt > 0) || !datesOk || !rateOk || sourceStillOpen}
            style={{ flex: 2, padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--c-btn-primary)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', opacity: saving || !(amt > 0) || !datesOk || !rateOk || sourceStillOpen ? 0.6 : 1 }}>
            {isVi ? 'Mở sổ mới' : 'Open the new book'}
          </button>
        </div>
    </DialogShell>
  )
}
