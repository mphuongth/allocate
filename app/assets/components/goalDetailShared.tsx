// Shared helpers for the goal-detail views (GoalDetailSheet on mobile,
// DesktopGoalDetail on desktop). Both render the same data with different
// chrome, so the icons, colours, deadline math and — most importantly — the
// investment-row valuation live here to stay in sync.

import type { CSSProperties } from 'react'
import { TrendingUp, Building, Coins, BarChart2, Target, RefreshCw } from 'lucide-react'
import { fmtCompact } from '@/lib/formatters'
import { calcProjectedInterest } from '@/lib/finance'
import { fmtTxDate } from './transactionUtils'
import { isTermDeposit, depositMaturityState, isMaturityActionable } from '@/lib/maturity'
import type { FundBreakdownItem } from '../DashboardClient'

export const GD_COLORS: Record<string, string> = {
  fund: '#2563eb',
  bank: '#047857',
  gold: 'var(--c-fund-gold)',
  stock: '#7c3aed',
}

export function calcDeadlineMonths(targetDate: string | null): number {
  if (!targetDate) return 12
  const [ty, tm] = targetDate.split('-').map(Number)
  const now = new Date()
  return Math.max(1, (ty - now.getFullYear()) * 12 + (tm - 1 - now.getMonth()))
}

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
export function buildRenewalSummary(transactions: GoalDetailTx[], activeTxId: string): RenewalSummary | null {
  const snaps = transactions.filter((tx) => tx.renewed_from_transaction_id === activeTxId)
  if (!snaps.length) return null
  let totalInterestVnd = 0
  let complete = true
  for (const s of snaps) {
    if (s.interest_earned_vnd == null) complete = false
    else totalInterestVnd += s.interest_earned_vnd
  }
  return { count: snaps.length, totalInterestVnd, complete }
}

// Dedup to one row per fund / per non-fund tx, then value each holding:
// funds at their current value, bank deposits at compounded interest, gold at
// the live price per chỉ, and everything else at cost — each net of any
// partial withdrawals (issues #251, #261). Holdings that have been fully
// withdrawn / sold are dropped so they no longer appear on the investment tab.
// Returns rows otherwise unfiltered — callers apply their own optimistic
// unassign filter.
export function buildInvRows(
  transactions: GoalDetailTx[],
  funds: FundBreakdownItem[],
  goldPricePerChi: number | null,
  isVi: boolean,
): InvRow[] {
  // Aggregate withdrawals onto their parent holding. Bank/gold withdrawals are
  // stored as separate `withdrawal` rows linked via parent_transaction_id, so
  // the parent investment row itself carries no withdrawn amounts — without
  // this a withdrawn deposit would still show at full value (issue #261). All
  // withdrawals count here (regardless of affects_progress): the tab shows what
  // is actually still held.
  const wdByParent = new Map<string, { principal: number; units: number }>()
  for (const tx of transactions) {
    if (tx.transaction_type === 'withdrawal' && tx.parent_transaction_id) {
      const e = wdByParent.get(tx.parent_transaction_id) ?? { principal: 0, units: 0 }
      e.principal += tx.principal_withdrawn ?? 0
      e.units += tx.units_withdrawn ?? 0
      wdByParent.set(tx.parent_transaction_id, e)
    }
  }

  // Exclude withdrawals and renewal history snapshots — only live investment
  // rows are active holdings.
  const investmentRows = transactions.filter((tx) => tx.transaction_type !== 'withdrawal' && !tx.renewed_from_transaction_id)
  const deduped = new Map<string, GoalDetailTx>()
  investmentRows.forEach((tx) => {
    if (tx.fund_id) {
      if (!deduped.has(tx.fund_id)) deduped.set(tx.fund_id, tx)
    } else {
      deduped.set(tx.transaction_id, tx)
    }
  })
  const fundMap = new Map(funds.map((f) => [f.fundId, f]))

  return Array.from(deduped.values()).map((tx): InvRow | null => {
    const fund = tx.fund_id ? fundMap.get(tx.fund_id) ?? null : null
    const name = fund?.fundName ?? tx.notes ?? (
      tx.asset_type === 'bank' ? (isVi ? 'Tiền gửi' : 'Bank deposit') :
      tx.asset_type === 'gold' ? (isVi ? 'Vàng' : 'Gold') : tx.asset_type
    )

    let value: number, gainPct: number | null, units: number | null, principal: number | null
    if (fund) {
      value = fund.currentValue
      gainPct = fund.profitLossPercentage
      units = fund.quantity
      principal = null
    } else {
      const wd = wdByParent.get(tx.transaction_id)
      const effectivePrincipal = tx.amount_vnd - (wd?.principal ?? 0)

      if (tx.asset_type === 'gold' && goldPricePerChi && tx.units) {
        const effectiveUnits = tx.units - (wd?.units ?? 0)
        if (effectiveUnits <= 0) return null // fully sold
        value = effectiveUnits * goldPricePerChi
        gainPct = effectivePrincipal > 0 ? ((value - effectivePrincipal) / effectivePrincipal) * 100 : null
        units = effectiveUnits
        principal = effectivePrincipal
      } else {
        if (effectivePrincipal <= 0) return null // fully withdrawn
        if (tx.asset_type === 'bank' && tx.interest_rate) {
          // Shared valuation: simple interest, capped at maturity (see lib/finance).
          value = Math.round(effectivePrincipal + calcProjectedInterest(effectivePrincipal, tx.interest_rate, tx.investment_date, tx.expiry_date))
          gainPct = ((value - effectivePrincipal) / effectivePrincipal) * 100
          units = null
          principal = effectivePrincipal
        } else {
          value = effectivePrincipal
          gainPct = null
          units = tx.units
          principal = effectivePrincipal
        }
      }
    }

    return { id: tx.transaction_id, name, type: tx.asset_type, value, gainPct, units, principal, interestRate: tx.interest_rate ?? null, expiryDate: tx.expiry_date ?? null, investmentDate: fund ? null : (tx.investment_date ?? null), fund: fund ?? null }
  }).filter((row): row is InvRow => row !== null)
}

