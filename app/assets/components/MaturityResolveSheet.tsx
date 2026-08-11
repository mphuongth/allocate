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
// (Renewal is offered only once the deposit has matured — or is within the
// route's +1 day tolerance — so the anchored investment_date is never rejected as
// a future date; a still-maturing deposit surfaced by the wider reminder window
// shows a "record at maturity" hint instead.) The new maturity defaults to old-maturity
// + term and follows the term until the user edits it by hand. Withdrawal hands
// off to the existing Sell/Withdraw flow rather than re-implementing the payout
// (the parent wires `onWithdraw`).

import { useState, useEffect } from 'react'
import { RefreshCw, Pencil, ArrowDownToLine, AlertTriangle, Check, Building2, X, Plus, PiggyBank } from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'
import { fieldLabel, moneyInput, dateInput, MoneyField, WithdrawSection, HeldPoolSection, DestinationBankField } from './maturityResolveFields'
import { MergeSourcesSection } from './maturityResolveMergeSources'
import { RecurringRedepositSection } from './maturityResolveRecurring'
import { CombineNewCycleSection } from './maturityResolveNewCycle'
import { formatIntVN, parseIntVN, formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'
import { iconHit } from './iconHit'
import { SUCCESS_FLASH_MS } from '../successFlash'
import { type InvRow } from './goalDetailShared'
import { fmtMaturity } from './goalDetailMaturity'
import {
  depositMaturityState,
  addMonths,
  monthsBetween,
  type RenewMode,
} from '@/lib/maturity'
import { maturityResolveStrings } from '@/features/dashboard/maturity/strings'
import { holdAnchorsFor, mergeProvenance } from '@/features/dashboard/maturity/mergeSelection'
import { useMergeSelection } from '@/features/dashboard/maturity/useMergeSelection'
import { computeNewPrincipal, renewEndpoint, buildRenewBody } from '@/features/dashboard/maturity/resolveModel'
import { linkedSavingFor, type RecurringLinkCandidate, type RecurringLinkResult } from '@/lib/recurringLink'
import { classifyMergeSources, type MergeBlockReason } from '@/lib/mergeEligibility'
import { todayIso } from '@/lib/dates'

type Mode = RenewMode | 'withdraw' | 'combine'

// A native <input type=date> on iOS Safari sizes to its intrinsic content width
// and ignores width:100%, so an un-clamped date field pushes the whole sheet
// wider than the viewport — letting it be dragged sideways (#439). Clamp it like
// the ledger's date filters (#362): appearance:none trims the intrinsic width,
// maxWidth:100% + minWidth:0 pin it to its cell.
// Money entry core: a digit-grouped amount field (₫ suffix). Reused by every
// money input in the maturity flow so large VND amounts stay readable
// (e.g. "37,030,000" rather than "37030000"). `AmountInput` keeps the value raw
// (digits only) while displaying thousands separators and a numeric keypad.
// `compact` is the tight in-row variant (per-source merge cash); `style` merges
// onto the field (e.g. the navy-bordered re-deposit amount).
/**
 * The shared decision form. Rendered inside the mobile sheet or desktop modal.
 * `onRenewed` fires after a successful PUT; `onWithdraw` hands control to the
 * parent's existing Sell/Withdraw flow.
 */
export function MaturityResolveBody({
  inv, goalId, siblingDeposits, heldSiblings, isVi, onClose, onRenewed, onWithdraw,
}: {
  inv: InvRow
  // The goal this deposit is assigned to (null = unallocated). Used to find the
  // recurring saving that can be folded into the re-deposit (combine flow).
  goalId?: string | null
  // The goal's other holdings. The combine flow can fold sibling bank deposits
  // (settle each early, add the cash to this re-deposit) — an internal transfer
  // that prevents the "inflate the principal but leave the sibling active"
  // double-count. Omitted by callers that don't wire it (feature inert).
  siblingDeposits?: InvRow[]
  // "Ví chờ gộp" holdings in this goal — earlier-maturing deposits already settled
  // with "Để dành gộp", their cash parked. When `inv` is the anchor they merge
  // into, they appear preselected in the merge section and submit as held_sources
  // (consumed in place — no second withdrawal). `id` is the held WITHDRAWAL row.
  heldSiblings?: { id: string; name: string | null; amount: number }[]
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
  // A book promised to a successor cannot be collapsed (#638) — the merge into
  // that successor is what its maturity is for. Until that merge exists, the way
  // out has to be reachable from here, or the refusal is a dead end.
  const [handoverBlocked, setHandoverBlocked] = useState(false)
  // Phase 3: a book that was handed over has one thing left to do at maturity —
  // go where it was promised. That is offered here instead of a renewal, since
  // renewing it is the one thing the handover said would not happen.
  const hasSuccessor = !!inv.successorDepositTxId
  const [mergeRecvStr, setMergeRecvStr] = useState('')
  const [mergeRate, setMergeRate] = useState(inv.interestRate != null ? String(inv.interestRate) : '')
  const [mergeDate, setMergeDate] = useState(() => todayIso())
  // The book as the server sees it. The goal page caps at 200 rows, so a large
  // goal hands this sheet a partial book — and a partial book can never satisfy
  // the merge's tranche check, however often it is reloaded.
  const [mergeTranches, setMergeTranches] = useState<{ transaction_id: string; effective_principal: number }[] | null>(null)
  const [mergeLoadFailed, setMergeLoadFailed] = useState(false)
  const [mergeReload, setMergeReload] = useState(0)
  const [done, setDone] = useState<null | { newPrincipal: number; newMaturity: string; sources: string[] }>(null)
  // Settle-with-hold success: the deposit was parked in the pool (no re-deposit).
  const [heldDone, setHeldDone] = useState<null | { anchorName: string }>(null)

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

  // ── Merge siblings ──────────────────────────────────────────────────────────
  // Sibling bank deposits in this goal that can be settled early and folded into
  // the re-deposit. A book is renewed as a whole (never a tranche), so exclude
  // grouped rows and the merge UI altogether when `inv` is itself a book.
  const mergeable = (siblingDeposits ?? []).filter(
    (s) => s.id !== inv.id && s.type === 'bank' && !s.depositGroupId && (s.principal ?? s.value ?? 0) > 0,
  )
  // Ordered the way the RPC's per-source allocation windows: (investmentDate, id).
  const mergeableOrdered = [...mergeable].sort(
    (a, b) => (a.investmentDate ?? '').localeCompare(b.investmentDate ?? '') || a.id.localeCompare(b.id),
  )
  // Selection is DERIVED from eligibility: an in-window sibling defaults to
  // selected, the rest default to not. `mergeSel` records only the user's EXPLICIT
  // overrides of that default (so widening the window can re-default an untouched
  // source without clobbering a manual pick). `overridden` flags an out-of-window
  // source the user chose to fold in early ("Gộp sớm?").
  // Maturity window (days): siblings maturing within this many days of the anchor
  // are eligible. The slider widens it (folding in farther deposits = early
  // settlement = a possible interest penalty).
  const [windowDays, setWindowDays] = useState(7)
  // Destination bank for the combined re-deposit (multi-source merge). Defaults to
  // the settling deposit's bank; the user can move the money to another bank.
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([])
  const [destBank, setDestBank] = useState<string>(inv.bankCode ?? '')

  // ── Settle-with-hold ("Để dành gộp") ─────────────────────────────────────────
  // When THIS maturing deposit has a later-maturing eligible anchor in the same
  // goal, "Không tái tục — rút" forks into two cards: park the cash for that merge
  // (default) vs withdraw to the wallet. holdReceived is the cash that lands (the
  // user edits it down if early settlement is penalised).
  const [holdChoice, setHoldChoice] = useState<'hold' | 'cash'>('hold')
  const [holdReceived, setHoldReceived] = useState(String(Math.round(inv.value ?? principal)))
  // ── Held-pool consume (when THIS deposit is the anchor) ───────────────────────
  // The goal's pooled holdings, all preselected to fold in. heldSel records only
  // explicit deselects (a deselected holding is unheld → restored to a deposit).
  const pooledHeld = heldSiblings ?? []
  const [heldSel, setHeldSel] = useState<Record<string, boolean>>({})
  const isHeldSelected = (id: string) => heldSel[id] ?? true
  const selectedHeld = pooledHeld.filter((h) => isHeldSelected(h.id))
  const heldReceivedTotal = selectedHeld.reduce((sum, h) => sum + h.amount, 0)

  // Classify each mergeable sibling against the anchor (D). Same-goal is already
  // guaranteed (siblings are this goal's holdings), so we don't pass goal ids.
  const classifications = classifyMergeSources(
    { id: inv.id, type: inv.type, expiryDate: inv.expiryDate, principal: inv.principal, value: inv.value, depositGroupId: inv.depositGroupId, currency: inv.currency, isPledged: inv.isPledged },
    mergeableOrdered.map((s) => ({ id: s.id, type: s.type, expiryDate: s.expiryDate, principal: s.principal, value: s.value, depositGroupId: s.depositGroupId, currency: s.currency, isPledged: s.isPledged })),
    windowDays,
  )
  const classOf = new Map(classifications.map((c) => [c.source.id, c]))

  // Eligible HOLD anchors: this deposit can be settled-with-hold only when a
  // LATER-maturing sibling in the same goal is an eligible merge target for it
  // (same window/currency/not-pledged, via the shared PR2 predicate — D as anchor,
  // THIS deposit as the source). No anchor ⇒ plain withdraw, no hold fork (per the
  // owner's gate). The nearest later maturity is the default anchor.
  const holdAnchors = holdAnchorsFor(inv, siblingDeposits, goalId, isBook, windowDays)
  const holdAnchor = holdAnchors[0] ?? null
  const canHold = !!holdAnchor
  const holdReceivedNum = holdReceived.trim() === '' ? 0 : Number(holdReceived)

  const {
    selectedSources, mergeReceivedTotal, mergeRecv, mergeTotal,
    isSelected, isOverridden, toggleSource, overrideSource, setReceived, onMergeTotalChange,
  } = useMergeSelection(mergeableOrdered, (id) => !!classOf.get(id)?.eligible, windowDays)

  const { sourceCount: mergeSourceCount, bankCount: mergeBankCount, isMultiSource } =
    mergeProvenance(inv, selectedSources)

  // Load the bank reference list once for the destination picker. Every renewal
  // of a single deposit offers it now — moving the money to another bank is the
  // ordinary reason to re-deposit (#640) — so this no longer waits for a sibling
  // to merge. A book keeps its own bank (collapse takes none), so it still skips
  // the request. Failure is non-fatal: the picker simply doesn't render.
  useEffect(() => {
    if (isBook) return
    let cancelled = false
    fetch('/api/v1/banks')
      .then((r) => (r.ok ? r.json() : []))
      // The route returns a bare array of { code, name, logo_url } (same as the
      // deposit form's selector); tolerate a non-array just in case.
      .then((d: unknown) => { if (!cancelled) setBanks(Array.isArray(d) ? d as { code: string; name: string }[] : []) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Open straight into combine mode when this anchor has pooled holdings waiting —
  // the whole point of resolving it is to fold them in (mount-only).
  useEffect(() => {
    if (pooledHeld.length > 0) setMode('combine')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The candidate currently chosen to fold in (explicit pick, else the match).
  const pickedCand: RecurringLinkCandidate | null = combineLink
    ? (pickedSavingId ? combineLink.candidates.find((c) => c.saving_id === pickedSavingId) ?? null : combineLink.match)
    : null
  const linkedAmt = pickedCand ? pickedCand.amount_vnd : 0
  // Combine is offered when there's a recurring to fold in, sibling deposits to
  // merge, OR pooled holdings waiting to be consumed — all settle-and-re-deposit.
  const canCombine = !!combineLink || mergeable.length > 0 || pooledHeld.length > 0

  const iNum = Number(interest) || 0
  const tNum = Number(term) || 0
  // Pass null (not 0) for an empty "new amount" so renewalPrincipal can fall
  // back to the current principal rather than writing 0₫ to the deposit.
  const newAmountNum = newAmount.trim() === '' ? null : Number(newAmount)
  const redepositNum = redeposit.trim() === '' ? 0 : Number(redeposit)
  // In combine mode the re-deposit field holds the BASE (principal + interest +
  // recurring); the merged-in sibling cash is added ON TOP for the new principal.
  // Submit sends the BASE and the per-source received list — the RPC re-sums
  // Σ(received) server-side, so the net-worth invariant can't drift.
  const newPrincipal = computeNewPrincipal(mode, { principal, iNum, newAmountNum, redepositNum, mergeReceivedTotal, heldReceivedTotal })

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

  const t = maturityResolveStrings(isVi, matured)

  // Guard against writing a zero/empty principal, a non-positive term, clearing
  // the rate (which would drop the deposit out of maturity tracking), or a new
  // maturity that isn't strictly after the old one (a zero/negative-length cycle).
  const rateValid = rate.trim() !== '' && Number(rate) > 0
  const amountValid = mode !== 'change' || (newAmount.trim() !== '' && Number(newAmount) > 0)
  const maturityValid = newMaturity > baseDate
  // A not-yet-matured deposit's new cycle would start on its (future) old maturity
  // date, which the renew route + RPC reject as a future investment_date (they
  // tolerate only +1 day of skew). The bank money isn't freed before maturity
  // anyway, so recording a roll-over early isn't meaningful — the wider reminder
  // window just surfaces it early; the user records the renewal once it matures.
  // Early WITHDRAW (breaking the term) stays allowed — it posts via onWithdraw,
  // not the date-anchored renew path.
  const daysLeft = m?.diffDays ?? 0
  const tooEarlyToRenew = !matured && daysLeft > 1
  const canRenew = tNum > 0 && rateValid && amountValid && newPrincipal > 0 && maturityValid && !tooEarlyToRenew


  // Human-readable reason for a blocked source.
  function blockReasonText(reason: MergeBlockReason | null, gapDays: number | null): string {
    switch (reason) {
      case 'out-of-window': return t.reasonOutOfWindow(gapDays ?? 0)
      case 'different-currency': return t.reasonCurrency
      case 'pledged': return t.reasonPledged
      case 'different-goal': return t.reasonGoal
      default: return t.reasonBlocked
    }
  }

  const POLICIES: { id: Mode; icon: React.ReactNode; label: string; sub: string; danger?: boolean }[] = [
    ...(canCombine ? [{
      id: 'combine' as Mode, icon: <Plus size={16} />, label: t.combineLabel,
      sub: combineLink
        ? (combineLink.ambiguous && !pickedCand ? t.combineSubPick : t.combineSub(fmtCompact(linkedAmt)))
        : t.mergeSub,
    }] : []),
    { id: 'principal_interest', icon: <RefreshCw size={16} />, label: isVi ? 'Tái tục gốc + lãi' : 'Renew principal + interest', sub: isVi ? 'Cộng lãi vào gốc cho kỳ mới' : 'Roll interest into the new principal' },
    { id: 'principal_only', icon: <RefreshCw size={16} />, label: isVi ? 'Tái tục chỉ gốc' : 'Renew principal only', sub: isVi ? 'Lãi chuyển ra ngoài (về ví)' : 'Interest paid out to your wallet' },
    { id: 'change', icon: <Pencil size={16} />, label: isVi ? 'Đổi số tiền / kỳ hạn' : 'Change amount / term', sub: isVi ? 'Điều chỉnh gốc hoặc kỳ hạn kỳ mới' : 'Adjust principal or term for the new cycle' },
    // Withdraw = don't renew. For a book this is a FULL close (every tranche),
    // handed off to the sell sheet via onWithdraw — same as a single deposit.
    { id: 'withdraw' as Mode, icon: <ArrowDownToLine size={16} />, label: isVi ? 'Không tái tục — rút' : 'Don’t renew — withdraw', sub: isVi ? 'Rút toàn bộ số dư' : 'Withdraw the full balance', danger: true },
  ]

  // Settle this deposit with "Để dành gộp": post a held withdrawal that closes it
  // (removing its principal from net worth + the bar) but flags the cash for a
  // future merge into the chosen anchor — the overview synthesizes it straight
  // back, so the goal value never dips. No re-deposit happens here.
  async function handleHold() {
    if (!holdAnchor || !(holdReceivedNum > 0)) return
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/v1/investment-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_type: 'withdrawal',
          asset_type: 'bank',
          goal_id: goalId,
          parent_transaction_id: inv.id,
          investment_date: todayIso(),
          amount_vnd: Math.round(holdReceivedNum),
          // principal_withdrawn is NOT sent: the server derives what the deposit
          // still has and closes exactly that (#588). Sending our own number
          // would offer back the control the RPC exists to take, and ours is the
          // screen's view of the principal — stale if anything moved since load.
          affects_progress: true,
          held_for_merge: true,
          merge_target_goal_id: goalId,
          merge_anchor_inv_id: holdAnchor.id,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? (isVi ? 'Không thể để dành' : 'Could not hold'))
        setSaving(false)
        return
      }
      setHeldDone({ anchorName: holdAnchor.name })
      setTimeout(() => { onRenewed(); onClose() }, SUCCESS_FLASH_MS)
    } catch {
      setError(isVi ? 'Lỗi kết nối' : 'Connection error')
      setSaving(false)
    }
  }

  // The cash the bank actually paid out, defaulting to what the book is worth —
  // principal plus the interest it accrued — which the user confirms or corrects
  // against the slip.
  const successorRecv = mergeRecvStr === '' ? Math.round(inv.value) : Number(mergeRecvStr)
  // The sheet also opens in the week BEFORE maturity, as a reminder. The cash is
  // not paid out until the day itself, and the merge refuses a source that has
  // not matured — so offering the button then is offering a certain error.
  const bookMatured = !!inv.expiryDate && inv.expiryDate <= todayIso()
  const mergeReady = successorRecv > 0 && Number(mergeRate) > 0 && bookMatured && !!mergeTranches?.length

  useEffect(() => {
    if (!hasSuccessor) return
    let live = true
    setMergeLoadFailed(false)
    fetch(`/api/v1/investment-transactions/${inv.id}/merge-successor`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('preview failed'); return r.json() })
      .then((res) => { if (live) setMergeTranches(res?.tranches ?? []) })
      // Failing quietly here leaves the button disabled with nothing said, and a
      // matured book looks impossible to resolve until the sheet is reopened.
      .catch(() => { if (live) setMergeLoadFailed(true) })
    return () => { live = false }
  }, [hasSuccessor, inv.id, mergeReload])

  async function handleMergeIntoSuccessor() {
    if (!(successorRecv > 0) || !(Number(mergeRate) > 0)) {
      setError(isVi ? 'Cần nhập số tiền và lãi suất' : 'Amount and rate are required')
      return
    }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/v1/investment-transactions/${inv.id}/merge-successor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          received_vnd: Math.round(successorRecv),
          interest_rate: Number(mergeRate),
          merge_date: mergeDate,
          // Naming what we saw, and what each held: a top-up or a withdrawal
          // landing while this was open means the cash being confirmed is not
          // the cash the book holds.
          tranche_ids: (mergeTranches ?? []).map((t) => t.transaction_id),
          tranche_principals: (mergeTranches ?? []).map((t) => Math.round(t.effective_principal)),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? (isVi ? 'Không gộp được' : 'Could not merge'))
        setSaving(false)
        return
      }
      onRenewed()
      onClose()
    } catch { setError(isVi ? 'Lỗi kết nối' : 'Connection error') } finally { setSaving(false) }
  }

  async function handleConfirm() {
    if (mode === 'withdraw') {
      // The hold fork only exists when there's an eligible anchor; default is hold.
      if (canHold && holdChoice === 'hold') { await handleHold(); return }
      onClose(); setTimeout(onWithdraw, 60); return
    }
    if (!canRenew) return
    setSaving(true); setError('')
    try {
      // A book collapses (settle all tranches → one fresh deposit) via the collapse
      // route; a single term deposit rolls forward via /renew. The collapse route
      // values each tranche's interest itself (one TS formula → the per-tranche
      // history snapshots), so — unlike /renew — it takes no interest_earned_vnd.
      // Body construction (per-mode amount, book vs single, merge/held/fulfillment
      // folding) lives in maturityResolveModel — see buildRenewBody's doc for the
      // combine-sends-BASE and book-omits-interest rules.
      const endpoint = renewEndpoint(isBook)
      const res = await fetch(`/api/v1/investment-transactions/${inv.id}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRenewBody({
          mode, isBook, newPrincipal, redepositNum, rate, newMaturity, baseDate, iNum,
          pickedCand, markFulfilled, fulfillYm, linkedAmt, selectedSources, mergeRecv,
          destBank, currentBank: inv.bankCode ?? '', selectedHeld,
        })),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? (isVi ? 'Không thể tái tục' : 'Could not renew'))
        if (body.code === 'successor_planned') setHandoverBlocked(true)
        setSaving(false)
        return
      }
      setDone({
        newPrincipal: Math.round(newPrincipal), newMaturity,
        sources: mode === 'combine'
          ? [...selectedSources.map((s) => s.name), ...selectedHeld.map((h) => h.name ?? (isVi ? 'Sổ chờ gộp' : 'Held deposit'))]
          : [],
      })
      setTimeout(() => { onRenewed(); onClose() }, SUCCESS_FLASH_MS)
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
        {done.sources.length > 0 && (
          <div data-testid="maturity-renewed-sources" style={{ marginTop: 10, fontSize: 12, color: 'var(--c-muted)', lineHeight: 1.5 }}>
            {t.mergedSourcesLabel}: {done.sources.join(', ')}
          </div>
        )}
      </div>
    )
  }

  // ─── Settle-with-hold success ───
  if (heldDone) {
    return (
      <div data-testid="maturity-held" style={{ padding: '24px 4px 8px', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 28, background: 'var(--c-card-2)', color: 'var(--c-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <PiggyBank size={26} strokeWidth={2.2} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{t.holdDone}</div>
        <div style={{ fontSize: 13, color: 'var(--c-muted)', marginTop: 6, lineHeight: 1.5 }}>
          {t.holdDoneSub(heldDone.anchorName)}
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
    return {
      text: isVi
        ? (n === 0 ? 'Đáo hạn hôm nay' : n === 1 ? 'Đáo hạn ngày mai' : `Đáo hạn sau ${n} ngày`)
        : (n === 0 ? 'Matures today' : n === 1 ? 'Matures tomorrow' : `Matures in ${n}d`),
      color: 'var(--c-warn)', bg: 'var(--c-warn-tint)',
    }
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

      {/* The promise, come due. A handed-over book is not renewed — it goes where
          it was promised, carrying the cash the bank actually paid out (#638). */}
      {hasSuccessor && (
        <div data-testid="merge-successor-panel" style={{ display: 'grid', gap: 10, padding: '13px 14px', border: '1px solid var(--c-line)', borderRadius: 12, background: 'var(--c-card)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{isVi ? 'Gộp vào sổ kế nhiệm' : 'Merge into the successor book'}</div>
            <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--c-muted)' }}>
              {isVi
                ? 'Sổ này đã được hẹn gộp vào sổ kế nhiệm khi đáo hạn. Xác nhận số tiền ngân hàng thực trả để ghi vào sổ mới.'
                : 'This book was promised to its successor at maturity. Confirm what the bank actually paid out, and it lands there.'}
            </p>
          </div>
          <div>
            <label style={fieldLabel}>{isVi ? 'Tiền thực nhận (₫)' : 'Cash received (₫)'}</label>
            <input data-testid="merge-received" type="text" inputMode="numeric"
              value={formatIntVN(mergeRecvStr === '' ? String(Math.round(inv.value)) : mergeRecvStr)}
              onChange={(e) => setMergeRecvStr(parseIntVN(e.target.value))} style={moneyInput} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={fieldLabel}>{isVi ? 'Lãi suất phần gộp' : 'Rate for this tranche'}</label>
              <input data-testid="merge-rate" type="text" inputMode="decimal" value={mergeRate}
                onChange={(e) => setMergeRate(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))} style={moneyInput} />
            </div>
            <div>
              <label style={fieldLabel}>{isVi ? 'Ngày gộp' : 'Merge date'}</label>
              <input data-testid="merge-date" type="date" value={mergeDate}
                onChange={(e) => setMergeDate(e.target.value)} style={dateInput} />
            </div>
          </div>
          {mergeLoadFailed && (
            <div data-testid="merge-preview-failed" style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--c-neg)' }}>
              {isVi ? 'Không đọc được sổ này.' : "Could not read this book."}
              <button type="button" data-testid="merge-preview-retry" onClick={() => setMergeReload((n) => n + 1)}
                style={{ marginLeft: 6, padding: 0, border: 'none', background: 'none', color: 'var(--c-navy)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
                {isVi ? 'Thử lại' : 'Try again'}
              </button>
            </div>
          )}
          {!bookMatured && (
            <p data-testid="merge-not-due" style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--c-muted)' }}>
              {isVi
                ? 'Sổ chưa đến ngày đáo hạn — ngân hàng chưa trả tiền, nên chưa gộp được.'
                : 'This book has not matured yet — the bank has not paid out, so there is nothing to move.'}
            </p>
          )}
          <button type="button" data-testid="merge-successor-submit" disabled={saving || !mergeReady}
            onClick={handleMergeIntoSuccessor}
            style={{ padding: '11px 0', borderRadius: 10, border: 'none', background: 'var(--c-btn-primary)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', opacity: saving || !mergeReady ? 0.6 : 1 }}>
            {isVi ? 'Gộp vào sổ kế nhiệm' : 'Merge into the successor'}
          </button>
        </div>
      )}

      {/* Discoverability nudge: a later-maturing sibling in this goal makes this
          deposit a hold-for-merge candidate. Surfaced up top so the option isn't
          buried; the actual commit lives in the withdraw fork below. */}
      {canHold && holdAnchor && (
        <div data-testid="maturity-hold-nudge" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 13px', background: 'var(--c-card-2)', borderRadius: 10 }}>
          <PiggyBank size={15} color="var(--c-navy)" strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c-ink)', lineHeight: 1.5 }}>
            {t.holdNudge(holdAnchor.name, fmtMaturity(holdAnchor.expiryDate, isVi)?.formatted ?? '')}
          </p>
        </div>
      )}

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
          <RecurringRedepositSection
            combineLink={combineLink} pickedCand={pickedCand} setPickedSavingId={setPickedSavingId}
            interest={interest} setInterest={setInterest}
            principal={principal} iNum={iNum} linkedAmt={linkedAmt}
            redeposit={redeposit} setRedeposit={setRedeposit} setRedepositTouched={setRedepositTouched}
            t={{
              whichRecurring: t.whichRecurring, pickHint: t.pickHint, interestReceived: t.interestReceived,
              toAccount: t.toAccount, principalOut: t.principalOut, recurringThisMonth: t.recurringThisMonth,
              redepositAmount: t.redepositAmount, redepositHint: t.redepositHint,
            }}
          />

          {/* Merge sibling deposits — settle each early, fold the cash into the
              new principal. Hidden for a book (renewed whole) and when none qualify. */}
          {!isBook && mergeable.length > 0 && (
            <MergeSourcesSection
              mergeableOrdered={mergeableOrdered} classOf={classOf} isSelected={isSelected}
              toggleSource={toggleSource} overrideSource={overrideSource} blockReasonText={blockReasonText}
              isOverridden={isOverridden} mergeRecv={mergeRecv} setReceived={setReceived}
              mergeTotal={mergeTotal} onMergeTotalChange={onMergeTotalChange} isMultiSource={isMultiSource}
              windowDays={windowDays} setWindowDays={setWindowDays}
              selectedSources={selectedSources} mergeReceivedTotal={mergeReceivedTotal}
              mergeSourceCount={mergeSourceCount} mergeBankCount={mergeBankCount}
              t={{
                mergeTitle: t.mergeTitle, mergeTitleMulti: t.mergeTitleMulti, mergeHint: t.mergeHint,
                windowLabel: t.windowLabel, windowHint: t.windowHint,
                mergeReceivedLabel: t.mergeReceivedLabel, mergeTotalLabel: t.mergeTotalLabel, mergeEarly: t.mergeEarly, mergePenalty: t.mergePenalty,
                provenance: t.provenance,
              }}
            />
          )}

          {/* "Ví chờ gộp" — pooled holdings to consume (preselected). Deselecting
              one just leaves it in the pool; restoring the deposit is the holdings
              chip's "Bỏ chờ gộp" action. Shown even with no live siblings. */}
          {!isBook && pooledHeld.length > 0 && (
            <HeldPoolSection pooledHeld={pooledHeld} isHeldSelected={isHeldSelected} setHeldSel={setHeldSel} isVi={isVi}
              t={{ heldSectionTitle: t.heldSectionTitle, heldSectionHint: t.heldSectionHint, heldUnholdHint: t.heldUnholdHint }} />
          )}

          <CombineNewCycleSection
            term={term} setTerm={setTerm} rate={rate} setRate={setRate}
            newMaturity={newMaturity} newMaturityFmt={newMaturityFmt} baseDate={baseDate}
            setMaturityOverride={setMaturityOverride} dateTouched={dateTouched} maturityValid={maturityValid}
            linkedAmt={linkedAmt} pickedCand={pickedCand} markFulfilled={markFulfilled} setMarkFulfilled={setMarkFulfilled}
            newPrincipal={newPrincipal}
            t={{
              newTerm: t.newTerm, newRate: t.newRate, mo: t.mo, perYr: t.perYr,
              newMaturityLabel: t.newMaturityLabel, resetDate: t.resetDate, maturityTooEarly: t.maturityTooEarly,
              markDeposited: t.markDeposited, newCycle: t.newCycle,
            }}
          />
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
                <input data-testid="maturity-term-input" type="text" inputMode="numeric" value={formatIntVN(term)} onChange={(e) => setTerm(parseIntVN(e.target.value))} style={moneyInput} />
                <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--c-muted)', pointerEvents: 'none' }}>{t.mo}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: mode === 'change' ? '1fr 1fr' : '1fr', gap: 10 }}>
            <div>
              <div style={fieldLabel}>{t.newRate}</div>
              <div style={{ position: 'relative' }}>
                <input type="text" inputMode="decimal" value={formatDecimalVN(rate)} onChange={(e) => setRate(parseDecimalVN(e.target.value))} style={moneyInput} />
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
              style={dateInput}
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
        <WithdrawSection
          t={{
            holdForkPrompt: t.holdForkPrompt, holdCardTitle: t.holdCardTitle, holdCardSub: t.holdCardSub,
            cashCardTitle: t.cashCardTitle, cashCardSub: t.cashCardSub,
            holdReceivedLabel: t.holdReceivedLabel, totalPayout: t.totalPayout,
          }}
          canHold={canHold} holdAnchor={holdAnchor}
          holdChoice={holdChoice} setHoldChoice={setHoldChoice}
          holdReceived={holdReceived} setHoldReceived={setHoldReceived}
          payout={payout}
        />
      )}

      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg)' }}>{error}</p>}
      {handoverBlocked && (
        <button type="button" data-testid="cancel-handover-btn" disabled={saving}
          onClick={async () => {
            setSaving(true)
            try {
              const res = await fetch(`/api/v1/investment-transactions/${inv.id}/successor`, { method: 'DELETE' })
              if (res.ok) { setHandoverBlocked(false); setError('') }
              else setError(isVi ? 'Không huỷ được bàn giao' : 'Could not cancel the handover')
            } catch { setError(isVi ? 'Lỗi kết nối' : 'Connection error') } finally { setSaving(false) }
          }}
          style={{ alignSelf: 'flex-start', padding: 0, border: 'none', background: 'none', color: 'var(--c-navy)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
          {isVi ? 'Huỷ bàn giao rồi thử lại' : 'Cancel the handover and try again'}
        </button>
      )}

      {/* Where the new cycle is deposited. Shown for every renewal — a matured
          deposit moving to another bank is the ordinary case, and it used to be
          reachable only after picking a sibling to merge (#640). A book collapses
          through a route that takes no bank, so it keeps its own. */}
      {mode !== 'withdraw' && !isBook && banks.length > 0 && (
        <DestinationBankField
          banks={banks} value={destBank} onChange={setDestBank}
          label={t.destBankLabel} noneLabel={t.destBankNone}
          hint={destBank && destBank !== (inv.bankCode ?? '') ? t.destBankHint : undefined}
        />
      )}

      {/* Actions */}
      {tooEarlyToRenew && mode !== 'withdraw' && (
        <p data-testid="maturity-too-early-hint" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'var(--c-muted)' }}>
          {isVi
            ? `Sổ chưa tới hạn (còn ${daysLeft} ngày) — ghi nhận tái tục khi đáo hạn. Bạn vẫn có thể rút trước hạn.`
            : `Not matured yet (${daysLeft} days left) — record the renewal at maturity. You can still withdraw early.`}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onClose} className="cn-btn ghost" style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }}>{t.cancel}</button>
        {(() => {
          // Holding posts instead of withdrawing — navy CTA + piggy icon, never the
          // red withdraw button (the money is staying in the goal).
          const holding = mode === 'withdraw' && canHold && holdChoice === 'hold'
          const disabled = saving || (mode !== 'withdraw' && !canRenew) || (holding && !(holdReceivedNum > 0))
          return (
            <button type="button" onClick={handleConfirm} disabled={disabled} style={{
              flex: 2, justifyContent: 'center', gap: 7, padding: '10px 14px', borderRadius: 10, border: 'none',
              fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
              cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, color: '#fff',
              background: mode === 'withdraw' && !holding ? 'var(--c-neg)' : 'var(--c-btn-primary)',
              display: 'flex', alignItems: 'center',
            }}>
              {holding ? <PiggyBank size={14} strokeWidth={2.2} /> : mode === 'withdraw' ? <ArrowDownToLine size={14} strokeWidth={2.2} /> : mode === 'combine' ? <Plus size={14} strokeWidth={2.2} /> : <RefreshCw size={14} strokeWidth={2.2} />}
              {holding ? t.holdConfirm : mode === 'withdraw' ? t.confirmWithdraw : mode === 'combine' ? t.confirmCombine : t.confirmRenew}
            </button>
          )
        })()}
      </div>
    </div>
  )
}

// ─── Mobile bottom-sheet wrapper ───────────────────────────────────────────
export function MaturityResolveSheet({
  open, inv, goalId, siblingDeposits, heldSiblings, isVi, onClose, onRenewed, onWithdraw,
}: {
  open: boolean
  inv: InvRow | null
  goalId?: string | null
  siblingDeposits?: InvRow[]
  heldSiblings?: { id: string; name: string | null; amount: number }[]
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
          <MaturityResolveBody inv={inv} goalId={goalId} siblingDeposits={siblingDeposits} heldSiblings={heldSiblings} isVi={isVi} onClose={onClose} onRenewed={onRenewed} onWithdraw={onWithdraw} />
        </div>
      </div>
    </div>
  )
}

// ─── Desktop modal wrapper ─────────────────────────────────────────────────
export function MaturityResolveModal({
  inv, goalId, siblingDeposits, heldSiblings, isVi, onClose, onRenewed, onWithdraw,
}: {
  inv: InvRow
  goalId?: string | null
  siblingDeposits?: InvRow[]
  heldSiblings?: { id: string; name: string | null; amount: number }[]
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
          <button onClick={onClose} className="cn-btn ghost" style={{ ...iconHit }} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto' }}>
          <MaturityResolveBody inv={inv} goalId={goalId} siblingDeposits={siblingDeposits} heldSiblings={heldSiblings} isVi={isVi} onClose={onClose} onRenewed={onRenewed} onWithdraw={onWithdraw} />
        </div>
      </div>
    </div>
  )
}
