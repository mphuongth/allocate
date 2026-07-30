import { describe, it, expect } from 'vitest'
import {
  computeFundPricing, computeSellPreview, bankReceivedPrefill, buildBuyPayload, buildEditPayload, buildSellPayload,
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
    expect(s.bankPctOfPrincipal).toBe(1)
    expect(s.bankWithdrawPrincipal).toBe(5_000_000)
    expect(s.bankGain).toBe(200_000)         // received − principal withdrawn
    expect(s.sellDisabled).toBe(false)
  })

  it('disables when nothing received', () => {
    const s = computeSellPreview({ assetType: 'bank', dir: 'sell', holding: bank, sellAmount: '5000000', received: '0', goldSellQty: '', goldSellPrice: '' })
    expect(s.sellDisabled).toBe(true)
  })
})

// Same defect as the withdrawal sheet's (#578), in the Add-transaction sell path:
// the entered amount was converted into a fraction of the deposit's current value
// and applied to the principal, so a partial withdrawal never recorded the
// principal the user typed. Only reachable when value != principal, which the
// `bank` fixture above (5M on 5M) can't express.
describe('computeSellPreview — partial bank withdrawal where value != principal (#578)', () => {
  const book: PreviewHolding = {
    type: 'bank', currentValue: 20_385_398, navPerUnit: null, gainPct: null,
    purchasePrice: 20_239_452, units: null,
  }

  it('withdraws exactly the entered principal, and reports the interest paid', () => {
    const s = computeSellPreview({ assetType: 'bank', dir: 'sell', holding: book, sellAmount: '4365100', received: '4366416', goldSellQty: '', goldSellPrice: '' })
    // The old proportional conversion produced 4,333,849 and a gain of 32,567.
    expect(s.bankWithdrawPrincipal).toBe(4_365_100)
    expect(s.bankGain).toBe(1_316)
    expect(s.sellRemaining).toBe(15_874_352)
    expect(s.sellDisabled).toBe(false)
  })

  it('caps the withdrawal at the remaining principal, not the current value', () => {
    const s = computeSellPreview({ assetType: 'bank', dir: 'sell', holding: book, sellAmount: '20300000', received: '20300000', goldSellQty: '', goldSellPrice: '' })
    expect(s.sellMax).toBe(20_239_452)
    expect(s.sellOverMax).toBe(true)
    expect(s.sellDisabled).toBe(true)
  })

  it('still caps a fund sell at its current value', () => {
    const s = computeSellPreview({ assetType: 'fund', dir: 'sell', holding: fund, sellAmount: '1900000', ...base })
    expect(s.sellMax).toBe(2_000_000)
    expect(s.sellOverMax).toBe(false)
  })

  it('prefills the received cash with the interest accrued on that principal', () => {
    expect(bankReceivedPrefill(book, 4_365_100)).toBe(4_396_577)
    // "All" withdraws the whole principal and estimates the whole current value.
    expect(bankReceivedPrefill(book, 20_239_452)).toBe(20_385_398)
  })

  it('prefills nothing extra for a holding it has no principal for', () => {
    expect(bankReceivedPrefill(null, 1_000)).toBe(1_000)
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
  const zero = { numSell: 0, sellOverMax: false, sellNav: null, numGoldSellQty: 0, isOverUnits: false, goldProceeds: 0, goldCost: null, numReceived: 0, bankWithdrawPrincipal: 0 }

  it('fund: proportional principal_withdrawn + units_withdrawn=amount÷NAV', () => {
    // costBasis is what those 100 units cost; the sale takes half of it because it
    // sells half the units. purchasePrice is display-only now (#587).
    const holding = { type: 'fund' as const, fundId: 'f1', purchasePrice: 18_000, costBasis: 1_800_000, currentValue: 2_000_000, units: 100 }
    const preview = { ...zero, numSell: 1_000_000, sellNav: 20_000 }
    const p = ok(buildSellPayload(holding, preview, { date, note: '' }))
    expect(p).toEqual({
      transaction_type: 'withdrawal', asset_type: 'fund', fund_id: 'f1', investment_date: date,
      amount_vnd: 1_000_000, units_withdrawn: 50,
      principal_withdrawn: 900_000, goal_id: null, notes: null,   // (1M/2M)×(18000×100)
    })
  })

  // The dashboard aggregates a fund per (goal, fund), and so does the balance the
  // server now measures a sell against (#587). A sell of a goal-allocated fund
  // posted with goal_id: null drew down the Unallocated bucket instead — the
  // goal's holding never moved, and once the server enforces the balance that
  // sell is refused outright. The sell has to carry the holding's own goal.
  it('fund: the sell belongs to the goal the holding sits in', () => {
    const holding = {
      type: 'fund' as const, fundId: 'f1', goalId: 'goal-1',
      purchasePrice: 18_000, currentValue: 2_000_000, units: 100,
    }
    const preview = { ...zero, numSell: 1_000_000, sellNav: 20_000 }
    expect(ok(buildSellPayload(holding, preview, { date, note: '' }))).toMatchObject({ goal_id: 'goal-1' })
  })

  it('non-fund sells carry the holding’s goal too', () => {
    const bank = { type: 'bank' as const, transactionId: 't1', goalId: 'goal-2', purchasePrice: 5_000_000, currentValue: 5_000_000 }
    expect(ok(buildSellPayload(bank, { ...zero, numSell: 5_000_000, numReceived: 5_200_000, bankWithdrawPrincipal: 5_000_000 }, { date, note: '' })))
      .toMatchObject({ goal_id: 'goal-2' })

    const gold = { type: 'gold' as const, transactionId: 'g1', goalId: 'goal-3', currentValue: 18_400_000, units: 2 }
    expect(ok(buildSellPayload(gold, { ...zero, numGoldSellQty: 1, goldProceeds: 9_200_000, goldCost: 9_000_000 }, { date, note: '' })))
      .toMatchObject({ goal_id: 'goal-3' })
  })

  it('an unallocated holding still sells with no goal', () => {
    const holding = { type: 'fund' as const, fundId: 'f1', goalId: null, purchasePrice: 18_000, currentValue: 2_000_000, units: 100 }
    expect(ok(buildSellPayload(holding, { ...zero, numSell: 1_000_000, sellNav: 20_000 }, { date, note: '' })))
      .toMatchObject({ goal_id: null })
  })

  it('bank: amount is the received cash, principal is what the user entered', () => {
    const holding = { type: 'bank' as const, transactionId: 't1', purchasePrice: 5_000_000, currentValue: 5_000_000 }
    const preview = { ...zero, numSell: 5_000_000, numReceived: 5_200_000, bankWithdrawPrincipal: 5_000_000 }
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

  // Selling the lot must post the holding's own principal, not a figure derived
  // through a rounded per-unit price: 123,456,789 / 10 rounds up to 12,345,679,
  // and ×10 is a đồng more than the holding has — which the server refuses as an
  // overdraw (#587). Preview and payload have to agree on the exact basis.
  it('gold: selling the lot posts exactly the remaining principal', () => {
    const holding = {
      type: 'gold' as const, transactionId: 'g1', currentValue: 130_000_000,
      units: 10, purchasePrice: 123_456_789, navPerUnit: 13_000_000, gainPct: null,
    }
    const preview = computeSellPreview({
      assetType: 'gold', dir: 'sell', holding, sellAmount: '', received: '',
      goldSellQty: '10', goldSellPrice: '13000000',
    })

    expect(preview.goldCost).toBe(123_456_789)
    expect(ok(buildSellPayload(holding, preview, { date, note: '' })))
      .toMatchObject({ principal_withdrawn: 123_456_789, units_withdrawn: 10 })
  })

  it('validation: no holding → holdingRequired; over balance → exceedsBalance; bank no received → amountRequired', () => {
    expect(buildSellPayload(null, zero, { date, note: '' })).toEqual({ ok: false, errorKey: 'holdingRequired' })
    const fund = { type: 'fund' as const, fundId: 'f1', currentValue: 2_000_000, units: 100 }
    expect(buildSellPayload(fund, { ...zero, numSell: 3_000_000, sellOverMax: true }, { date, note: '' })).toEqual({ ok: false, errorKey: 'exceedsBalance' })
    const bank = { type: 'bank' as const, transactionId: 't1', currentValue: 5_000_000 }
    expect(buildSellPayload(bank, { ...zero, numSell: 5_000_000, numReceived: 0 }, { date, note: '' })).toEqual({ ok: false, errorKey: 'amountRequired' })
  })
})
