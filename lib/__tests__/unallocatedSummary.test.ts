import { describe, it, expect } from 'vitest'
import { unallocatedSummary } from '@/lib/unallocatedSummary'
import type { DashboardData, FundBreakdownItem, NonFundUnallocatedItem } from '@/features/dashboard/contracts'

function fund(over: Partial<FundBreakdownItem> = {}): FundBreakdownItem {
  return {
    fundId: 'f1',
    fundName: 'VESAF',
    fundType: 'equity',
    quantity: 100,
    currentNAV: 12_000,
    currentValue: 1_200_000,
    purchasePrice: 10_000,
    costBasis: 1_000_000,
    profitLoss: 200_000,
    profitLossPercentage: 20,
    goalId: null,
    ...over,
  }
}

function nonFund(over: Partial<NonFundUnallocatedItem> = {}): NonFundUnallocatedItem {
  return {
    transactionId: 't1',
    type: 'bank',
    amount: 2_000_000,
    currentValue: 2_100_000,
    interestRate: 5,
    expiryDate: null,
    investmentDate: '2026-01-01',
    notes: null,
    units: null,
    ...over,
  }
}

function unallocated(over: Partial<DashboardData['unallocated']> = {}): DashboardData['unallocated'] {
  return { totalValue: 0, funds: [], nonFunds: [], ...over }
}

describe('unallocatedSummary', () => {
  it('is empty when there is nothing unallocated', () => {
    expect(unallocatedSummary(unallocated(), true)).toEqual({
      hasHoldings: false,
      items: [],
      totalInvested: 0,
      currentValue: 0,
      profitLoss: 0,
      profitLossPercentage: 0,
    })
  })

  it('sums funds and non-funds into one total', () => {
    const summary = unallocatedSummary(unallocated({ funds: [fund()], nonFunds: [nonFund()] }), true)
    expect(summary).toMatchObject({
      hasHoldings: true,
      totalInvested: 3_000_000,
      currentValue: 3_300_000,
      profitLoss: 300_000,
      profitLossPercentage: 10,
    })
  })

  it('derives profit/loss from the value less the cost basis, not from summed percentages', () => {
    const summary = unallocatedSummary(unallocated({
      funds: [fund({ costBasis: 1_000_000, currentValue: 1_500_000, profitLoss: 500_000, profitLossPercentage: 50 })],
      nonFunds: [nonFund({ amount: 9_000_000, currentValue: 9_000_000 })],
    }), true)
    expect(summary.totalInvested).toBe(10_000_000)
    expect(summary.profitLoss).toBe(500_000)
    expect(summary.profitLossPercentage).toBe(5)
  })

  it('reports a loss', () => {
    const summary = unallocatedSummary(unallocated({ nonFunds: [nonFund({ amount: 1_000_000, currentValue: 800_000 })] }), true)
    expect(summary.profitLoss).toBe(-200_000)
    expect(summary.profitLossPercentage).toBe(-20)
  })

  it('holds the percentage at zero when nothing was invested', () => {
    const summary = unallocatedSummary(unallocated({ nonFunds: [nonFund({ amount: 0, currentValue: 0 })] }), true)
    expect(summary.hasHoldings).toBe(true)
    expect(summary.profitLossPercentage).toBe(0)
  })
})

describe('unallocatedSummary — per-holding rows', () => {
  it('lists each fund and each non-fund tranche, funds first', () => {
    const summary = unallocatedSummary(unallocated({
      funds: [fund({ fundId: 'f2', fundName: 'DCDS' })],
      nonFunds: [nonFund({ transactionId: 't9', notes: 'Sổ VCB 6 tháng' })],
    }), true)
    expect(summary.items).toEqual([
      {
        id: 'f2',
        name: 'DCDS',
        totalInvested: 1_000_000,
        currentValue: 1_200_000,
        profitLoss: 200_000,
        profitLossPercentage: 20,
      },
      {
        id: 't9',
        name: 'Sổ VCB 6 tháng',
        totalInvested: 2_000_000,
        currentValue: 2_100_000,
        profitLoss: 100_000,
        profitLossPercentage: 5,
      },
    ])
  })

  it('names a note-less bank deposit in the caller locale', () => {
    const vi = unallocatedSummary(unallocated({ nonFunds: [nonFund({ notes: null })] }), true)
    const en = unallocatedSummary(unallocated({ nonFunds: [nonFund({ notes: null })] }), false)
    expect(vi.items[0].name).toBe('Tiền gửi')
    expect(en.items[0].name).toBe('Bank deposit')
  })

  it('names note-less gold and falls back to the raw type otherwise', () => {
    const gold = unallocatedSummary(unallocated({ nonFunds: [nonFund({ type: 'gold', notes: null })] }), true)
    expect(gold.items[0].name).toBe('Vàng')
    const goldEn = unallocatedSummary(unallocated({ nonFunds: [nonFund({ type: 'gold', notes: null })] }), false)
    expect(goldEn.items[0].name).toBe('Gold')
    const stock = unallocatedSummary(unallocated({ nonFunds: [nonFund({ type: 'stock', notes: null })] }), true)
    expect(stock.items[0].name).toBe('stock')
  })

  it("holds a holding's percentage at zero when it cost nothing", () => {
    const summary = unallocatedSummary(unallocated({ nonFunds: [nonFund({ amount: 0, currentValue: 0 })] }), true)
    expect(summary.items[0].profitLossPercentage).toBe(0)
  })

  it('has no rows when nothing is unallocated', () => {
    expect(unallocatedSummary(unallocated(), true).items).toEqual([])
  })
})
