// Pure preview math for AddTransactionSheet (#467). These derivations feed the
// sheet's summary UI and the confirm-button gate; they were computed inline in the
// component. Keeping them here — free of React state and fetch — lets the numbers
// (NAV prefill, sell tax/gain, bank principal split, gold profit) be unit-tested
// directly. The DB-write payload builders inside handleSave are a separate concern
// and stay in the component for now.

import { previewBankWithdrawal, estimateReceivedForPrincipal } from '@/lib/bankWithdrawal'
import { goldCostBasis, goldUnitCost } from '@/lib/goldWithdrawal'
import { fundCostBasis } from '@/lib/fundWithdrawal'

export type AssetType = 'fund' | 'bank' | 'gold'

// The sell-side holding fields the preview reads — a structural subset of the
// sheet's `Holding`, so `selectedHolding` satisfies it without a cast.
export interface PreviewHolding {
  type: AssetType
  currentValue: number
  navPerUnit: number | null
  gainPct: number | null
  purchasePrice?: number | null
  units?: number | null
}

export interface FundPricing {
  navNum: number
  displayNav: string
  navIsCurrent: boolean
  autoUnits: string
}

// Fund buy pricing: NAV is editable (the real purchase price) and falls back to the
// fund's current NAV; units derive from amount ÷ NAV (two-way linked, so an explicit
// units entry is left untouched). `currentNav` is the selected fund's NAV, or
// null/undefined when no fund is selected.
export function computeFundPricing(input: {
  nav: string
  amount: string
  units: string
  currentNav?: number | null
}): FundPricing {
  const { nav, amount, units, currentNav } = input
  const hasFund = currentNav != null
  const navNum = Number(nav) || currentNav || 0
  const displayNav = nav !== '' ? nav : (hasFund ? String(currentNav) : '')
  const navIsCurrent = hasFund && (nav === '' || Number(nav) === currentNav)
  const autoUnits = navNum > 0 && amount && !units
    ? (Number(amount.replace(/\./g, '')) / navNum).toFixed(2)
    : units
  return { navNum, displayNav, navIsCurrent, autoUnits }
}

export interface SellPreview {
  sellMax: number
  numSell: number
  sellOverMax: boolean
  sellRemaining: number
  sellNav: number | null
  sellGainLoss: number | null
  sellTax: number | null
  numReceived: number
  /** Share of the remaining PRINCIPAL this withdrawal takes — display only. */
  bankPctOfPrincipal: number
  /** Principal leaving the book: exactly what the user entered (#578). */
  bankWithdrawPrincipal: number
  bankGain: number | null
  goldMaxUnits: number
  numGoldSellQty: number
  numGoldSellPrice: number
  goldBuyUnit: number | null
  goldProceeds: number
  goldCost: number | null
  goldProfit: number | null
  goldRemUnits: number | null
  isOverUnits: boolean
  sellDisabled: boolean
}

