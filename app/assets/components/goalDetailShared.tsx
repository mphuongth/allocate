// Shared helpers for the goal-detail views (GoalDetailSheet on mobile,
// DesktopGoalDetail on desktop). Both render the same data with different
// chrome, so the icons, colours, deadline math and — most importantly — the
// investment-row valuation live here to stay in sync.

import { useState, type CSSProperties } from 'react'
import { TrendingUp, Building, Coins, BarChart2, Target, RefreshCw, Plus } from 'lucide-react'
import { fmtCompact } from '@/lib/formatters'
import { formatIntVN, parseIntVN, formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'
import { fmtTxDate } from './transactionUtils'
import { fmtMaturity, type Maturity } from './goalDetailMaturity'
import type { FundBreakdownItem } from '../DashboardClient'

export const GD_COLORS: Record<string, string> = {
  fund: '#2563eb',
  bank: '#047857',
  gold: 'var(--c-fund-gold)',
  stock: '#7c3aed',
}

export interface CompositionSeg { label: string; value: number; color: string }



export function TypeIcon({ type, size = 16 }: { type: string; size?: number }) {
  if (type === 'fund') return <TrendingUp size={size} />
  if (type === 'bank') return <Building size={size} />
  if (type === 'gold') return <Coins size={size} />
  return <BarChart2 size={size} />
}

// The design's "unlink" glyph, used by the unassign-from-goal affordance.
export function UnlinkSvg({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <path d="M2 2l20 20" />
    </svg>
  )
}

// iOS-style toggle, mirroring the redesign's Switch primitive.
function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const w = 42, h = 24, knob = h - 4
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid="affects-progress-switch"
      onClick={() => onChange(!checked)}
      style={{
        width: w, height: h, flexShrink: 0, padding: 2, border: 'none', borderRadius: 999,
        background: checked ? 'var(--c-btn-primary)' : 'var(--c-line-strong, #cbd5e1)',
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', transition: 'background 180ms ease',
      }}
    >
      <span style={{
        width: knob, height: knob, borderRadius: 999, background: '#fff',
        boxShadow: '0 1px 3px rgba(15,23,42,0.3)',
        transform: checked ? `translateX(${w - knob - 4}px)` : 'translateX(0)',
        transition: 'transform 180ms cubic-bezier(0.2,0.8,0.2,1)',
      }} />
    </button>
  )
}

