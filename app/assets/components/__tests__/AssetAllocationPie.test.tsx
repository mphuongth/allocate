import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AssetAllocationPie from '../AssetAllocationPie'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('recharts', () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const baseProps = {
  equityTotal: 0,
  bondTotal: 0,
  balancedTotal: 0,
  bankTotal: 0,
  goldTotal: 0,
  stockTotal: 0,
  cashTotal: 0,
  totalAssets: 0,
}

describe('AssetAllocationPie', () => {
  it('renders without crashing when all values are zero', () => {
    render(<AssetAllocationPie {...baseProps} />)
    expect(screen.getByText('Asset Allocation')).toBeInTheDocument()
  })

  it('shows no legend rows when all values are zero', () => {
    render(<AssetAllocationPie {...baseProps} />)
    expect(screen.queryByText('typeEquity')).not.toBeInTheDocument()
    expect(screen.queryByText('assetBank')).not.toBeInTheDocument()
  })

  it('shows only non-zero asset legend rows', () => {
    render(<AssetAllocationPie {...baseProps} equityTotal={50_000_000} bankTotal={30_000_000} totalAssets={80_000_000} />)
    expect(screen.getByText('typeEquity')).toBeInTheDocument()
    expect(screen.getByText('assetBank')).toBeInTheDocument()
    expect(screen.queryByText('typeDebt')).not.toBeInTheDocument()
    expect(screen.queryByText('assetGold')).not.toBeInTheDocument()
  })

  it('shows correct percentage for each asset', () => {
    render(<AssetAllocationPie {...baseProps} equityTotal={60_000_000} bankTotal={40_000_000} totalAssets={100_000_000} />)
    const pcts = screen.getAllByText(/\d+%/)
    const pctValues = pcts.map((el) => el.textContent)
    expect(pctValues).toContain('60%')
    expect(pctValues).toContain('40%')
  })

  it('shows 0% when totalAssets is zero but an item has value', () => {
    render(<AssetAllocationPie {...baseProps} equityTotal={10_000_000} totalAssets={0} />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })
})