// Every sell-side derivation for the selected holding: the amount cap + tax + gain
// for a fund, the principal-vs-received split for a bank withdrawal, the
// quantity/cost/profit for a gold sell, and the combined confirm-disabled gate.
export function computeSellPreview(input: {
  assetType: AssetType
  dir: 'buy' | 'sell'
  holding: PreviewHolding | null
  sellAmount: string
  received: string
  goldSellQty: string
  goldSellPrice: string
}): SellPreview {
  const { assetType, dir, holding: h, sellAmount, received, goldSellQty, goldSellPrice } = input

  // A bank withdrawal is bounded by the PRINCIPAL still in the book, not by its
  // current value: the amount entered is the principal being taken out, and the
  // interest is whatever the bank pays on top (#578). Anything sold at market is
  // still bounded by its value.
  const bankPrincipal = h?.purchasePrice ?? h?.currentValue ?? 0
  const sellMax = assetType === 'bank' ? bankPrincipal : (h?.currentValue ?? 0)
  const numSell = Number(sellAmount) || 0
  const sellOverMax = numSell > sellMax && sellMax > 0
  const sellRemaining = Math.max(0, sellMax - numSell)
  const sellNav = h?.navPerUnit ?? null
  const sellGainLoss = (numSell && assetType === 'fund' && h?.gainPct != null)
    ? numSell * h.gainPct / (100 + h.gainPct) : null
  const sellTax = assetType === 'fund' && numSell > 0 ? Math.round(numSell * 0.001) : null

  // Bank withdrawal: received cash is editable (early withdrawal can cut
  // interest), and the gain is simply what the bank paid above the principal.
  const numReceived = Number(received) || 0
  const bankView = previewBankWithdrawal({ currentPrincipal: bankPrincipal, amount: numSell, received: numReceived })
  const bankWithdrawPrincipal = bankView.principal
  const bankPctOfPrincipal = bankPrincipal > 0 ? Math.min(1, numSell / bankPrincipal) : 0
  const bankGain = assetType === 'bank' && numReceived > 0 && numSell > 0 ? bankView.interest : null

  // Gold sells are quantity-based: chỉ to sell × the sale price per chỉ.
  const goldMaxUnits = h?.units ?? 0
  const numGoldSellQty = Number(goldSellQty) || 0
  const numGoldSellPrice = Number(goldSellPrice) || 0
  // Per-unit price for display; the basis divides once and states a full sell
  // exactly, so "sell all" can't post a đồng more than the holding has (#587).
  const goldBuyUnit = goldUnitCost(h?.purchasePrice, h?.units)
  const goldProceeds = Math.round(numGoldSellQty * numGoldSellPrice)
  const goldCost = goldCostBasis({ currentPrincipal: h?.purchasePrice, units: h?.units, sellUnits: numGoldSellQty })
  const goldProfit = goldProceeds > 0 && goldCost != null ? goldProceeds - goldCost : null
  const goldRemUnits = h?.units != null ? h.units - numGoldSellQty : null
  const isOverUnits = numGoldSellQty > goldMaxUnits && goldMaxUnits > 0

  const sellDisabled = dir === 'sell' && (
    !h ||
    (assetType === 'gold'
      ? (numGoldSellQty <= 0 || isOverUnits)
      : assetType === 'bank'
        ? (numSell <= 0 || sellOverMax || numReceived <= 0)
        : (numSell <= 0 || sellOverMax))
  )

  return {
    sellMax, numSell, sellOverMax, sellRemaining, sellNav, sellGainLoss, sellTax,
    numReceived, bankPctOfPrincipal, bankWithdrawPrincipal, bankGain,
    goldMaxUnits, numGoldSellQty, numGoldSellPrice, goldBuyUnit, goldProceeds, goldCost,
    goldProfit, goldRemUnits, isOverUnits, sellDisabled,
  }
}

/**
 * Prefill for the bank "amount you'll receive" field, given the principal being
 * withdrawn. The amount field is principal, so the accrued interest has to be
 * added back or an unedited field would record a withdrawal that earned nothing.
 */
export function bankReceivedPrefill(holding: PreviewHolding | null, amount: number): number {
  return estimateReceivedForPrincipal({
    currentPrincipal: holding?.purchasePrice ?? holding?.currentValue ?? 0,
    currentValue: holding?.currentValue ?? 0,
    amount,
  })
}

// ── DB-write payload builders ────────────────────────────────────────────────
// Pure `form → { payload } | { errorKey }` transforms for the three write paths
// (#467). They own all the money math that persists — gold luông→chỉ normalization,
// `units = amount ÷ NAV`, the fund sell's proportional `principal_withdrawn` split —
// while the component keeps the fetch/`setError(t(errorKey))`. `errorKey` values are
// the sheet's existing i18n keys.

export type BuildResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; errorKey: string }

// Every form field the buy/edit builders read. The sheet keeps fund `amount` and
// bank `bankAmount` as separate inputs, mirrored here.
export interface TxForm {
  assetType: AssetType
  date: string
  goalId: string
  note: string
  fundId: string
  amount: string
  units: string
  nav: string
  selectedFundNav?: number | null
  bankCode: string
  selectedBankName: string
  depositType: 'term' | 'flex' | 'accumulating'
  bankAmount: string
  rate: string
  maturity: string
  topUpLockDays?: string
  goldProvider: string
  goldUnit: 'chi' | 'luong'
  goldQty: string
  goldPrice: string
}

// Fund units: an explicit entry wins; otherwise derive amount ÷ NAV when NAV known.
function fundUnits(units: string, amount: number, navV: number | null): number | null {
  return units ? Number(units) : (navV ? amount / navV : null)
}

