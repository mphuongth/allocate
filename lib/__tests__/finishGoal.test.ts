import { describe, it, expect } from 'vitest'
import {
  goalCompletion,
  buildFinishHoldings,
  finishHoldingKey,
  realizedFor,
  finishPlanFrom,
  isFinishPlanComplete,
  totalRealized,
  type FinishInput,
} from '../finishGoal'
import type { InvRow } from '@/features/dashboard/contracts'

const row = (over: Partial<InvRow>): InvRow => ({
  id: 'tx-1', name: 'Deposit', type: 'bank', value: 1_000_000, gainPct: null,
  units: null, principal: 1_000_000, interestRate: null, expiryDate: null,
  investmentDate: '2026-01-01', fund: null, ...over,
})

const fund = (over: Partial<InvRow>): InvRow => row({
  id: 'fund-row', type: 'fund', name: 'VESAF', units: 250,
  fund: { fundId: 'f1', fundName: 'VESAF', quantity: 250, currentValue: 5_000_000 } as InvRow['fund'],
  ...over,
})

describe('goalCompletion', () => {
  it('is null while the goal is active', () => {
    expect(goalCompletion({})).toBeNull()
    expect(goalCompletion({ completedAt: null, completionValue: 5, completionPercentage: 100 })).toBeNull()
  })

  it('reads the snapshot, not the (now zero) balance', () => {
    expect(goalCompletion({
      completedAt: '2026-08-13T00:00:00Z', completionValue: 30_000_000, completionPercentage: 100,
    })).toEqual({ value: 30_000_000, percentage: 100 })
  })

  it('still reads as complete on a payload cached before the columns existed', () => {
    expect(goalCompletion({ completedAt: '2026-08-13T00:00:00Z' })).toEqual({ value: 0, percentage: 100 })
  })
})

describe('finishHoldingKey', () => {
  it('keys a fund position by its fund, not by the transaction it happens to render', () => {
    // The same fund can be split across goals, and the holdings tab dedups the
    // goal's purchases into one row — the sale draws on that whole bucket.
    expect(finishHoldingKey(fund({ id: 'whatever-tx' }))).toBe('fund:f1')
  })

  it('keys an accumulating book by its anchor', () => {
    expect(finishHoldingKey(row({ id: 'book-1', depositGroupId: 'book-1' }))).toBe('book:book-1')
  })

  it('keys everything else by its own transaction', () => {
    expect(finishHoldingKey(row({ id: 'tx-9' }))).toBe('tx:tx-9')
  })
})

describe('buildFinishHoldings', () => {
  it('asks for the cash received on a deposit, prefilled with what it is worth today', () => {
    const [h] = buildFinishHoldings([row({ value: 1_050_000, principal: 1_000_000 })])
    expect(h.input).toBe('received')
    expect(h.suggested).toBe(1_050_000)
    expect(h.units).toBeNull()
  })

  it('asks for a sale price per chỉ on gold, prefilled from the live price', () => {
    const [h] = buildFinishHoldings([row({ type: 'gold', units: 2, value: 8_600_000 })])
    expect(h.input).toBe('unitPrice')
    // 8,600,000 over 2 chỉ — the price the value was computed at.
    expect(h.suggested).toBe(4_300_000)
    expect(h.units).toBe(2)
  })

  it('leaves a recurring saving out — it is a plan, not a holding to sell', () => {
    // A synthesized `recurring:<id>:<date>` row has no transaction to withdraw;
    // posting one is a 400. It blocks the finish instead (#640).
    expect(buildFinishHoldings([row({ id: 'recurring:s1', isRecurring: true })])).toEqual([])
  })

  it('keeps every real holding, one entry each', () => {
    const holdings = buildFinishHoldings([
      row({ id: 'tx-1' }),
      row({ id: 'book-1', depositGroupId: 'book-1' }),
      fund({}),
      row({ id: 'gold-1', type: 'gold', units: 1 }),
    ])
    expect(holdings.map((h) => h.key)).toEqual(['tx:tx-1', 'book:book-1', 'fund:f1', 'tx:gold-1'])
  })
})

describe('realizedFor', () => {
  const gold = buildFinishHoldings([row({ id: 'g', type: 'gold', units: 2.5, value: 10_000_000 })])[0]
  const deposit = buildFinishHoldings([row({ value: 1_050_000 })])[0]

  it('multiplies a gold sale out to proceeds', () => {
    expect(realizedFor(gold, '4300000')).toBe(10_750_000)
  })

  it('rounds gold proceeds to the đồng', () => {
    expect(realizedFor(gold, '4300001')).toBe(10_750_003) // 2.5 × 4,300,001 = 10,750,002.5
  })

  it('takes a received amount as entered', () => {
    expect(realizedFor(deposit, '1020000')).toBe(1_020_000)
  })

  it('reads an empty or unparsable field as nothing realized yet', () => {
    expect(realizedFor(deposit, '')).toBeNull()
    expect(realizedFor(deposit, 'abc')).toBeNull()
  })

  it('refuses a negative realization', () => {
    expect(realizedFor(deposit, '-1')).toBeNull()
  })

  it('refuses zero — a withdrawal of no cash is a row the ledger will not take', () => {
    // amount_vnd must be positive, so posting zero would roll the whole finish
    // back. Better a disabled button than a failed submit.
    expect(realizedFor(deposit, '0')).toBeNull()
  })

  it('refuses a gold price that rounds the proceeds away to nothing', () => {
    const dust = buildFinishHoldings([row({ id: 'd', type: 'gold', units: 0.0001, value: 1 })])[0]
    expect(realizedFor(dust, '0.4')).toBeNull()
  })
})

describe('isFinishPlanComplete', () => {
  const holdings = buildFinishHoldings([row({ id: 'a' }), row({ id: 'b' })])

  it('is incomplete while a holding has no figure', () => {
    expect(isFinishPlanComplete(holdings, { 'tx:a': '100' })).toBe(false)
  })

  it('is complete once every holding is realized', () => {
    expect(isFinishPlanComplete(holdings, { 'tx:a': '100', 'tx:b': '200' })).toBe(true)
  })

  it('is complete for a goal whose holdings are already gone', () => {
    // Nothing left to liquidate is a legitimate finish: the user withdrew
    // everything by hand and now wants the goal archived rather than deleted.
    expect(isFinishPlanComplete([], {})).toBe(true)
  })
})

describe('totalRealized / finishPlanFrom', () => {
  const holdings = buildFinishHoldings([
    row({ id: 'a', value: 1_000_000 }),
    row({ id: 'g', type: 'gold', units: 2, value: 8_000_000 }),
  ])
  const inputs: FinishInput = { 'tx:a': '1050000', 'tx:g': '4300000' }

  it('sums what the whole finish brings in', () => {
    expect(totalRealized(holdings, inputs)).toBe(1_050_000 + 8_600_000)
  })

  it('sums only what has been filled in so far', () => {
    expect(totalRealized(holdings, { 'tx:a': '1050000' })).toBe(1_050_000)
  })

  it('posts one plan entry per holding, keyed the way the server groups them', () => {
    expect(finishPlanFrom(holdings, inputs)).toEqual([
      { key: 'tx:a', received: 1_050_000 },
      { key: 'tx:g', received: 8_600_000 },
    ])
  })

  it('omits an unrealized holding rather than posting it as zero', () => {
    // The server refuses a plan that leaves a live holding out, which is the
    // point: a half-filled sheet must not archive the goal on a guess of zero.
    expect(finishPlanFrom(holdings, { 'tx:a': '1050000' })).toEqual([
      { key: 'tx:a', received: 1_050_000 },
    ])
  })
})
