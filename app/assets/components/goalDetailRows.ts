// Goal-detail row-building logic (#467): the composition segments, the renewal
// summary, and buildInvRows (dedup + valuation of a goal's holdings). Split out of
// goalDetailShared so the shared file keeps the data types + presentational UI while
// this pure logic lives on its own. Types are imported from goalDetailShared (its
// vocabulary is used across the app); GD_COLORS is the one value dependency.
import { calcProjectedInterest } from '@/lib/finance'
import { blendedRate } from '@/lib/accumulating'
import type { FundBreakdownItem } from '@/features/dashboard/contracts'
import { GD_COLORS, type CompositionSeg, type InvRow, type InvTranche, type GoalDetailTx, type RenewalSummary } from './goalDetailShared'

// Build the goal-detail "Cơ cấu / Composition" segments. The asset segments come
// from the active investment rows; held-for-merge cash closed its source deposit so
// it is ABSENT from those rows, yet still counts toward the goal's headline value via
// the overview synthesis (lib/heldForMerge). Add it as its own neutral segment so the
// bar reconciles with the headline instead of summing short. Shared by both views.
export function buildCompositionSegments(
  rows: { type: string; value: number }[],
  heldValue: number,
  isVi: boolean,
): CompositionSeg[] {
  const breakdown: Record<string, number> = {}
  rows.forEach((r) => { breakdown[r.type] = (breakdown[r.type] ?? 0) + r.value })
  const segs: CompositionSeg[] = Object.entries(breakdown).map(([label, value]) => ({
    label, value, color: GD_COLORS[label] ?? 'var(--c-muted)',
  }))
  if (heldValue > 0) {
    segs.push({ label: isVi ? 'Chờ gộp' : 'For merge', value: heldValue, color: 'var(--c-muted)' })
  }
  return segs
}

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
  // rows are active holdings. Recurring savings are excluded here too and rolled
  // up separately below: they are contributions the plan says have happened, not
  // transactions (#640).
  const investmentRows = transactions.filter((tx) => tx.transaction_type !== 'withdrawal' && !tx.renewed_from_transaction_id && !tx.is_recurring)
  // Accumulating books collect their tranches by deposit_group_id; funds dedup to
  // one row per fund; everything else is one row per transaction.
  const deduped = new Map<string, GoalDetailTx>()
  const books = new Map<string, GoalDetailTx[]>()
  investmentRows.forEach((tx) => {
    if (!tx.fund_id && tx.deposit_group_id) {
      const arr = books.get(tx.deposit_group_id) ?? []
      arr.push(tx)
      books.set(tx.deposit_group_id, arr)
    } else if (tx.fund_id) {
      if (!deduped.has(tx.fund_id)) deduped.set(tx.fund_id, tx)
    } else {
      deduped.set(tx.transaction_id, tx)
    }
  })
  const fundMap = new Map(funds.map((f) => [f.fundId, f]))

  const singleRows = Array.from(deduped.values()).map((tx): InvRow | null => {
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

    return { id: tx.transaction_id, name, type: tx.asset_type, value, gainPct, units, principal, interestRate: tx.interest_rate ?? null, expiryDate: tx.expiry_date ?? null, investmentDate: fund ? null : (tx.investment_date ?? null), fund: fund ?? null, depositGroupId: null, bankCode: tx.asset_type === 'bank' ? (tx.bank_code ?? null) : null, currency: tx.currency ?? null, isPledged: tx.is_pledged ?? false, topUpLockDays: tx.top_up_lock_days ?? null }
  }).filter((row): row is InvRow => row !== null)

  // One InvRow per accumulating book: value each tranche on its own locked rate
  // (capped at the shared maturity), sum them, and show the amount-weighted rate.
  const bookRows = Array.from(books.entries()).map(([groupId, rows]): InvRow | null => {
    const tranches: InvTranche[] = []
    for (const tx of rows) {
      const wd = wdByParent.get(tx.transaction_id)
      const effPrincipal = tx.amount_vnd - (wd?.principal ?? 0)
      if (effPrincipal <= 0) continue // this tranche fully withdrawn
      const interest = tx.interest_rate
        ? calcProjectedInterest(effPrincipal, tx.interest_rate, tx.investment_date, tx.expiry_date)
        : 0
      tranches.push({ id: tx.transaction_id, date: tx.investment_date, amount: effPrincipal, rate: tx.interest_rate ?? null, value: Math.round(effPrincipal + interest) })
    }
    if (tranches.length === 0) return null // whole book withdrawn
    tranches.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) // newest first
    const principal = tranches.reduce((s, t) => s + t.amount, 0)
    const value = tranches.reduce((s, t) => s + t.value, 0)
    const anchor = rows.find((r) => r.transaction_id === groupId) ?? rows[0]
    return {
      id: groupId,
      name: anchor.notes ?? (isVi ? 'Tiền gửi' : 'Bank deposit'),
      type: 'bank',
      value,
      gainPct: principal > 0 ? ((value - principal) / principal) * 100 : null,
      units: null,
      principal,
      interestRate: blendedRate(tranches),
      expiryDate: anchor.expiry_date ?? null,
      investmentDate: tranches[tranches.length - 1].date, // earliest tranche opened the book
      fund: null,
      depositGroupId: groupId,
      bankCode: anchor.bank_code ?? null, // bank is book-level; the anchor carries it
      currency: anchor.currency ?? null,
      isPledged: anchor.is_pledged ?? false,
      topUpLockDays: anchor.top_up_lock_days ?? null,
      successorDepositTxId: anchor.successor_deposit_tx_id ?? null,
      tranches,
    }
  }).filter((row): row is InvRow => row !== null)

  return [...singleRows, ...bookRows, ...recurringRows(transactions, isVi)]
}

