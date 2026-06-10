import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import NetWorthCard from '../NetWorthCard'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}))
vi.mock('@/lib/formatters', () => ({
  fmt: (n: number) => `₫${n}`,
  fmtCompact: (n: number) => `₫${n}`,
  fmtPct: (n: number) => `${n}%`,
}))

const base = {
  totalAssets: 1, totalLiabilities: 0, netWorth: 100, totalInvested: 1,
  currentValue: 1, overallProfitLoss: 1, overallProfitLossPercentage: 1,
}

afterEach(() => vi.unstubAllGlobals())

// §03 "Re-fetching a value": the figure pulses + an XS Cairn sits beside it
// while the value is being recomputed — no skeleton (the value is still shown).
describe('NetWorthCard number-refresh', () => {
  it('pulses the value and shows an XS Cairn while refreshing', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })))
    const { container } = render(<NetWorthCard {...base} refreshing />)
    expect(container.querySelector('.num')).toBeInTheDocument()
    expect(container.querySelector('.cairn-loader')).toBeInTheDocument()
  })

  it('shows no loader or pulse when not refreshing', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })))
    const { container } = render(<NetWorthCard {...base} />)
    expect(container.querySelector('.cairn-loader')).toBeNull()
    expect(container.querySelector('.num')).toBeNull()
  })
})