// "Count toward goal progress" toggle + a live progress-impact preview, shown
// only when withdrawing from within a goal. Default ON: the withdrawal lowers
// the goal's tracked progress. OFF (affects_progress=false) is for rebalancing —
// the holding still leaves (net worth falls), but progress is held steady. It is
// NOT a within-goal transfer: proceeds route to Unallocated, so re-buying them
// into the same goal double-counts the bar (issue #342). The preview animates
// current% → resulting% so the consequence is visible before confirming.
export function AffectsProgressControl({
  checked, onChange, isVi, currentValue, targetAmount, withdrawnValue = 0,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  isVi: boolean
  currentValue: number
  targetAmount: number | null
  withdrawnValue?: number
}) {
  const t = isVi ? {
    label: 'Tính vào tiến độ mục tiêu',
    on: 'Khoản rút này sẽ làm giảm tiến độ của mục tiêu.',
    off: 'Tiến độ giữ nguyên — khoản tiền vẫn rời mục tiêu nhưng vẫn được tính vào tiến độ.',
    title: 'Tiến độ mục tiêu', unchanged: 'Giữ nguyên', offGoalValue: 'khỏi giá trị mục tiêu',
  } : {
    label: 'Count toward goal progress',
    on: 'This withdrawal lowers your tracked progress for this goal.',
    off: 'Progress stays the same — the money still leaves, but it keeps counting toward this goal.',
    title: 'Goal progress', unchanged: 'Unchanged', offGoalValue: 'off goal value',
  }

  const hasTarget = targetAmount != null && targetAmount > 0
  const target = targetAmount ?? 0
  const curPct = hasTarget ? Math.min(100, Math.max(0, (currentValue / target) * 100)) : 0
  const afterVal = Math.max(0, currentValue - (withdrawnValue || 0))
  const afterPct = hasTarget ? Math.min(100, Math.max(0, (afterVal / target) * 100)) : 0
  const fillPct = checked ? afterPct : curPct
  const willDrop = checked && (curPct - afterPct) > 0.05
  const drop = Math.min(currentValue, withdrawnValue || 0)

  return (
    <div data-testid="affects-progress-control" style={{ border: '1px solid var(--c-line)', borderRadius: 12, overflow: 'hidden', background: 'var(--c-card)' }}>
      {/* Toggle row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--c-navy-tint)', color: 'var(--c-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Target size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{t.label}</div>
          <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, lineHeight: 1.45 }}>{checked ? t.on : t.off}</div>
        </div>
        <Switch checked={checked} onChange={onChange} />
      </div>

      {/* Live progress-impact preview */}
      {hasTarget && (
        <div style={{ borderTop: '1px solid var(--c-line)', background: 'var(--c-card-2)', padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)' }}>{t.title}</span>
            <span style={{ fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ color: 'var(--c-ink)' }}>{Math.round(curPct)}%</span>
              {willDrop && (<>
                <span style={{ color: 'var(--c-muted)' }}>→</span>
                <span style={{ color: afterPct >= 100 ? 'var(--c-pos)' : 'var(--c-neg)' }}>{Math.round(afterPct)}%</span>
              </>)}
              {!checked && <span style={{ color: 'var(--c-muted)', fontWeight: 500 }}>· {t.unchanged}</span>}
            </span>
          </div>
          <div style={{ position: 'relative', height: 8, marginTop: 8, borderRadius: 999, background: 'var(--c-card)', border: '1px solid var(--c-line)', overflow: 'hidden' }}>
            {/* Faded slice being relinquished, shown only when progress drops */}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${curPct}%`, background: willDrop ? 'var(--c-neg-tint)' : 'transparent' }} />
            {/* Solid resulting progress */}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${fillPct}%`, background: fillPct >= 100 ? 'var(--c-pos)' : 'var(--c-navy)', borderRadius: 999, transition: 'width 320ms ease' }} />
          </div>
          {willDrop && (
            <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 6 }}>−{fmtCompact(drop)} {t.offGoalValue}</div>
          )}
        </div>
      )}
    </div>
  )
}

// Net worth (currentValue) and the goal bar (progressValue) decoupled once
// affects_progress=false withdrawals were introduced: such a withdrawal lowers
// net worth but is added back to progress, so the bar holds steady while the
// value held drops. On a card that shows both, the bar then reads fuller than
// the value — this caption reconciles them by naming the credited-but-withdrawn
// amount (progressValue − currentValue). Renders nothing when they agree.
//
// Honest-copy note (mirrors AffectsProgressControl): the money was withdrawn and
// is NOT still held — it just still counts toward the goal. The wording says so
// rather than implying a transfer.
export function progressCredit(currentValue: number, progressValue: number | undefined): number {
  if (progressValue == null) return 0
  return Math.max(0, Math.round(progressValue) - Math.round(currentValue))
}

export function ProgressCreditNote({ amount, isVi, style }: { amount: number; isVi: boolean; style?: CSSProperties }) {
  if (!(amount > 0)) return null
  const text = isVi
    ? `Gồm ${fmtCompact(amount)} đã rút nhưng vẫn tính vào mục tiêu`
    : `Includes ${fmtCompact(amount)} withdrawn that still counts toward this goal`
  return (
    <p data-testid="progress-credit-note" style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.4, margin: 0, ...style }}>
      {text}
    </p>
  )
}

