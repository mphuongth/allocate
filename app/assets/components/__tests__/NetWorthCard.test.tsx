import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import NetWorthCard from '../NetWorthCard'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
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
}

describe('NetWorthCard', () => {
  it('renders net worth formatted', () => {
    render(<NetWorthCard {...baseProps} />)
    // Hero uses fmt(netWorth) → full precision e.g. ₫ 500.000.000
    const matches = screen.getAllByText('₫ 500.000.000')
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0]).toBeInTheDocument()
  })

  it('renders overall P&L in positive color when positive', () => {
    render(<NetWorthCard {...baseProps} />)
    // P/L uses fmtCompact: "+100.0M ₫" with inline color var(--c-pos)
    const plEl = screen.getByText(/\+100\.0M/)
    expect(plEl).toHaveStyle({ color: 'var(--c-pos)' })
  })

  it('renders overall P&L in negative color when negative', () => {
    render(<NetWorthCard {...baseProps} overallProfitLoss={-50_000_000} overallProfitLossPercentage={-10} />)
    const plEl = screen.getByText(/-50\.0M/)
    expect(plEl).toHaveStyle({ color: 'var(--c-neg)' })
  })

  it('renders allocation breakdown with amount column per segment', () => {
    render(<NetWorthCard {...baseProps} allocationBar={{ fund: 300_000_000, bank: 110_000_000, gold: 0, stock: 40_000_000 }} />)
    // The allocation bar itself renders when there are investments (the
    // dashboard E2E used to assert this testid through a browser).
    expect(screen.getByTestId('allocation-bar')).toBeInTheDocument()
    // Distinct values that don't collide with P/L (100M) so getByText is unambiguous
    expect(screen.getByText(/300\.0M/)).toBeInTheDocument()
    expect(screen.getByText(/110\.0M/)).toBeInTheDocument()
    expect(screen.getByText(/40\.0M/)).toBeInTheDocument()
  })

  it('does not render the allocation bar when there is no allocation data', () => {
    render(<NetWorthCard {...baseProps} />)
    expect(screen.queryByTestId('allocation-bar')).not.toBeInTheDocument()
  })

  it('renders gold row with units (chỉ) when goldUnits provided', () => {
    render(<NetWorthCard {...baseProps} allocationBar={{ fund: 100_000_000, bank: 0, gold: 80_000_000, stock: 0, goldUnits: 12 }} />)
    expect(screen.getByText('12 units')).toBeInTheDocument()
  })

  it('falls back to monetary value for gold when goldUnits not provided', () => {
    render(<NetWorthCard {...baseProps} allocationBar={{ fund: 100_000_000, bank: 0, gold: 80_000_000, stock: 0 }} />)
    // No goldUnits → shows the compact value (80.0M)
    expect(screen.getByText(/80\.0M/)).toBeInTheDocument()
  })
})