// Gold qty/price are in the selected unit; normalize to chỉ for storage (gold is
// valued per chỉ). Returns null when qty or price is missing/zero.
function normalizeGold(goldQty: string, goldPrice: string, goldUnit: 'chi' | 'luong'):
  { amountVnd: number; unitsInChi: number; pricePerChi: number } | null {
  const qty = Number(goldQty)
  const price = Number(goldPrice.replace(/\./g, ''))
  if (!qty || !price) return null
  const unitsInChi = goldUnit === 'luong' ? qty * 10 : qty
  const pricePerChi = goldUnit === 'luong' ? Math.round(price / 10) : price
  return { amountVnd: Math.round(qty * price), unitsInChi, pricePerChi }
}

// Edit an existing investment (PUT). No transaction_type / plan_id; bank & gold
// carry an explicit fund_id: null.
export function buildEditPayload(form: TxForm): BuildResult {
  const { assetType, date, goalId, note } = form
  if (assetType === 'fund') {
    const amt = Number(form.amount.replace(/\./g, ''))
    if (!form.fundId) return { ok: false, errorKey: 'fundRequired' }
    if (!amt) return { ok: false, errorKey: 'amountRequired' }
    const navV = Number(form.nav) || form.selectedFundNav || null
    return { ok: true, payload: {
      asset_type: 'fund', fund_id: form.fundId, investment_date: date,
      amount_vnd: amt, units: fundUnits(form.units, amt, navV), unit_price: navV,
      goal_id: goalId || null, notes: note || null,
    } }
  }
  if (assetType === 'bank') {
    const amt = Number(form.bankAmount.replace(/\./g, ''))
    if (!amt) return { ok: false, errorKey: 'amountRequired' }
    return { ok: true, payload: {
      asset_type: 'bank', fund_id: null, investment_date: date, amount_vnd: amt,
      interest_rate: form.rate ? Number(form.rate) : null, expiry_date: form.maturity || null,
      goal_id: goalId || null, notes: form.selectedBankName || note || null,
      bank_code: form.bankCode || null,
    } }
  }
  const gold = normalizeGold(form.goldQty, form.goldPrice, form.goldUnit)
  if (!gold) return { ok: false, errorKey: 'amountRequired' }
  return { ok: true, payload: {
    asset_type: 'gold', fund_id: null, investment_date: date,
    amount_vnd: gold.amountVnd, units: gold.unitsInChi, unit_price: gold.pricePerChi,
    goal_id: goalId || null, notes: form.goldProvider || null,
  } }
}

// Buy / create a new investment (POST). Adds the transaction_type + plan_id envelope
// (logging from the Plan page ties it to the month's plan).
export function buildBuyPayload(form: TxForm, planId: string | null): BuildResult {
  const { assetType, date, goalId, note } = form
  const base = {
    asset_type: assetType, transaction_type: 'investment', investment_date: date,
    notes: note || null, goal_id: goalId || null, plan_id: planId,
  }
  if (assetType === 'fund') {
    const amt = Number(form.amount.replace(/\./g, ''))
    if (!form.fundId) return { ok: false, errorKey: 'fundRequired' }
    if (!amt) return { ok: false, errorKey: 'amountRequired' }
    const navV = Number(form.nav) || form.selectedFundNav || null
    return { ok: true, payload: {
      ...base, fund_id: form.fundId, amount_vnd: amt,
      units: fundUnits(form.units, amt, navV), unit_price: navV,
    } }
  }
  if (assetType === 'bank') {
    const amt = Number(form.bankAmount.replace(/\./g, ''))
    if (!amt) return { ok: false, errorKey: 'amountRequired' }
    return { ok: true, payload: {
      ...base, amount_vnd: amt, notes: form.selectedBankName || note || null,
      bank_code: form.bankCode || null, interest_rate: form.rate ? Number(form.rate) : null,
      expiry_date: form.maturity || null,
      // An accumulating book: the route self-groups this anchor row for later top-ups.
      ...(form.depositType === 'accumulating' ? { accumulating: true } : {}),
      ...(form.depositType === 'accumulating' && form.topUpLockDays != null && form.topUpLockDays !== '' ? { top_up_lock_days: Number(form.topUpLockDays) } : {}),
    } }
  }
  const gold = normalizeGold(form.goldQty, form.goldPrice, form.goldUnit)
  if (!gold) return { ok: false, errorKey: 'amountRequired' }
  return { ok: true, payload: {
    ...base, amount_vnd: gold.amountVnd, units: gold.unitsInChi, unit_price: gold.pricePerChi,
    notes: form.goldProvider || null,
  } }
}

