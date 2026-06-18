'use client'

// Term-deposit maturity decision flow. When a bank term deposit reaches (or
// nears) its maturity date the user must decide: renew (roll principal +
// interest, principal only, or change amount/term) or withdraw. This is the
// shared form plus a mobile bottom-sheet and a desktop modal wrapper.
//
// Renewal is a single POST to the renew route: it rolls the deposit forward in
// place (new principal / rate / maturity) and sets `investment_date` to the OLD
// maturity date, so the new cycle's compound-interest valuation in buildInvRows
// picks up exactly where the closed cycle ended — an overdue book does not lose
// the days it sat past maturity, nor does its next maturity skip forward by them.
// (An actionable deposit's old maturity is at most "tomorrow", so this never
// trips the route's future-date guard.) The new maturity defaults to old-maturity
// + term and follows the term until the user edits it by hand. Withdrawal hands
// off to the existing Sell/Withdraw flow rather than re-implementing the payout
// (the parent wires `onWithdraw`).

import { useState, useEffect } from 'react'
import { RefreshCw, Pencil, ArrowDownToLine, AlertTriangle, Check, Building2, X, Plus, Wallet } from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'
import { fmtMaturity, type InvRow } from './goalDetailShared'
import {
  depositMaturityState,
  addMonths,
  monthsBetween,
  renewalPrincipal,
  type RenewMode,
} from '@/lib/maturity'
import { linkedSavingFor, type RecurringLinkCandidate, type RecurringLinkResult } from '@/lib/recurringLink'
import { todayIso } from '@/lib/dates'