// One row per recurring saving, summing every realized month the API synthesized
// for it. The money is genuinely in the goal (the overview counts it toward the
// value and the bar), so it belongs on the holdings tab — but it is backed by a
// plan definition, not a transaction. Rolling the months together also keeps a
// year-old plan from filling the tab with twelve identical rows. Flagged
// `isRecurring` so the surfaces render it read-only: a withdrawal parented to
// `recurring:<savingId>:<date>` is a 400 from the API, which is what the user
// hit when they tried to move one to another bank (#640).
function recurringRows(transactions: GoalDetailTx[], isVi: boolean): InvRow[] {
  const bySaving = new Map<string, { name: string; type: string; amount: number; since: string }>()
  for (const tx of transactions) {
    if (!tx.is_recurring) continue
    // The synthesized id is `recurring:<savingId>:<date>` — group on the saving,
    // falling back to the whole id so an unexpected shape still groups sanely.
    const key = tx.transaction_id.split(':').slice(0, 2).join(':')
    const prev = bySaving.get(key)
    const name = tx.notes ?? (isVi ? 'Tiết kiệm định kỳ' : 'Recurring saving')
    if (prev) {
      prev.amount += tx.amount_vnd
      if (tx.investment_date < prev.since) prev.since = tx.investment_date
    } else {
      bySaving.set(key, { name, type: tx.asset_type, amount: tx.amount_vnd, since: tx.investment_date })
    }
  }

  return Array.from(bySaving.entries()).map(([key, s]) => ({
    id: key,
    name: s.name,
    type: s.type,
    // No growth is modeled for a recurring contribution — the overview adds the
    // same amount to value and to invested, so P&L stays neutral here too.
    value: s.amount,
    gainPct: null,
    units: null,
    principal: s.amount,
    interestRate: null,
    expiryDate: null,
    investmentDate: s.since,
    fund: null,
    depositGroupId: null,
    bankCode: null,
    currency: null,
    isPledged: false,
    isRecurring: true,
  }))
}
