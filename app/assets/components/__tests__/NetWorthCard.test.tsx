import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import NetWorthCard from '../NetWorthCard'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

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

  it('shows stale NAV warning icon when navStale is true', () => {
    render(<NetWorthCard {...baseProps} navStale={true} />)
    expect(screen.getByText('⚠')).toBeInTheDocument()
  })

  it('does not show stale NAV warning when navStale is false', () => {
    render(<NetWorthCard {...baseProps} navStale={false} />)
    expect(screen.queryByText('⚠')).not.toBeInTheDocument()
  })
})
