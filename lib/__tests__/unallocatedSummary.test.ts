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
    expect(unallocatedSummary(unallocated())).toEqual({
      hasHoldings: false,
      totalInvested: 0,
      currentValue: 0,
      profitLoss: 0,
      profitLossPercentage: 0,
    })
  })

  it('sums funds and non-funds into one total', () => {
    const summary = unallocatedSummary(unallocated({ funds: [fund()], nonFunds: [nonFund()] }))
    expect(summary).toEqual({
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
    }))
    expect(summary.totalInvested).toBe(10_000_000)
    expect(summary.profitLoss).toBe(500_000)
    expect(summary.profitLossPercentage).toBe(5)
  })

  it('reports a loss', () => {
    const summary = unallocatedSummary(unallocated({ nonFunds: [nonFund({ amount: 1_000_000, currentValue: 800_000 })] }))
    expect(summary.profitLoss).toBe(-200_000)
    expect(summary.profitLossPercentage).toBe(-20)
  })

  it('holds the percentage at zero when nothing was invested', () => {
    const summary = unallocatedSummary(unallocated({ nonFunds: [nonFund({ amount: 0, currentValue: 0 })] }))
    expect(summary.hasHoldings).toBe(true)
    expect(summary.profitLossPercentage).toBe(0)
  })
})