// A bank-deposit maturity date, formatted for display plus a relative
// "time left" summary. Returns null when there's no date. `tone` drives the
// colour: 'neg' once matured (needs action — consistent with the maturity card
// and resolve pill), 'warn' when due within 30 days (or today), 'neutral'
// otherwise (issue #263).
export interface Maturity {
  formatted: string
  diffDays: number
  relative: string
  tone: 'neutral' | 'warn' | 'pos' | 'neg'
}

// Whether a holding is a term deposit at (or within the reminder window of) its
// maturity date — i.e. it needs a renew/withdraw decision. Shared so the mobile
// sheet and desktop panel surface the "Handle maturity" action identically.
export function needsMaturityAction(inv: InvRow, isVi: boolean): boolean {
  if (!isTermDeposit({ type: inv.type, interestRate: inv.interestRate, expiryDate: inv.expiryDate })) return false
  const m = fmtMaturity(inv.expiryDate, isVi)
  if (!m) return false
  return isMaturityActionable(depositMaturityState(m.diffDays))
}

export function fmtMaturity(dateStr: string | null | undefined, isVi: boolean): Maturity | null {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86_400_000)
  const formatted = fmtTxDate(dateStr, isVi ? 'vi' : 'en')

  let relative: string
  let tone: Maturity['tone'] = 'neutral'
  if (diffDays < 0) {
    relative = isVi ? 'Đã đáo hạn' : 'Matured'
    tone = 'neg'
  } else if (diffDays === 0) {
    relative = isVi ? 'Đáo hạn hôm nay' : 'Matures today'
    tone = 'warn'
  } else if (diffDays <= 30) {
    relative = isVi ? `Còn ${diffDays} ngày` : `${diffDays} day${diffDays === 1 ? '' : 's'} left`
    tone = 'warn'
  } else {
    relative = isVi ? `Còn ${diffDays} ngày` : `${diffDays} days left`
  }
  return { formatted, diffDays, relative, tone }
}

// Bank-deposit info strip shown in the investment Options modal: interest rate,
// maturity date and time-left. Renders nothing for non-bank holdings or when
// there's no info to show (issue #263). Shared so desktop + mobile stay in sync.
export function BankInfoStrip({ inv, isVi }: { inv: InvRow; isVi: boolean }) {
  if (inv.type !== 'bank') return null
  const m = fmtMaturity(inv.expiryDate, isVi)
  const cells: { l: string; v: string; tone?: Maturity['tone'] }[] = []
  if (inv.interestRate != null) {
    cells.push({ l: isVi ? 'Lãi suất' : 'Interest rate', v: `${inv.interestRate}%/${isVi ? 'năm' : 'yr'}` })
  }
  if (m) {
    cells.push({ l: isVi ? 'Ngày đáo hạn' : 'Maturity', v: m.formatted })
    cells.push({ l: isVi ? 'Còn lại' : 'Time left', v: m.relative, tone: m.tone })
  }
  if (!cells.length) return null

  return (
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