type Mode = RenewMode | 'withdraw' | 'combine'

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
  inv, goalId, isVi, onClose, onRenewed, onWithdraw,
}: {
  inv: InvRow
  // The goal this deposit is assigned to (null = unallocated). Used to find the
  // recurring saving that can be folded into the re-deposit (combine flow).
  goalId?: string | null
  isVi: boolean
  onClose: () => void
  onRenewed: () => void
  onWithdraw: () => void
}) {
  // An accumulating ("Loại 2") book: `inv` is the rolled-up book row (principal =
  // Σ tranche principals, value = Σ tranche valuations). It renews by COLLAPSING
  // — settle every tranche into one fresh plain term deposit — so it posts to the
  // collapse route, not /renew, and withdrawing the whole book isn't offered yet.
  const isBook = !!inv.depositGroupId
  const principal = inv.principal ?? inv.value ?? 0
  // Best real-data estimate of interest earned this cycle: current (compounded)
  // value minus the principal still held. For a book this is Σ tranche interest.
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
  // For a book the rate is the blended average (often a long decimal) — round the
  // suggested new rate to 1dp so the field starts clean; a term deposit keeps its
  // exact stored rate.
  const [rate, setRate] = useState(inv.interestRate != null ? String(isBook ? Math.round(inv.interestRate * 10) / 10 : inv.interestRate) : '')
  // The editable lump (change mode). For a book, seed it with the plan TOTAL
  // (Σ principal + Σ interest) — the full payout the collapse would otherwise
  // re-deposit — so a hand-edit starts from the book's real figure, not bare
  // principal. A single term deposit keeps its principal-only default.
  const [newAmount, setNewAmount] = useState(String(isBook ? principal + estInterest : principal))
  // The new maturity follows old-maturity + term until the user edits it by hand,
  // at which point we freeze their value (null = "follow the term").
  const [maturityOverride, setMaturityOverride] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<null | { newPrincipal: number; newMaturity: string }>(null)

  // ── Combine ("settle & re-deposit", merge recurring) ────────────────────────
  // A recurring bank saving due for this goal this month can be folded into the
  // re-deposit. We fetch the goal's active recurring savings on open and match
  // one (linkedSavingFor); if found, the combine option appears (pre-selected).
  const fulfillYm = todayIso().slice(0, 7)
  const [combineLink, setCombineLink] = useState<RecurringLinkResult | null>(null)
  const [pickedSavingId, setPickedSavingId] = useState<string | null>(null)
  const [redeposit, setRedeposit] = useState(String(principal))
  const [redepositTouched, setRedepositTouched] = useState(false)
  const [markFulfilled, setMarkFulfilled] = useState(true)

  useEffect(() => {
    // Combine needs the deposit's goal scope. When the caller doesn't wire it
    // (goalId omitted), stay in plain renew-only mode and skip the lookup.
    if (goalId === undefined) return
    let cancelled = false
    const [y, mo] = fulfillYm.split('-')
    fetch(`/api/v1/recurring-savings?month=${Number(mo)}&year=${y}`)
      .then((r) => (r.ok ? r.json() : { savings: [] }))
      .then((data: { savings?: Array<{ saving_id: string; name: string; goal_id: string | null; amount_vnd: number; fulfilled?: boolean; linked_deposit_tx_id?: string | null }> }) => {
        if (cancelled) return
        const candidates: RecurringLinkCandidate[] = (data.savings ?? [])
          .filter((s) => (s.goal_id ?? null) === (goalId ?? null))
          .map((s) => ({ saving_id: s.saving_id, name: s.name, amount_vnd: s.amount_vnd, fulfilled: !!s.fulfilled, linkedDepositKey: s.linked_deposit_tx_id ?? null }))
        // inv.id is the deposit's transaction_id — the stable key a recurring's
        // linked_deposit_tx_id points at, so the EXPLICIT tier resolves the right one.
        const link = linkedSavingFor(inv.name, candidates, inv.id)
        if (!link) return
        setCombineLink(link)
        setPickedSavingId(link.match?.saving_id ?? null)
        setMode('combine')
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The candidate currently chosen to fold in (explicit pick, else the match).
  const pickedCand: RecurringLinkCandidate | null = combineLink
    ? (pickedSavingId ? combineLink.candidates.find((c) => c.saving_id === pickedSavingId) ?? null : combineLink.match)
    : null
  const linkedAmt = pickedCand ? pickedCand.amount_vnd : 0
  const canCombine = !!combineLink

  const iNum = Number(interest) || 0
  const tNum = Number(term) || 0
  // Pass null (not 0) for an empty "new amount" so renewalPrincipal can fall
  // back to the current principal rather than writing 0₫ to the deposit.
  const newAmountNum = newAmount.trim() === '' ? null : Number(newAmount)
  const redepositNum = redeposit.trim() === '' ? 0 : Number(redeposit)
  const newPrincipal = mode === 'withdraw'
    ? principal
    : mode === 'combine'
      ? redepositNum
      : renewalPrincipal(mode, principal, iNum, newAmountNum)

  // Suggested re-deposit = principal + interest + this month's recurring, until
  // the user edits it (their bank's actual figure may differ).
  useEffect(() => {
    if (!redepositTouched) setRedeposit(String(principal + iNum + linkedAmt))
  }, [principal, iNum, linkedAmt, redepositTouched])
  // The new cycle is anchored to the OLD maturity date (the closed cycle's end),
  // not today — so an overdue book's next maturity is old-maturity + term, and
  // its accrual restarts from old maturity without skipping the overdue days.
  const baseDate = inv.expiryDate || todayIso()
  // New maturity defaults to old-maturity + term and tracks the term, until the
  // user edits the date field by hand (then we honour their pick).
  const derivedMaturity = addMonths(baseDate, tNum > 0 ? tNum : 0)
  const dateTouched = maturityOverride !== null
  const newMaturity = dateTouched ? maturityOverride : derivedMaturity
  const newMaturityFmt = fmtMaturity(newMaturity, isVi)?.formatted ?? newMaturity
  const payout = principal + iNum

  // Guard against writing a zero/empty principal, a non-positive term, clearing
  // the rate (which would drop the deposit out of maturity tracking), or a new
  // maturity that isn't strictly after the old one (a zero/negative-length cycle).
  const rateValid = rate.trim() !== '' && Number(rate) > 0
  const amountValid = mode !== 'change' || (newAmount.trim() !== '' && Number(newAmount) > 0)
  const maturityValid = newMaturity > baseDate
  const canRenew = tNum > 0 && rateValid && amountValid && newPrincipal > 0 && maturityValid

  const t = isVi ? {
    summarySuffix: 'năm', perYr: 'năm', mo: 'tháng',
    why: matured
      ? 'Sổ đã đáo hạn. Nếu không xử lý, ngân hàng thường tự tái tục theo kỳ hạn cũ. Hãy ghi nhận quyết định của bạn.'
      : 'Sổ sắp đáo hạn. Chọn cách xử lý cho kỳ tiếp theo.',
    prompt: 'Bạn muốn làm gì?',
    newAmount: 'Số tiền kỳ mới', interestReceived: 'Lãi thực nhận',
    interestPaidOut: 'Lãi thực nhận (rút ra)',
    interestSavedHint: 'Số lãi này được lưu vĩnh viễn vào lịch sử tái tục.',
    newTerm: 'Kỳ hạn mới', newRate: 'Lãi suất kỳ mới',
    newCycle: 'Kỳ mới', newMaturityLabel: 'Ngày đáo hạn mới',
    maturityHint: 'Tự tính theo kỳ hạn, tính từ ngày đáo hạn cũ. Sửa nếu ngân hàng chốt ngày khác.',
    resetDate: 'Đặt lại', maturityTooEarly: 'Ngày đáo hạn mới phải sau ngày đáo hạn cũ.',
    interestIn: 'Lãi nhập gốc', interestOut: 'Lãi rút ra',
    totalPayout: 'Tổng nhận về',
    cancel: 'Hủy', confirmRenew: 'Xác nhận tái tục', confirmWithdraw: 'Đánh dấu chờ rút',
    renewed: 'Đã tái tục', renewedSub: (p: string, d: string) => `Kỳ mới ${p} · đáo hạn ${d}`,
    combineLabel: 'Tất toán & gửi lại (gộp định kỳ)',
    combineSubPick: 'Chọn khoản định kỳ để gộp',
    combineSub: (amt: string) => `Cộng ${amt} định kỳ tháng này rồi gửi lại`,
    whichRecurring: 'Gộp kèm khoản định kỳ nào?',
    pickHint: 'Chọn một khoản để gộp, hoặc bỏ trống để chỉ tái tục gốc + lãi.',
    toAccount: 'Về tài khoản thường', principalOut: 'Gốc tất toán',
    recurringThisMonth: 'Gửi định kỳ tháng này',
    redepositAmount: 'Số tiền gửi lại',
    redepositHint: (amt: string) => `Gợi ý ${amt} (gốc + lãi + định kỳ) — sửa nếu thực tế khác.`,
    markDeposited: (amt: string) => `Đánh dấu đã gửi định kỳ tháng này (${amt})`,
    confirmCombine: 'Lưu sổ mới',
  } : {
    summarySuffix: 'yr', perYr: 'yr', mo: 'mo',
    why: matured
      ? 'This deposit has matured. Banks usually auto-renew at the same term — record what you decided.'
      : 'This deposit is about to mature. Choose how to handle the next cycle.',
    prompt: 'What do you want to do?',
    newAmount: 'New amount', interestReceived: 'Interest received',
    interestPaidOut: 'Interest received (paid out)',
    interestSavedHint: 'This interest is saved permanently to the renewal history.',
    newTerm: 'New term', newRate: 'New interest rate',
    newCycle: 'New cycle', newMaturityLabel: 'New maturity',
    maturityHint: 'Auto-calculated from the term, starting at the old maturity date. Edit if your bank set a different date.',
    resetDate: 'Reset', maturityTooEarly: 'New maturity must be after the old maturity date.',
    interestIn: 'Interest added', interestOut: 'Interest out',
    totalPayout: 'Total payout',
    cancel: 'Cancel', confirmRenew: 'Confirm renewal', confirmWithdraw: 'Mark for withdrawal',
    renewed: 'Deposit renewed', renewedSub: (p: string, d: string) => `New term ${p} · matures ${d}`,
    combineLabel: 'Settle & re-deposit (merge recurring)',
    combineSubPick: 'Pick a recurring to merge',
    combineSub: (amt: string) => `Add ${amt} recurring, then re-deposit`,
    whichRecurring: 'Which recurring to merge?',
    pickHint: 'Pick one to merge, or leave none to renew principal + interest only.',
    toAccount: 'To your account', principalOut: 'Principal out',
    recurringThisMonth: 'Recurring this month',
    redepositAmount: 'Re-deposit amount',
    redepositHint: (amt: string) => `Suggested ${amt} (principal + interest + recurring) — edit if reality differs.`,
    markDeposited: (amt: string) => `Mark this month's recurring as deposited (${amt})`,
    confirmCombine: 'Save new deposit',
  }

  const POLICIES: { id: Mode; icon: React.ReactNode; label: string; sub: string; danger?: boolean }[] = [
    ...(canCombine ? [{
      id: 'combine' as Mode, icon: <Plus size={16} />, label: t.combineLabel,
      sub: combineLink?.ambiguous && !pickedCand ? t.combineSubPick : t.combineSub(fmtCompact(linkedAmt)),
    }] : []),
    { id: 'principal_interest', icon: <RefreshCw size={16} />, label: isVi ? 'Tái tục gốc + lãi' : 'Renew principal + interest', sub: isVi ? 'Cộng lãi vào gốc cho kỳ mới' : 'Roll interest into the new principal' },
    { id: 'principal_only', icon: <RefreshCw size={16} />, label: isVi ? 'Tái tục chỉ gốc' : 'Renew principal only', sub: isVi ? 'Lãi chuyển ra ngoài (về ví)' : 'Interest paid out to your wallet' },
    { id: 'change', icon: <Pencil size={16} />, label: isVi ? 'Đổi số tiền / kỳ hạn' : 'Change amount / term', sub: isVi ? 'Điều chỉnh gốc hoặc kỳ hạn kỳ mới' : 'Adjust principal or term for the new cycle' },
    // Withdraw = don't renew. For a book this is a FULL close (every tranche),
    // handed off to the sell sheet via onWithdraw — same as a single deposit.
    { id: 'withdraw' as Mode, icon: <ArrowDownToLine size={16} />, label: isVi ? 'Không tái tục — rút' : 'Don’t renew — withdraw', sub: isVi ? 'Rút toàn bộ số dư' : 'Withdraw the full balance', danger: true },
  ]

  async function handleConfirm() {
    if (mode === 'withdraw') { onClose(); setTimeout(onWithdraw, 60); return }
    if (!canRenew) return
    setSaving(true); setError('')
    try {
      // A book collapses (settle all tranches → one fresh deposit) via the collapse
      // route; a single term deposit rolls forward via /renew. The collapse route
      // values each tranche's interest itself (one TS formula → the per-tranche
      // history snapshots), so — unlike /renew — it takes no interest_earned_vnd.
      const endpoint = isBook ? 'collapse' : 'renew'
      const res = await fetch(`/api/v1/investment-transactions/${inv.id}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_vnd: Math.round(newPrincipal),
          interest_rate: Number(rate),
          expiry_date: newMaturity,
          // Anchor the new cycle's accrual to the OLD maturity date (baseDate) so
          // the value calc restarts where the closed cycle ended — overdue days
          // are not lost. An actionable deposit's old maturity is ≤ tomorrow, so
          // this stays within the route's future-date tolerance. The route rolls
          // the active row forward in place and appends a history snapshot of the
          // cycle that just closed.
          investment_date: baseDate,
          // Realized interest for the cycle that just closed — recorded
          // permanently on the snapshot for the renewal-history summary. A book's
          // collapse route derives this per tranche, so only send it for /renew.
          ...(isBook ? {} : { interest_earned_vnd: iNum }),
          // Combine flow: mark this month's recurring saving fulfilled inside the
          // same transaction, so its amount (now folded into the principal above)
          // is not also counted as a separate synthesized contribution.
          fulfill_recurring: mode === 'combine' && pickedCand && markFulfilled
            ? { saving_id: pickedCand.saving_id, ym: fulfillYm, amount: linkedAmt }
            : undefined,
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

      {/* Combine — settle & re-deposit, folding in this month's recurring saving */}
      {mode === 'combine' && (
        <div data-testid="maturity-combine" style={{ display: 'grid', gap: 12 }}>
          {/* Which recurring to merge — shown when more than one is foldable, or
              when the match is ambiguous (so a loose single match stays opt-in,
              never auto-folded). */}
          {combineLink && (combineLink.candidates.length > 1 || combineLink.ambiguous) && (
            <div>
              <div style={fieldLabel}>{t.whichRecurring}</div>
              <div style={{ display: 'grid', gap: 7 }}>
                {combineLink.candidates.map((c) => {
                  const sel = pickedCand?.saving_id === c.saving_id
                  return (
                    <button key={c.saving_id} type="button" onClick={() => setPickedSavingId(sel ? null : c.saving_id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                        border: `1.5px solid ${sel ? 'var(--c-navy)' : 'var(--c-line)'}`, background: sel ? 'var(--c-navy-tint)' : 'var(--c-card)', fontFamily: 'inherit' }}>
                      {/* --c-btn-primary (not --c-navy) so the white check stays legible in dark mode — issue #264 */}
                      <span style={{ width: 18, height: 18, borderRadius: 9, flexShrink: 0, border: `1.5px solid ${sel ? 'var(--c-btn-primary)' : 'var(--c-line-strong)'}`, background: sel ? 'var(--c-btn-primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {sel && <Check size={11} color="#fff" strokeWidth={3} />}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(c.amount_vnd)}</span>
                    </button>
                  )
                })}
              </div>
              {!pickedCand && <p style={{ margin: '7px 2px 0', fontSize: 11, color: 'var(--c-warn)', lineHeight: 1.45 }}>{t.pickHint}</p>}
            </div>
          )}

          <MoneyField label={t.interestReceived} value={interest} onChange={setInterest} />

          {/* Cash-flow recap — what lands in the account before re-depositing */}
          <div style={{ border: '1px solid var(--c-line)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '8px 13px', background: 'var(--c-card-2)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Wallet size={14} color="var(--c-muted)" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-muted)' }}>{t.toAccount}</span>
            </div>
            <div style={{ padding: '10px 13px', display: 'grid', gap: 7 }}>
              {[
                { l: t.principalOut, v: principal, plus: false },
                { l: t.interestReceived, v: iNum, plus: true },
                { l: t.recurringThisMonth, v: linkedAmt, plus: true },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--c-muted)' }}>{r.l}</span>
                  <span style={{ fontWeight: 600, color: r.plus ? 'var(--c-pos)' : 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{r.plus ? '+' : ''}{fmt(r.v)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Re-deposit amount (suggested = principal + interest + recurring) */}
          <div>
            <div style={fieldLabel}>{t.redepositAmount}</div>
            <div style={{ position: 'relative' }}>
              <input data-testid="maturity-redeposit" type="number" value={redeposit}
                onChange={(e) => { setRedeposit(e.target.value); setRedepositTouched(true) }}
                style={{ ...moneyInput, borderColor: 'var(--c-navy)' }} />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--c-muted)', pointerEvents: 'none' }}>₫</span>
            </div>
            <p style={{ margin: '7px 2px 0', fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.45 }}>{t.redepositHint(fmtCompact(principal + iNum + linkedAmt))}</p>
          </div>

          {/* New term + rate */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={fieldLabel}>{t.newTerm}</div>
              <div style={{ position: 'relative' }}>
                <input type="number" value={term} onChange={(e) => setTerm(e.target.value)} style={moneyInput} />
                <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--c-muted)', pointerEvents: 'none' }}>{t.mo}</span>
              </div>
            </div>
            <div>
              <div style={fieldLabel}>{t.newRate}</div>
              <div style={{ position: 'relative' }}>
                <input type="number" step="0.1" value={rate} onChange={(e) => setRate(e.target.value)} style={moneyInput} />
                <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--c-muted)', pointerEvents: 'none' }}>%/{t.perYr}</span>
              </div>
            </div>
          </div>

          {/* New maturity date — same anchor (old maturity + term) as a renewal */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ ...fieldLabel, marginBottom: 0 }}>{t.newMaturityLabel}</span>
              {dateTouched && (
                <button type="button" onClick={() => setMaturityOverride(null)}
                  style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-navy)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                  {t.resetDate}
                </button>
              )}
            </div>
            <input type="date" value={newMaturity} min={baseDate} onChange={(e) => setMaturityOverride(e.target.value)} style={moneyInput} />
            {!maturityValid && <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--c-neg)', lineHeight: 1.4 }}>{t.maturityTooEarly}</p>}
          </div>

          {/* Mark this month's recurring as deposited (prevents double-count) */}
          {linkedAmt > 0 && pickedCand && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', background: 'var(--c-pos-tint)', borderRadius: 10, fontSize: 12.5, color: 'var(--c-ink)', lineHeight: 1.4, cursor: 'pointer' }}>
              <input data-testid="maturity-mark-fulfilled" type="checkbox" checked={markFulfilled} onChange={(e) => setMarkFulfilled(e.target.checked)} style={{ accentColor: 'var(--c-pos)', width: 16, height: 16, flexShrink: 0 }} />
              <span>{t.markDeposited(fmtCompact(linkedAmt))}</span>
            </label>
          )}

          {/* Preview */}
          <div style={{ border: '1px solid var(--c-line)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', background: 'var(--c-navy-tint)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-navy)' }}>{t.newCycle}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span data-testid="maturity-new-principal" style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-navy)', fontVariantNumeric: 'tabular-nums' }}>{fmt(newPrincipal)}</span>
                {rate !== '' && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--c-card)', color: 'var(--c-navy)' }}>{rate}%/{t.perYr}</span>}
              </span>
            </div>
            <div style={{ background: 'var(--c-card)', padding: '9px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{t.newMaturityLabel}</div>
              <div data-testid="maturity-new-date" style={{ fontSize: 13, fontWeight: 600, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{newMaturityFmt}</div>
            </div>
          </div>
        </div>
      )}

      {/* Inputs per mode */}
      {mode !== 'withdraw' && mode !== 'combine' && (
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

          {/* New maturity date — defaults to old-maturity + term, follows the term
              until the user edits it, with a reset back to the auto value. */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ ...fieldLabel, marginBottom: 0 }}>{t.newMaturityLabel}</span>
              {dateTouched && (
                <button
                  type="button"
                  data-testid="maturity-date-reset"
                  onClick={() => setMaturityOverride(null)}
                  style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-navy)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                >
                  {t.resetDate}
                </button>
              )}
            </div>
            <input
              data-testid="maturity-date-input"
              type="date"
              value={newMaturity}
              min={baseDate}
              onChange={(e) => setMaturityOverride(e.target.value)}
              style={moneyInput}
            />
            {maturityValid
              ? <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.4 }}>{t.maturityHint}</p>
              : <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--c-neg)', lineHeight: 1.4 }}>{t.maturityTooEarly}</p>}
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

          <p style={{ margin: 0, fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.4 }}>{t.interestSavedHint}</p>
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
          {mode === 'withdraw' ? <ArrowDownToLine size={14} strokeWidth={2.2} /> : mode === 'combine' ? <Plus size={14} strokeWidth={2.2} /> : <RefreshCw size={14} strokeWidth={2.2} />}
          {mode === 'withdraw' ? t.confirmWithdraw : mode === 'combine' ? t.confirmCombine : t.confirmRenew}
        </button>
      </div>
    </div>
  )
}

// ─── Mobile bottom-sheet wrapper ───────────────────────────────────────────
export function MaturityResolveSheet({
  open, inv, goalId, isVi, onClose, onRenewed, onWithdraw,
}: {
  open: boolean
  inv: InvRow | null
  goalId?: string | null
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
          <MaturityResolveBody inv={inv} goalId={goalId} isVi={isVi} onClose={onClose} onRenewed={onRenewed} onWithdraw={onWithdraw} />
        </div>
      </div>
    </div>
  )
}

// ─── Desktop modal wrapper ─────────────────────────────────────────────────
export function MaturityResolveModal({
  inv, goalId, isVi, onClose, onRenewed, onWithdraw,
}: {
  inv: InvRow
  goalId?: string | null
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
          <MaturityResolveBody inv={inv} goalId={goalId} isVi={isVi} onClose={onClose} onRenewed={onRenewed} onWithdraw={onWithdraw} />
        </div>
      </div>
    </div>
  )
}