// The subset of a holding the sell builder needs (superset-compatible with the
// sheet's Holding).
export interface SellHolding {
  type: AssetType
  transactionId?: string
  fundId?: string
  /**
   * The goal the holding sits in, null when unallocated. A fund's balance is the
   * (goal, fund) bucket the dashboard aggregates — and the one the server measures
   * a sell against (#587) — so a sell that dropped this drew down the wrong
   * bucket: the goal's holding stayed put and the sell is now refused outright.
   */
  goalId?: string | null
  purchasePrice?: number | null
  /**
   * Fund only: the bucket's remaining cost basis (Σ amount_vnd, net of prior
   * sells) as the dashboard reports it. A sale takes it out directly instead of
   * reconstructing it from the averaged purchasePrice (#587, lib/fundWithdrawal).
   */
  costBasis?: number | null
  currentValue: number
  units?: number | null
}

// Sell / withdraw from a holding (POST). Reuses the already-computed SellPreview so
// the derived figures (proceeds, cost basis, principal portions) aren't re-derived.
export function buildSellPayload(
  holding: SellHolding | null,
  preview: Pick<SellPreview,
    'numSell' | 'sellOverMax' | 'sellNav' | 'numGoldSellQty' | 'isOverUnits' |
    'goldProceeds' | 'goldCost' | 'numReceived' | 'bankWithdrawPrincipal'>,
  opts: { date: string; note: string },
): BuildResult {
  const { date, note } = opts
  if (!holding) return { ok: false, errorKey: 'holdingRequired' }

  if (holding.type === 'gold' && holding.transactionId) {
    if (preview.numGoldSellQty <= 0) return { ok: false, errorKey: 'amountRequired' }
    if (preview.isOverUnits) return { ok: false, errorKey: 'exceedsBalance' }
    return { ok: true, payload: {
      transaction_type: 'withdrawal', asset_type: 'gold',
      parent_transaction_id: holding.transactionId,
      investment_date: date, amount_vnd: preview.goldProceeds,
      units_withdrawn: parseFloat(preview.numGoldSellQty.toFixed(4)),
      principal_withdrawn: preview.goldCost ?? preview.goldProceeds,
      goal_id: holding.goalId ?? null, notes: note || null,
    } }
  }
  if (holding.type === 'fund' && holding.fundId) {
    if (!preview.numSell) return { ok: false, errorKey: 'amountRequired' }
    if (preview.sellOverMax) return { ok: false, errorKey: 'exceedsBalance' }
    // Round the units FIRST: they are what the basis is allocated from, so a
    // mismatch at the 4th decimal is a đồng the holding may not have (#587).
    const unitsWithdrawn = parseFloat(
      (preview.sellNav ? preview.numSell / preview.sellNav : (holding.units ?? 0)).toFixed(4))
    const principalWithdrawn = fundCostBasis({
      totalBasis: holding.costBasis, totalUnits: holding.units, sellUnits: unitsWithdrawn,
    }) ?? Math.round(preview.numSell)
    return { ok: true, payload: {
      transaction_type: 'withdrawal', asset_type: 'fund', fund_id: holding.fundId,
      investment_date: date, amount_vnd: Math.round(preview.numSell),
      units_withdrawn: unitsWithdrawn,
      principal_withdrawn: principalWithdrawn,
      goal_id: holding.goalId ?? null, notes: note || null,
    } }
  }
  if (holding.transactionId) {
    if (!preview.numSell) return { ok: false, errorKey: 'amountRequired' }
    if (preview.sellOverMax) return { ok: false, errorKey: 'exceedsBalance' }
    // Bank: received cash is what the user gets; the principal withdrawn is the
    // amount they entered, so the gain/loss is recorded accurately (#578).
    const isBankSell = holding.type === 'bank'
    if (isBankSell && preview.numReceived <= 0) return { ok: false, errorKey: 'amountRequired' }
    return { ok: true, payload: {
      transaction_type: 'withdrawal', asset_type: holding.type,
      parent_transaction_id: holding.transactionId, investment_date: date,
      amount_vnd: isBankSell ? Math.round(preview.numReceived) : Math.round(preview.numSell),
      principal_withdrawn: isBankSell ? preview.bankWithdrawPrincipal : Math.round(preview.numSell),
      goal_id: holding.goalId ?? null, notes: note || null,
    } }
  }
  return { ok: false, errorKey: 'holdingRequired' }
}