// Calculator counterpart to ProgressCreditNote. The savings calculator's "still
// needed" runs off net worth (you have to gather money you actually hold), while
// the bar runs off progressValue. So the bar can read "complete" while the
// calculator still shows a shortfall — this note explains that the shortfall
// reflects the already-withdrawn amount the progress bar still counts. Renders
// nothing when the two axes agree.
export function ProgressGatherNote({ amount, isVi, style }: { amount: number; isVi: boolean; style?: CSSProperties }) {
  if (!(amount > 0)) return null
  const text = isVi
    ? `Tiến độ đã gồm ${fmtCompact(amount)} bạn đã rút; ước tính này tính trên tiền đang giữ nên vẫn còn thiếu.`
    : `Progress counts ${fmtCompact(amount)} you withdrew; this estimate is based on what you still hold, so a gap remains.`
  return (
    <p data-testid="progress-gather-note" style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.4, margin: 0, ...style }}>
      {text}
    </p>
  )
}

export interface InvRow {
  id: string
  name: string
  type: string
  value: number
  gainPct: number | null
  units: number | null
  principal: number | null
  interestRate: number | null
  // Bank deposit maturity (YYYY-MM-DD); null for non-bank holdings or no term.
  expiryDate: string | null
  // When the (current) cycle was opened — used to derive the original term
  // length on renewal. null for fund holdings.
  investmentDate: string | null
  fund: FundBreakdownItem | null
  // Set for an accumulating ("Loại 2") book — the deposit_group_id its tranches
  // share. Keeps the whole book out of the single-row term renew path and tells
  // the UI to offer a top-up. null for term / one-off holdings.
  depositGroupId?: string | null
  // Structured bank reference (FK to banks.code) for a bank deposit; null for a
  // non-bank holding or a deposit with no bank set yet. Drives the multi-source
  // merge destination-bank default and the "N nguồn · M ngân hàng" provenance.
  bankCode?: string | null
  // Currency (default 'VND') + collateral flag. Carried for the merge eligibility
  // rules ("same currency" / "not pledged"). null/false on legacy deposits.
  currency?: string | null
  isPledged?: boolean | null
  // The book's tranches (top-ups), newest first, for the detail view. Each is one
  // underlying row; present only on an accumulating book row.
  tranches?: InvTranche[] | null
}

// One top-up of an accumulating book: an underlying investment_transactions row,
// already net of any withdrawal parented to it.
export interface InvTranche {
  id: string
  date: string
  amount: number
  rate: number | null
  value: number
}

// Minimal shape buildInvRows needs — both views' richer InvestmentTx types
// are structurally assignable to this.
export interface GoalDetailTx {
  transaction_id: string
  transaction_type: string
  asset_type: string
  fund_id: string | null
  parent_transaction_id: string | null
  investment_date: string
  amount_vnd: number
  units: number | null
  interest_rate: number | null
  expiry_date?: string | null
  notes: string | null
  principal_withdrawn: number | null
  units_withdrawn: number | null
  // Set on a renewal history snapshot (a closed past cycle) — excluded from
  // active holdings and every valuation. null/undefined for live rows.
  renewed_from_transaction_id?: string | null
  // Realized interest the user recorded for a closed cycle (snapshot rows only).
  // null = not recorded for that cycle (don't treat as 0).
  interest_earned_vnd?: number | null
  // Accumulating book grouping: set on every tranche of a book (anchor row's =
  // its own transaction_id). null/undefined for term / one-off holdings.
  deposit_group_id?: string | null
  // Structured bank reference (FK to banks.code); null until the user sets it.
  bank_code?: string | null
  // Currency (default 'VND') + collateral flag for the merge eligibility rules.
  // null/false on legacy deposits.
  currency?: string | null
  is_pledged?: boolean | null
}

// Roll up a deposit's renewal history from the snapshot rows that point at it.
// Returns null when it has never been renewed. `complete` is false when any
// cycle's interest wasn't recorded (null), so callers can show a "≥" rather than
// silently understating the total.
//
// COUPLING: this matches snapshots by `renewed_from_transaction_id === activeTxId`,
// which is correct only because renewal overwrites the deposit IN PLACE (the
// active row keeps its id across cycles — see the /renew route). If renewal ever
// switches to a new-row-per-cycle model, the snapshots would point at differing
// ids and this lookup would silently miss earlier cycles — revisit it then.
export interface RenewalSummary { count: number; totalInterestVnd: number; complete: boolean }


