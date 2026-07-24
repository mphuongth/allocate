// Pure preview math for AddTransactionSheet (#467). These derivations feed the
// sheet's summary UI and the confirm-button gate; they were computed inline in the
// component. Keeping them here — free of React state and fetch — lets the numbers
// (NAV prefill, sell tax/gain, bank principal split, gold profit) be unit-tested
// directly. The DB-write payload builders inside handleSave are a separate concern
// and stay in the component for now.

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
  bankFraction: number
  bankPrincipalPortion: number
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

  const sellMax = h?.currentValue ?? 0
  const numSell = Number(sellAmount) || 0
  const sellOverMax = numSell > sellMax && sellMax > 0
  const sellRemaining = Math.max(0, sellMax - numSell)
  const sellNav = h?.navPerUnit ?? null
  const sellGainLoss = (numSell && assetType === 'fund' && h?.gainPct != null)
    ? numSell * h.gainPct / (100 + h.gainPct) : null
  const sellTax = assetType === 'fund' && numSell > 0 ? Math.round(numSell * 0.001) : null

  // Bank withdrawal: received cash is editable (early withdrawal can cut interest);
  // split the principal out so the summary can show the gain/loss.
  const numReceived = Number(received) || 0
  const bankPrincipal = h?.purchasePrice ?? sellMax
  const bankFraction = sellMax > 0 ? Math.min(1, numSell / sellMax) : 0
  const bankPrincipalPortion = Math.round(bankPrincipal * bankFraction)
  const bankGain = assetType === 'bank' && numReceived > 0 && numSell > 0 ? numReceived - bankPrincipalPortion : null

  // Gold sells are quantity-based: chỉ to sell × the sale price per chỉ.
  const goldMaxUnits = h?.units ?? 0
  const numGoldSellQty = Number(goldSellQty) || 0
  const numGoldSellPrice = Number(goldSellPrice) || 0
  const goldBuyUnit = h?.units && h.units > 0 && h.purchasePrice != null
    ? Math.round(h.purchasePrice / h.units) : null
  const goldProceeds = Math.round(numGoldSellQty * numGoldSellPrice)
  const goldCost = goldBuyUnit != null ? Math.round(numGoldSellQty * goldBuyUnit) : null
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
    numReceived, bankFraction, bankPrincipalPortion, bankGain,
    goldMaxUnits, numGoldSellQty, numGoldSellPrice, goldBuyUnit, goldProceeds, goldCost,
    goldProfit, goldRemUnits, isOverUnits, sellDisabled,
  }
}
