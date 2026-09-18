import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import type { DashboardData, GoalData } from '@/features/dashboard/contracts'
import { PortfolioReport } from '@/components/report/PortfolioReport'

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

  const deposit = {
    transactionId: 't1',
    type: 'bank',
    amount: 1_000_000,
    currentValue: 800_000,
    interestRate: null,
    expiryDate: null,
    investmentDate: '2026-01-01',
    notes: 'Sổ VCB',
    units: null,
  }

  it('prints a row per holding — name, value and its own profit/loss', () => {
    const data: DashboardData = {
      ...mockData,
      unallocated: { totalValue: 2_000_000, funds: [unallocatedFund], nonFunds: [deposit] },
    }
    render(React.createElement(PortfolioReport, { data, locale: 'vi' }))

    expect(screen.getByText('Đầu tư chưa phân bổ')).toBeInTheDocument()

    // The fund, at a profit.
    expect(screen.getByText('VESAF')).toBeInTheDocument()
    expect(screen.getByText('+₫ 200.000 (+20.00%)')).toBeInTheDocument()

    // The deposit, at a loss, named by its note.
    expect(screen.getByText('Sổ VCB')).toBeInTheDocument()
    expect(screen.getByText('₫ -200.000 (-20.00%)')).toBeInTheDocument()

    // Each holding's own current value.
    expect(screen.getAllByText('₫ 1.200.000').length).toBeGreaterThan(0)
    expect(screen.getByText('₫ 800.000')).toBeInTheDocument()
  })

  it('closes the section with the combined total and profit/loss', () => {
    const data: DashboardData = {
      ...mockData,
      unallocated: { totalValue: 2_000_000, funds: [unallocatedFund], nonFunds: [deposit] },
    }
    render(React.createElement(PortfolioReport, { data, locale: 'vi' }))

    expect(screen.getByText('Tổng cộng')).toBeInTheDocument()
    // 1.200.000 + 800.000 against 2.000.000 invested = flat.
    expect(screen.getByText('₫ 2.000.000')).toBeInTheDocument()
    expect(screen.getByText('+₫ 0 (+0.00%)')).toBeInTheDocument()
  })

  it('names a note-less deposit rather than leaving the row blank', () => {
    const data: DashboardData = {
      ...mockData,
      unallocated: { totalValue: 800_000, funds: [], nonFunds: [{ ...deposit, notes: null }] },
    }
    render(React.createElement(PortfolioReport, { data, locale: 'vi' }))

    expect(screen.getByText('Tiền gửi')).toBeInTheDocument()
  })

  it('omits the section entirely when nothing is unallocated', () => {
    render(React.createElement(PortfolioReport, { data: mockData, locale: 'vi' }))

    expect(screen.queryByText('Đầu tư chưa phân bổ')).not.toBeInTheDocument()
  })

  it('labels the section and a note-less deposit in English', () => {
    const data: DashboardData = {
      ...mockData,
      unallocated: { totalValue: 800_000, funds: [], nonFunds: [{ ...deposit, notes: null }] },
    }
    render(React.createElement(PortfolioReport, { data, locale: 'en' }))

    expect(screen.getByText('Unallocated Investments')).toBeInTheDocument()
    expect(screen.getByText('Bank deposit')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
  })
})
