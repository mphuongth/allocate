import { describe, it, expect } from 'vitest'
import {
  computeFundPricing, computeSellPreview, buildBuyPayload, buildEditPayload, buildSellPayload,
  type PreviewHolding, type TxForm,
} from '../addTransactionModel'

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

const emptyForm: TxForm = {
  assetType: 'fund', date: '2026-07-24', goalId: '', note: '',
  fundId: '', amount: '', units: '', nav: '', selectedFundNav: undefined,
  bankCode: '', selectedBankName: '', depositType: 'term', bankAmount: '', rate: '', maturity: '',
  goldProvider: '', goldUnit: 'chi', goldQty: '', goldPrice: '',
}
const form = (over: Partial<TxForm>): TxForm => ({ ...emptyForm, ...over })
const ok = (r: ReturnType<typeof buildBuyPayload>) => { if (!r.ok) throw new Error('expected ok'); return r.payload }

describe('buildBuyPayload', () => {
  it('fund: amount + units=amount÷NAV + plan envelope', () => {
    const p = ok(buildBuyPayload(form({ assetType: 'fund', fundId: 'f1', amount: '1.000.000', nav: '20000', goalId: 'g1' }), 'plan-9'))
    expect(p).toEqual({
      asset_type: 'fund', transaction_type: 'investment', investment_date: '2026-07-24',
      notes: null, goal_id: 'g1', plan_id: 'plan-9',
      fund_id: 'f1', amount_vnd: 1_000_000, units: 50, unit_price: 20_000,
    })
  })

  it('fund: missing fund → fundRequired; missing amount → amountRequired', () => {
    expect(buildBuyPayload(form({ assetType: 'fund', amount: '1000000' }), null)).toEqual({ ok: false, errorKey: 'fundRequired' })
    expect(buildBuyPayload(form({ assetType: 'fund', fundId: 'f1' }), null)).toEqual({ ok: false, errorKey: 'amountRequired' })
  })

  it('bank: accumulating flag only for an accumulating book; bank name becomes notes', () => {
    const p = ok(buildBuyPayload(form({ assetType: 'bank', bankAmount: '5.000.000', bankCode: 'VCB', selectedBankName: 'Vietcombank', depositType: 'accumulating', rate: '6', maturity: '2027-01-01' }), null))
    expect(p).toMatchObject({ asset_type: 'bank', amount_vnd: 5_000_000, bank_code: 'VCB', notes: 'Vietcombank', interest_rate: 6, expiry_date: '2027-01-01', accumulating: true })
    const term = ok(buildBuyPayload(form({ assetType: 'bank', bankAmount: '5000000', depositType: 'term' }), null))
    expect(term).not.toHaveProperty('accumulating')
  })

  it('gold: luông normalizes to chỉ (×10 units, ÷10 price)', () => {
    const p = ok(buildBuyPayload(form({ assetType: 'gold', goldUnit: 'luong', goldQty: '1', goldPrice: '92.000.000', goldProvider: 'PNJ' }), null))
    expect(p).toMatchObject({ asset_type: 'gold', amount_vnd: 92_000_000, units: 10, unit_price: 9_200_000, notes: 'PNJ' })
  })
})

describe('buildEditPayload', () => {
  it('fund: no transaction_type / plan_id', () => {
    const p = ok(buildEditPayload(form({ assetType: 'fund', fundId: 'f1', amount: '1000000', nav: '25000' })))
    expect(p).toEqual({
      asset_type: 'fund', fund_id: 'f1', investment_date: '2026-07-24',
      amount_vnd: 1_000_000, units: 40, unit_price: 25_000, goal_id: null, notes: null,
    })
    expect(p).not.toHaveProperty('transaction_type')
  })

  it('bank/gold carry explicit fund_id: null', () => {
    expect(ok(buildEditPayload(form({ assetType: 'bank', bankAmount: '5000000' })))).toMatchObject({ asset_type: 'bank', fund_id: null })
    expect(ok(buildEditPayload(form({ assetType: 'gold', goldQty: '2', goldPrice: '9000000' })))).toMatchObject({ asset_type: 'gold', fund_id: null, units: 2 })
  })
})

describe('buildSellPayload', () => {
  const date = '2026-07-24'
  const zero = { numSell: 0, sellOverMax: false, sellNav: null, numGoldSellQty: 0, isOverUnits: false, goldProceeds: 0, goldCost: null, numReceived: 0, bankPrincipalPortion: 0 }

  it('fund: proportional principal_withdrawn + units_withdrawn=amount÷NAV', () => {
    const holding = { type: 'fund' as const, fundId: 'f1', purchasePrice: 18_000, currentValue: 2_000_000, units: 100 }
    const preview = { ...zero, numSell: 1_000_000, sellNav: 20_000 }
    const p = ok(buildSellPayload(holding, preview, { date, note: '' }))
    expect(p).toEqual({
      transaction_type: 'withdrawal', asset_type: 'fund', fund_id: 'f1', investment_date: date,
      amount_vnd: 1_000_000, units_withdrawn: 50,
      principal_withdrawn: 900_000, goal_id: null, notes: null,   // (1M/2M)×(18000×100)
    })
  })

  it('bank: amount is received cash, principal is the split portion', () => {
    const holding = { type: 'bank' as const, transactionId: 't1', purchasePrice: 5_000_000, currentValue: 5_000_000 }
    const preview = { ...zero, numSell: 5_000_000, numReceived: 5_200_000, bankPrincipalPortion: 5_000_000 }
    expect(ok(buildSellPayload(holding, preview, { date, note: '' }))).toMatchObject({
      asset_type: 'bank', parent_transaction_id: 't1', amount_vnd: 5_200_000, principal_withdrawn: 5_000_000,
    })
  })

  it('gold: proceeds/cost/units_withdrawn', () => {
    const holding = { type: 'gold' as const, transactionId: 'g1', currentValue: 18_400_000, units: 2 }
    const preview = { ...zero, numGoldSellQty: 1, goldProceeds: 9_200_000, goldCost: 9_000_000 }
    expect(ok(buildSellPayload(holding, preview, { date, note: '' }))).toMatchObject({
      asset_type: 'gold', parent_transaction_id: 'g1', amount_vnd: 9_200_000, units_withdrawn: 1, principal_withdrawn: 9_000_000,
    })
  })

  it('validation: no holding → holdingRequired; over balance → exceedsBalance; bank no received → amountRequired', () => {
    expect(buildSellPayload(null, zero, { date, note: '' })).toEqual({ ok: false, errorKey: 'holdingRequired' })
    const fund = { type: 'fund' as const, fundId: 'f1', currentValue: 2_000_000, units: 100 }
    expect(buildSellPayload(fund, { ...zero, numSell: 3_000_000, sellOverMax: true }, { date, note: '' })).toEqual({ ok: false, errorKey: 'exceedsBalance' })
    const bank = { type: 'bank' as const, transactionId: 't1', currentValue: 5_000_000 }
    expect(buildSellPayload(bank, { ...zero, numSell: 5_000_000, numReceived: 0 }, { date, note: '' })).toEqual({ ok: false, errorKey: 'amountRequired' })
  })
})
