import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import type { DashboardData, GoalData } from '@/features/dashboard/contracts'

vi.mock('@react-pdf/renderer', () => ({
  Document: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  Page: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  View: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  Text: ({ children }: { children: React.ReactNode }) => React.createElement('span', null, children),
  StyleSheet: { create: (s: unknown) => s },
  Font: { register: vi.fn() },
  pdf: vi.fn(() => ({
    toBlob: vi.fn().mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
  })),
}))

const baseNetWorth: DashboardData['netWorth'] = {
  totalAssets: 500_000_000,
  totalLiabilities: 0,
  netWorth: 500_000_000,
  totalInvested: 400_000_000,
  currentValue: 500_000_000,
  overallProfitLoss: 100_000_000,
  overallProfitLossPercentage: 25,
  navStale: false,
  hasGold: false,
  navUpdatedAt: null,
}

const mockGoal: GoalData = {
  goalId: 'g1',
  goalName: 'Mua nhà',
  targetAmount: 1_000_000_000,
  targetDate: null,
  currentValue: 300_000_000,
  totalInvested: 250_000_000,
  profitLoss: 50_000_000,
  profitLossPercentage: 20,
  progressPercentage: 30,
  transactionCount: 2,
  funds: [],
}

const mockData: DashboardData = {
  netWorth: baseNetWorth,
  goals: [mockGoal],
  unallocated: { totalValue: 0, funds: [], nonFunds: [] },
  byType: { bank: 100_000_000, gold: 0, stock: 0 },
  insurance: [],
}

describe('PortfolioReport', () => {
  it('renders without throwing with valid data', async () => {
    const { PortfolioReport } = await import('@/components/report/PortfolioReport')
    expect(() => React.createElement(PortfolioReport, { data: mockData })).not.toThrow()
  })

  it('renders without throwing when goals array is empty', async () => {
    const { PortfolioReport } = await import('@/components/report/PortfolioReport')
    const emptyGoalsData: DashboardData = { ...mockData, goals: [] }
    expect(() => React.createElement(PortfolioReport, { data: emptyGoalsData })).not.toThrow()
  })

  it('renders without throwing when a goal has no target (targetAmount is null)', async () => {
    const { PortfolioReport } = await import('@/components/report/PortfolioReport')
    const noTargetGoal: GoalData = { ...mockGoal, targetAmount: null, progressPercentage: null }
    const data: DashboardData = { ...mockData, goals: [noTargetGoal] }
    expect(() => React.createElement(PortfolioReport, { data })).not.toThrow()
  })

  it('renders without throwing when all asset types are zero', async () => {
    const { PortfolioReport } = await import('@/components/report/PortfolioReport')
    const zeroed: DashboardData = {
      ...mockData,
      byType: { bank: 0, gold: 0, stock: 0 },
    }
    expect(() => React.createElement(PortfolioReport, { data: zeroed })).not.toThrow()
  })

  it('renders without throwing when overallProfitLoss is negative', async () => {
    const { PortfolioReport } = await import('@/components/report/PortfolioReport')
    const lossData: DashboardData = {
      ...mockData,
      netWorth: { ...baseNetWorth, overallProfitLoss: -50_000_000, overallProfitLossPercentage: -10 },
    }
    expect(() => React.createElement(PortfolioReport, { data: lossData })).not.toThrow()
  })
})

describe('PortfolioReport — unallocated holdings', () => {
  afterEach(cleanup)

  const unallocatedFund = {
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
  }

  it('prints the unallocated total and its profit, without a row per holding', async () => {
    const { PortfolioReport } = await import('@/components/report/PortfolioReport')
    const data: DashboardData = {
      ...mockData,
      unallocated: { totalValue: 1_200_000, funds: [unallocatedFund], nonFunds: [] },
    }
    render(React.createElement(PortfolioReport, { data, locale: 'vi' }))

    expect(screen.getByText('Đầu tư chưa phân bổ')).toBeInTheDocument()
    // Once in the asset-allocation total, once as the unallocated total.
    expect(screen.getAllByText('₫ 1.200.000')).toHaveLength(2)
    expect(screen.getByText('+₫ 200.000 (+20.00%)')).toBeInTheDocument()
    // Only the total — the fund's own name never appears.
    expect(screen.queryByText('VESAF')).not.toBeInTheDocument()
  })

  it('prints a loss on the unallocated total', async () => {
    const { PortfolioReport } = await import('@/components/report/PortfolioReport')
    const data: DashboardData = {
      ...mockData,
      unallocated: {
        totalValue: 800_000,
        funds: [],
        nonFunds: [{
          transactionId: 't1',
          type: 'bank',
          amount: 1_000_000,
          currentValue: 800_000,
          interestRate: null,
          expiryDate: null,
          investmentDate: '2026-01-01',
          notes: null,
          units: null,
        }],
      },
    }
    render(React.createElement(PortfolioReport, { data, locale: 'vi' }))

    expect(screen.getByText('₫ -200.000 (-20.00%)')).toBeInTheDocument()
  })

  it('omits the section entirely when nothing is unallocated', async () => {
    const { PortfolioReport } = await import('@/components/report/PortfolioReport')
    render(React.createElement(PortfolioReport, { data: mockData, locale: 'vi' }))

    expect(screen.queryByText('Đầu tư chưa phân bổ')).not.toBeInTheDocument()
  })

  it('labels the section in English', async () => {
    const { PortfolioReport } = await import('@/components/report/PortfolioReport')
    const data: DashboardData = {
      ...mockData,
      unallocated: { totalValue: 1_200_000, funds: [unallocatedFund], nonFunds: [] },
    }
    render(React.createElement(PortfolioReport, { data, locale: 'en' }))

    expect(screen.getByText('Unallocated Investments')).toBeInTheDocument()
  })
})
