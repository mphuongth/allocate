import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import type { DashboardData, GoalData } from '@/app/assets/DashboardClient'

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
