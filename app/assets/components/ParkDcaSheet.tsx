'use client'

// "Gửi tiết kiệm thay": this month's DCA for a fund goes into a new term
// deposit instead of buying the fund — when deposit rates are high — to move
// into the fund at maturity (move_deposit_to_fund). The Plan page's DCA line
// opens this with the DCA amount; the user names the bank, rate and term. One
// POST to the park route (park_dca_lines_in_deposit) files the deposit under
// this month and the DCA's goal, and marks the line parked — together, or none
// of it.
//
// One real deposit often carries several small DCAs: the goal's other DCA
// lines still waiting to be bought are offered, and the amount follows the
// pick until the user types one of their own.

import { useEffect, useState, type CSSProperties } from 'react'
import { formatIntVN, parseIntVN, formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'
import DialogShell from '@/components/ui/DialogShell'
import PendingButton from '@/components/ui/PendingButton'
import { todayIso, addMonths } from '@/lib/dates'

interface ParkDcaLine {
  fundId: string
  fundName: string
  amount: number
}

export interface ParkDcaTarget extends ParkDcaLine {
  planId: string
  // The goal's other DCA lines that can go into the same deposit.
  others?: ParkDcaLine[]
}

const DEFAULT_TERM_MONTHS = 6

const field: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 16, fontWeight: 600,
  background: 'var(--c-canvas,#faf9f7)', border: '1.5px solid var(--c-line)', borderRadius: 10,
  color: 'var(--c-ink)', outline: 'none', fontVariantNumeric: 'tabular-nums', fontFamily: 'inherit',
}
// The visible title is the dialog's accessible name, so the two cannot drift.
const TITLE_ID = 'park-dca-title'
const lbl: CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6, display: 'block' }