// Bank-deposit info strip shown in the investment Options modal: interest rate,
// maturity date and time-left. Renders nothing for non-bank holdings or when
// there's no info to show (issue #263). Shared so desktop + mobile stay in sync.
export function BankInfoStrip({ inv, isVi }: { inv: InvRow; isVi: boolean }) {
  if (inv.type !== 'bank') return null
  // An accumulating book shows the amount-weighted "Avg rate" + total accumulated
  // and its top-up history, instead of a single rate + time-left.
  const acc = inv.tranches && inv.tranches.length > 0 ? inv.tranches : null
  const m = fmtMaturity(inv.expiryDate, isVi)
  const cells: { l: string; v: string; tone?: Maturity['tone'] }[] = []
  if (inv.interestRate != null) {
    const rate = Math.round(inv.interestRate * 10) / 10
    cells.push({ l: acc ? (isVi ? 'Lãi suất TB' : 'Avg rate') : (isVi ? 'Lãi suất' : 'Interest rate'), v: `${rate}%/${isVi ? 'năm' : 'yr'}` })
  }
  if (m) {
    cells.push({ l: isVi ? 'Ngày đáo hạn' : 'Maturity', v: m.formatted })
    if (!acc) cells.push({ l: isVi ? 'Còn lại' : 'Time left', v: m.relative, tone: m.tone })
  }
  if (acc) cells.push({ l: isVi ? 'Tổng tích luỹ' : 'Accumulated', v: fmtCompact(inv.principal ?? 0) })
  if (!cells.length && !acc) return null

  return (
    <>
      {cells.length > 0 && (
        <div data-testid="bank-info-strip" style={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length}, 1fr)`, gap: 1, background: 'var(--c-line)', borderRadius: 10, overflow: 'hidden', marginBottom: 4 }}>
          {cells.map((c, i) => {
            const color = c.tone === 'neg' ? 'var(--c-neg)' : c.tone === 'warn' ? 'var(--c-warn)' : c.tone === 'pos' ? 'var(--c-pos)' : 'var(--c-ink)'
            return (
              <div key={i} style={{ background: 'var(--c-card)', padding: '8px 10px' }}>
                <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{c.l}</div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color, fontVariantNumeric: 'tabular-nums' }}>{c.v}</div>
              </div>
            )
          })}
        </div>
      )}
      {acc && (
        <div data-testid="tranche-history" style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 10, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, margin: '2px 2px 4px' }}>
            {isVi ? 'Lịch sử nạp' : 'Top-up history'}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {acc.map((tr) => (
              <div key={tr.id} data-testid="tranche-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '6px 10px', background: 'var(--c-card-2)', borderRadius: 8 }}>
                <span style={{ color: 'var(--c-muted)' }}>{fmtTxDate(tr.date, isVi ? 'vi' : 'en')}</span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtCompact(tr.amount)}</span>
                  {tr.rate != null && <span style={{ fontSize: 10, color: 'var(--c-muted)' }}>{tr.rate}%/{isVi ? 'năm' : 'yr'}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// Self-contained "Top up" control for an accumulating book: a button that opens
// a small modal to add a tranche (amount + this slice's rate + date). Posts a new
// investment_transactions row linked to the book via tops_up_deposit_id; the
// route inherits the book's goal + maturity. Renders nothing for non-books.
export function TopUpControl({ inv, isVi, onDone }: { inv: InvRow; isVi: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState(inv.interestRate != null ? String(Math.round(inv.interestRate * 10) / 10) : '')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  if (!inv.depositGroupId) return null

  const amt = Number(amount)
  async function submit() {
    if (!(amt > 0)) { setError(isVi ? 'Cần nhập số tiền' : 'Amount is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/v1/investment-transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tops_up_deposit_id: inv.id, asset_type: 'bank', investment_date: date, amount_vnd: Math.round(amt), interest_rate: rate ? Number(rate) : null }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? (isVi ? 'Lỗi' : 'Error')); setSaving(false); return }
      setOpen(false); setAmount(''); onDone()
    } catch { setError(isVi ? 'Lỗi kết nối' : 'Connection error') } finally { setSaving(false) }
  }

  const field: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 15, fontWeight: 600, background: 'var(--c-canvas,#faf9f7)', border: '1.5px solid var(--c-line)', borderRadius: 10, color: 'var(--c-ink)', outline: 'none', fontVariantNumeric: 'tabular-nums' }
  const lbl: CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6, display: 'block' }

  return (
    <>
      <button type="button" data-testid="top-up-btn" onClick={() => setOpen(true)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--c-line)', background: 'var(--c-card)', color: 'var(--c-navy)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 4 }}>
        <Plus size={14} strokeWidth={2.4} />{isVi ? 'Nạp thêm' : 'Top up'}
      </button>
      {open && (
        <div onClick={() => !saving && setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} data-testid="top-up-modal" style={{ width: 380, maxWidth: '100%', background: 'var(--c-card)', borderRadius: 14, padding: 20, display: 'grid', gap: 12, boxShadow: '0 20px 50px rgba(15,23,42,0.25)' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{isVi ? 'Nạp thêm vào sổ' : 'Top up deposit'}</div>
            <div>
              <label style={lbl}>{isVi ? 'Số tiền nạp (₫)' : 'Top-up amount (₫)'}</label>
              <input data-testid="top-up-amount" type="text" inputMode="numeric" value={formatIntVN(amount)} onChange={(e) => setAmount(parseIntVN(e.target.value))} placeholder="2.000.000" style={field} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl}>{isVi ? 'Lãi suất lần này' : 'Rate this top-up'}</label>
                <input data-testid="top-up-rate" type="text" inputMode="decimal" value={formatDecimalVN(rate)} onChange={(e) => setRate(parseDecimalVN(e.target.value))} placeholder="3,5" style={field} />
              </div>
              <div>
                <label style={lbl}>{isVi ? 'Ngày nạp' : 'Date'}</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} />
              </div>
            </div>
            {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg)' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setOpen(false)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--c-line)', background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>{isVi ? 'Huỷ' : 'Cancel'}</button>
              <button type="button" data-testid="top-up-submit" onClick={submit} disabled={saving || !(amt > 0)} style={{ flex: 2, padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--c-btn-primary)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', opacity: saving || !(amt > 0) ? 0.6 : 1 }}>{isVi ? 'Nạp thêm' : 'Top up'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// "Renewed N× · total interest received X" line for a deposit that has renewal
// history. Shown in the holding Options modal (mobile + desktop). When a cycle's
// interest wasn't recorded the total is prefixed with ≥ rather than understated;
// the interest clause is dropped entirely when nothing is recorded.
export function RenewalSummaryLine({ summary, isVi }: { summary: RenewalSummary | null; isVi: boolean }) {
  if (!summary) return null
  const count = isVi ? `Đã tái tục ${summary.count} lần` : `Renewed ${summary.count}×`
  let interest = ''
  if (summary.totalInterestVnd > 0) {
    const v = `${summary.complete ? '' : '≥ '}${fmtCompact(summary.totalInterestVnd)}`
    interest = isVi ? ` · tổng lãi đã nhận ${v}` : ` · total interest ${v}`
  }
  return (
    <div data-testid="renewal-summary" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--c-card-2)', borderRadius: 10, fontSize: 12, color: 'var(--c-muted)', marginBottom: 4 }}>
      <RefreshCw size={13} style={{ flexShrink: 0 }} />
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{count}{interest}</span>
    </div>
  )
}
