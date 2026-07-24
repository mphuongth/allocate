import { describe, it, expect } from 'vitest'
import { computeFundPricing, computeSellPreview, type PreviewHolding } from '../addTransactionModel'

// The Add-transaction sheet's preview math (#467): pure derivations that feed the
// summary UI (NAV prefill, sell gain/loss, bank principal split, gold profit) and
// the confirm-button gate. Extracted from AddTransactionSheet so the numbers can
// be pinned without a full component render.

describe('computeFundPricing', () => {
  it("falls back to the fund's current NAV and derives units from amount ÷ NAV", () => {
    const p = computeFundPricing({ nav: '', amount: '1.000.000', units: '', currentNav: 20_000 })
    expect(p.navNum).toBe(20_000)
    expect(p.displayNav).toBe('20000')      // shows the current NAV when the field is empty
    expect(p.navIsCurrent).toBe(true)
    expect(p.autoUnits).toBe('50.00')       // 1,000,000 ÷ 20,000
  })

  it('uses an edited NAV and flags it as no longer current', () => {
    const p = computeFundPricing({ nav: '25000', amount: '1000000', units: '', currentNav: 20_000 })
    expect(p.navNum).toBe(25_000)
    expect(p.displayNav).toBe('25000')
    expect(p.navIsCurrent).toBe(false)
    expect(p.autoUnits).toBe('40.00')       // 1,000,000 ÷ 25,000
  })

  it('leaves an explicit units entry untouched (two-way link stops overwriting it)', () => {
    const p = computeFundPricing({ nav: '', amount: '1000000', units: '12.5', currentNav: 20_000 })
    expect(p.autoUnits).toBe('12.5')
  })

  it('handles no selected fund (empty NAV, not current)', () => {
    const p = computeFundPricing({ nav: '', amount: '', units: '', currentNav: undefined })
    expect(p.navNum).toBe(0)
    expect(p.displayNav).toBe('')
    expect(p.navIsCurrent).toBe(false)
  })
})

const fund: PreviewHolding = { type: 'fund', currentValue: 2_000_000, navPerUnit: 20_000, gainPct: 25, purchasePrice: 18_000, units: 100 }
const bank: PreviewHolding = { type: 'bank', currentValue: 5_000_000, navPerUnit: null, gainPct: null, purchasePrice: 5_000_000, units: null }
const gold: PreviewHolding = { type: 'gold', currentValue: 18_400_000, navPerUnit: 9_200_000, gainPct: null, purchasePrice: 18_000_000, units: 2 }

const base = { received: '', goldSellQty: '', goldSellPrice: '' }

describe('computeSellPreview — fund', () => {
  it('derives max, tax (0.1%), gain/loss and enables the sell', () => {
    const s = computeSellPreview({ assetType: 'fund', dir: 'sell', holding: fund, sellAmount: '1000000', ...base })
    expect(s.sellMax).toBe(2_000_000)
    expect(s.numSell).toBe(1_000_000)
    expect(s.sellOverMax).toBe(false)
    expect(s.sellRemaining).toBe(1_000_000)
    expect(s.sellNav).toBe(20_000)
    expect(s.sellGainLoss).toBe(200_000)     // 1,000,000 × 25 / 125
    expect(s.sellTax).toBe(1_000)            // round(1,000,000 × 0.001)
    expect(s.sellDisabled).toBe(false)
  })

  it('flags over-balance and disables the sell', () => {
    const s = computeSellPreview({ assetType: 'fund', dir: 'sell', holding: fund, sellAmount: '3000000', ...base })
    expect(s.sellOverMax).toBe(true)
    expect(s.sellDisabled).toBe(true)
  })
})

describe('computeSellPreview — bank', () => {
  it('splits principal out of the received cash and shows the gain', () => {
    const s = computeSellPreview({ assetType: 'bank', dir: 'sell', holding: bank, sellAmount: '5000000', received: '5200000', goldSellQty: '', goldSellPrice: '' })
    expect(s.numReceived).toBe(5_200_000)
    expect(s.bankFraction).toBe(1)
    expect(s.bankPrincipalPortion).toBe(5_000_000)
    expect(s.bankGain).toBe(200_000)         // received − principal portion
    expect(s.sellDisabled).toBe(false)
  })

  it('disables when nothing received', () => {
    const s = computeSellPreview({ assetType: 'bank', dir: 'sell', holding: bank, sellAmount: '5000000', received: '0', goldSellQty: '', goldSellPrice: '' })
    expect(s.sellDisabled).toBe(true)
  })
})

describe('computeSellPreview — gold', () => {
  it('computes proceeds, cost basis (per-chi), profit and remaining units', () => {
    const s = computeSellPreview({ assetType: 'gold', dir: 'sell', holding: gold, sellAmount: '', received: '', goldSellQty: '1', goldSellPrice: '9200000' })
    expect(s.goldMaxUnits).toBe(2)
    expect(s.goldBuyUnit).toBe(9_000_000)    // round(18,000,000 ÷ 2)
    expect(s.goldProceeds).toBe(9_200_000)   // 1 × 9,200,000
    expect(s.goldCost).toBe(9_000_000)
    expect(s.goldProfit).toBe(200_000)
    expect(s.goldRemUnits).toBe(1)
    expect(s.isOverUnits).toBe(false)
    expect(s.sellDisabled).toBe(false)
  })

  it('flags selling more chi than held', () => {
    const s = computeSellPreview({ assetType: 'gold', dir: 'sell', holding: gold, sellAmount: '', received: '', goldSellQty: '3', goldSellPrice: '9200000' })
    expect(s.isOverUnits).toBe(true)
    expect(s.sellDisabled).toBe(true)
  })
})

describe('computeSellPreview — gates', () => {
  it('disables when no holding is selected (sell direction)', () => {
    const s = computeSellPreview({ assetType: 'fund', dir: 'sell', holding: null, sellAmount: '1000000', ...base })
    expect(s.sellDisabled).toBe(true)
  })

  it('never disables in the buy direction', () => {
    const s = computeSellPreview({ assetType: 'fund', dir: 'buy', holding: null, sellAmount: '', ...base })
    expect(s.sellDisabled).toBe(false)
  })
})