export default function ParkDcaSheet({
  target, isVi, onClose, onDone,
}: {
  target: ParkDcaTarget | null
  isVi: boolean
  onClose: () => void
  // The names of the funds whose DCA went into the deposit.
  onDone: (fundNames: string[]) => void
}) {
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([])
  const [bankCode, setBankCode] = useState('')
  const [amount, setAmount] = useState('')
  // Typed by the user: the pick no longer rewrites it.
  const [amountTouched, setAmountTouched] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [rate, setRate] = useState('')
  const [term, setTerm] = useState(String(DEFAULT_TERM_MONTHS))
  const [date, setDate] = useState(() => todayIso())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Re-seed the form whenever a new DCA line opens it.
  useEffect(() => {
    if (!target) return
    setAmount(String(target.amount))
    setAmountTouched(false)
    setPicked([])
    setRate('')
    setTerm(String(DEFAULT_TERM_MONTHS))
    setDate(todayIso())
    setError('')
  }, [target])

  useEffect(() => {
    if (!target) return
    let cancelled = false
    fetch('/api/v1/banks')
      .then((r) => (r.ok ? r.json() : []))
      .then((d: unknown) => { if (!cancelled) setBanks(Array.isArray(d) ? d as { code: string; name: string }[] : []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [target])

  if (!target) return null
  const others = target.others ?? []
  const pickedLines = others.filter((o) => picked.includes(o.fundId))
  const lineCount = 1 + pickedLines.length

  function togglePick(fundId: string) {
    if (!target) return
    const next = picked.includes(fundId) ? picked.filter((f) => f !== fundId) : [...picked, fundId]
    setPicked(next)
    if (!amountTouched) {
      const extra = (target.others ?? []).filter((o) => next.includes(o.fundId)).reduce((sum, o) => sum + o.amount, 0)
      setAmount(String(target.amount + extra))
    }
  }

  const amt = Number(amount)
  const rateNum = Number(rate)
  const termNum = Number(term)
  const maturity = termNum > 0 ? addMonths(date, termNum) : ''
  const ready = amt > 0 && rateNum > 0 && termNum > 0 && !!date

  async function submit() {
    if (!target || !ready) return
    setSaving(true); setError('')
    try {
      const bank = banks.find((b) => b.code === bankCode)
      const res = await fetch(`/api/v1/monthly-plans/${target.planId}/dca-skips/park`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fund_ids: [target.fundId, ...pickedLines.map((o) => o.fundId)],
          amount_vnd: Math.round(amt),
          interest_rate: rateNum,
          investment_date: date,
          expiry_date: maturity,
          bank_code: bankCode || null,
          // The deposit is named for its bank, as the add-transaction form does.
          notes: bank?.name ?? null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? (isVi ? 'Không gửi được' : 'Could not park the DCA'))
        setSaving(false)
        return
      }
      onDone([target.fundName, ...pickedLines.map((o) => o.fundName)]); onClose()
    } catch { setError(isVi ? 'Lỗi kết nối' : 'Connection error') } finally { setSaving(false) }
  }

  return (
    <DialogShell
      onClose={onClose}
      // A save in flight owns the sheet: a stray click outside must not discard
      // a form that is already writing.
      dismissOnClickAway={!saving}
      labelledBy={TITLE_ID}
      overlayStyle={{ zIndex: 340, padding: 24 }}
      panelStyle={{ width: 400, maxWidth: '100%', background: 'var(--c-card)', borderRadius: 14, padding: 20, display: 'grid', gap: 12, boxShadow: '0 20px 50px rgba(15,23,42,0.25)' }}
      panelProps={{ 'data-testid': 'park-dca-modal' }}
    >
      <div>
        <div id={TITLE_ID} style={{ fontSize: 15, fontWeight: 700 }}>{isVi ? 'Gửi tiết kiệm thay' : 'Park in a deposit instead'}</div>
        <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2, lineHeight: 1.45 }}>
          {lineCount > 1
            ? (isVi
              ? `DCA tháng này của ${lineCount} quỹ vào một sổ có kỳ hạn. Khi đáo hạn, gốc + lãi có thể chia lại vào các quỹ.`
              : `This month's DCA for ${lineCount} funds goes into one term deposit. At maturity, principal + interest can be split back into the funds.`)
            : (isVi
              ? `DCA ${target.fundName} tháng này vào sổ có kỳ hạn. Khi đáo hạn, gốc + lãi có thể chuyển vào ${target.fundName}.`
              : `This month's ${target.fundName} DCA goes into a term deposit. At maturity, principal + interest can move into ${target.fundName}.`)}
        </div>
      </div>
      <div>
        <label htmlFor="park-dca-bank" style={lbl}>{isVi ? 'Ngân hàng' : 'Bank'}</label>
        <select id="park-dca-bank" data-testid="park-dca-bank" value={bankCode} onChange={(e) => setBankCode(e.target.value)} style={field}>
          <option value="">{isVi ? '— Chọn ngân hàng —' : '— Choose a bank —'}</option>
          {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
      </div>
      {others.length > 0 && (
        <div data-testid="park-dca-others">
          <div style={lbl}>{isVi ? 'Gộp thêm DCA khác cùng mục tiêu' : "Add the goal's other DCAs"}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {others.map((o) => (
              <label key={o.fundId} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', border: '1px solid var(--c-line)', borderRadius: 10, fontSize: 13, color: 'var(--c-ink)', cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.includes(o.fundId)} onChange={() => togglePick(o.fundId)}
                  style={{ accentColor: 'var(--c-navy)', width: 16, height: 16, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>{o.fundName}</span>
                <span style={{ color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' }}>{formatIntVN(String(o.amount))}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div>
        <label htmlFor="park-dca-amount" style={lbl}>{isVi ? 'Số tiền gửi (₫)' : 'Amount (₫)'}</label>
        <input id="park-dca-amount" data-testid="park-dca-amount" type="text" inputMode="numeric"
          value={formatIntVN(amount)} onChange={(e) => { setAmount(parseIntVN(e.target.value)); setAmountTouched(true) }} style={field} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label htmlFor="park-dca-rate" style={lbl}>{isVi ? 'Lãi suất (%/năm)' : 'Rate (%/yr)'}</label>
          <input id="park-dca-rate" data-testid="park-dca-rate" type="text" inputMode="decimal" placeholder="6,5"
            value={formatDecimalVN(rate)} onChange={(e) => setRate(parseDecimalVN(e.target.value))} style={field} />
        </div>
        <div>
          <label htmlFor="park-dca-term" style={lbl}>{isVi ? 'Kỳ hạn (tháng)' : 'Term (months)'}</label>
          <input id="park-dca-term" data-testid="park-dca-term" type="text" inputMode="numeric"
            value={term} onChange={(e) => setTerm(e.target.value.replace(/\D/g, ''))} style={field} />
        </div>
      </div>
      <div>
        <label htmlFor="park-dca-date" style={lbl}>{isVi ? 'Ngày gửi' : 'Opened on'}</label>
        <input id="park-dca-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} />
        {maturity && (
          <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>
            {isVi ? `Đáo hạn ${maturity}` : `Matures ${maturity}`}
          </div>
        )}
      </div>
      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--c-line)', background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>{isVi ? 'Huỷ' : 'Cancel'}</button>
        {/* Not dimmed while saving: the button keeps its filled navy so the
            loader stays legible and it reads as "processing", not disabled. */}
        <PendingButton
          pending={saving}
          pendingLabel={isVi ? 'Đang xử lý...' : 'Processing...'}
          data-testid="park-dca-submit"
          onClick={submit}
          disabled={!ready}
          style={{ flex: 2, padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--c-btn-primary)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', opacity: !ready ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {isVi ? 'Gửi tiết kiệm' : 'Park in deposit'}
        </PendingButton>
      </div>
    </DialogShell>
  )
}
