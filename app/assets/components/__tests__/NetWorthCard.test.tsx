import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import NetWorthCard from '../NetWorthCard'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })

const baseProps = {
  totalAssets: 500_000_000,
  totalLiabilities: 0,
  netWorth: 500_000_000,
  totalInvested: 400_000_000,
  currentValue: 450_000_000,
  overallProfitLoss: 100_000_000,
  overallProfitLossPercentage: 25,
  navStale: false,
}

describe('NetWorthCard', () => {
  it('renders totalAssets formatted', () => {
    render(<NetWorthCard {...baseProps} />)
    // totalAssets appears in the heading (text-4xl); use getAllByText and check at least one exists
    const matches = screen.getAllByText('₫ 500.000.000')
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0]).toBeInTheDocument()
  })

  it('renders overall P&L in green when positive', () => {
    render(<NetWorthCard {...baseProps} />)
    const plEl = screen.getByText(/₫ 100\.000\.000/)
    expect(plEl.closest('p')).toHaveClass('text-green-600')
  })

  it('renders overall P&L in red when negative', () => {
    render(<NetWorthCard {...baseProps} overallProfitLoss={-50_000_000} overallProfitLossPercentage={-10} />)
    const plEl = screen.getByText(/₫ -50\.000\.000/)
    expect(plEl.closest('p')).toHaveClass('text-red-600')
  })

  it('shows stale NAV warning icon when navStale is true', () => {
    render(<NetWorthCard {...baseProps} navStale={true} />)
    expect(screen.getByText('⚠')).toBeInTheDocument()
  })

  it('does not show stale NAV warning when navStale is false', () => {
    render(<NetWorthCard {...baseProps} navStale={false} />)
    expect(screen.queryByText('⚠')).not.toBeInTheDocument()
  })
})
