import { describe, it, expect } from 'vitest'
import { goalHoldingsSummary } from '@/lib/goalHoldingsSummary'
import type { FundBreakdownItem, GoalData, NonFundUnallocatedItem } from '@/features/dashboard/contracts'

function fund(over: Partial<FundBreakdownItem> = {}): FundBreakdownItem {
  return {
    fundId: 'f1',
    fundName: 'E1VFVN30',
    fundType: 'etf',
    quantity: 100,
    currentNAV: 12_000,
    currentValue: 1_200_000,
    purchasePrice: 10_000,
    costBasis: 1_000_000,
    profitLoss: 200_000,
    profitLossPercentage: 20,
    goalId: 'g1',
    ...over,
  }
}

function deposit(over: Partial<NonFundUnallocatedItem> = {}): NonFundUnallocatedItem {
  return {
    transactionId: 't1',
    type: 'bank',
    amount: 2_000_000,
    currentValue: 2_100_000,
    interestRate: 5,
    expiryDate: '2027-01-01',
    investmentDate: '2026-01-01',
    notes: 'Sổ VCB',
    units: null,
    ...over,
  }
}

function goal(over: Partial<GoalData> = {}): GoalData {
  return {
    goalId: 'g1',
    goalName: 'Wealth Max',
    targetAmount: 100_000_000,
    targetDate: null,
    currentValue: 0,
    totalInvested: 0,
    profitLoss: 0,
    profitLossPercentage: 0,
    progressPercentage: 0,
    transactionCount: 0,
    funds: [],
    ...over,
  }
}

describe('goalHoldingsSummary', () => {
  it('lists every fund and deposit in the goal, each with its own value and P/L', () => {
    const s = goalHoldingsSummary(goal({
      currentValue: 3_300_000,
      funds: [fund()],
      nonFunds: [deposit()],
    }), true)

    expect(s.items.map((i) => i.name)).toEqual(['E1VFVN30', 'Sổ VCB'])
    expect(s.items[0]).toMatchObject({ currentValue: 1_200_000, profitLoss: 200_000, profitLossPercentage: 20 })
    expect(s.items[1]).toMatchObject({ currentValue: 2_100_000, profitLoss: 100_000, profitLossPercentage: 5 })
  })

  it('lists gold and stock holdings too, named by type when they carry no note', () => {
    const s = goalHoldingsSummary(goal({
      currentValue: 3_000_000,
      nonFunds: [
        deposit({ transactionId: 'g', type: 'gold', notes: null, amount: 1_000_000, currentValue: 1_000_000 }),
        deposit({ transactionId: 's', type: 'stock', notes: 'FPT', amount: 2_000_000, currentValue: 2_000_000 }),
      ],
    }), true)

    expect(s.items.map((i) => i.name)).toEqual(['Vàng', 'FPT'])
  })

  it('prints an accumulating book as one holding, not one row per tranche', () => {
    const s = goalHoldingsSummary(goal({
      currentValue: 3_150_000,
      nonFunds: [
        deposit({ transactionId: 'anchor', depositGroupId: 'anchor', notes: 'Sổ tích luỹ ACB', amount: 1_000_000, currentValue: 1_050_000 }),
        deposit({ transactionId: 'tr2', depositGroupId: 'anchor', notes: 'Sổ tích luỹ ACB', amount: 2_000_000, currentValue: 2_100_000 }),
      ],
    }), true)

    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({
      id: 'anchor',
      name: 'Sổ tích luỹ ACB',
      totalInvested: 3_000_000,
      currentValue: 3_150_000,
      profitLoss: 150_000,
      profitLossPercentage: 5,
    })
  })

  it('lists cash held for a merge as its own line at face value', () => {
    const s = goalHoldingsSummary(goal({
      currentValue: 5_000_000,
      heldForMerge: [{ transactionId: 'h1', amount: 5_000_000, anchorInvId: null, name: 'Sổ BIDV' }],
    }), true)

    expect(s.items).toEqual([expect.objectContaining({
      id: 'h1', name: 'Sổ BIDV · Đang chờ gộp', currentValue: 5_000_000, profitLoss: 0,
    })])
  })

  it('names the recurring savings the plan has credited — value with no holding row', () => {
    // 1.2M fund + 3M of realized recurring-saving months that have no row.
    const s = goalHoldingsSummary(goal({ currentValue: 4_200_000, funds: [fund()] }), true)

    expect(s.recurringValue).toBe(3_000_000)
  })

  it('reconciles: the lines add up to the goal value the app shows', () => {
    const g = goal({
      currentValue: 10_300_000,
      funds: [fund()],
      nonFunds: [deposit()],
      heldForMerge: [{ transactionId: 'h1', amount: 5_000_000, anchorInvId: null, name: null }],
    })
    const s = goalHoldingsSummary(g, true)

    const sum = s.items.reduce((acc, i) => acc + i.currentValue, 0) + s.recurringValue
    expect(sum).toBe(g.currentValue)
    expect(s.recurringValue).toBe(2_000_000)
  })

  it('reports no recurring line when the holdings already make up the value', () => {
    // Float noise from NAV × units must not print a "₫ 0" line.
    const s = goalHoldingsSummary(goal({ currentValue: 1_200_000.0000001, funds: [fund()] }), true)

    expect(s.recurringValue).toBe(0)
  })

  it('carries what was spent for the goal, so value + spent = the progress numerator', () => {
    // 31.2M paid out with "count toward goal progress" switched off.
    const s = goalHoldingsSummary(goal({ currentValue: 90_900_000, progressValue: 122_100_000 }), true)

    expect(s.spentForGoal).toBe(31_200_000)
    expect(s.progressValue).toBe(122_100_000)
  })

  it('reports nothing spent when the bar and the value agree, or the payload predates progressValue', () => {
    expect(goalHoldingsSummary(goal({ currentValue: 5, progressValue: 5 }), true).spentForGoal).toBe(0)

    const legacy = goalHoldingsSummary(goal({ currentValue: 7_000_000 }), true)
    expect(legacy.spentForGoal).toBe(0)
    expect(legacy.progressValue).toBe(7_000_000)
  })

  it('names note-less holdings in English', () => {
    const s = goalHoldingsSummary(goal({
      currentValue: 7_100_000,
      nonFunds: [deposit({ notes: null })],
      heldForMerge: [{ transactionId: 'h1', amount: 5_000_000, anchorInvId: null, name: null }],
    }), false)

    expect(s.items.map((i) => i.name)).toEqual(['Bank deposit', 'Held deposit · Held for merge'])
  })
})
