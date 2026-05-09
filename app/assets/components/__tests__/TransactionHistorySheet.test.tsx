import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TransactionHistorySheet from '../TransactionHistorySheet'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
}))

const baseProps = {
  open: true,
  onClose: vi.fn(),
  fundName: 'VNINDEX ETF',
  currentNAV: 25_000,
  quantity: 100.5,
  currentValue: 30_000_000,
  purchasePrice: 22_000,
  profitLoss: 7_900_000,
  profitLossPercentage: 35.77,
  purchaseHistory: [
    { purchase_date: '2024-01-15', units: 60.25, nav_at_purchase: 20_000 },
    { purchase_date: '2024-06-01', units: 40.25, nav_at_purchase: 24_000 },
  ],
}

describe('TransactionHistorySheet', () => {
  it('renders the fund name in the header', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText('VNINDEX ETF')).toBeInTheDocument()
  })

  it('renders the current value', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText('₫ 30.000.000')).toBeInTheDocument()
  })

  it('shows positive P/L with + sign', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText(/\+.*7\.900\.000/)).toBeInTheDocument()
  })

  it('shows negative P/L with − sign', () => {
    render(<TransactionHistorySheet {...baseProps} profitLoss={-1_000_000} profitLossPercentage={-5} />)
    expect(screen.getByText(/−.*1\.000\.000|₫ -1\.000\.000|-₫/)).toBeInTheDocument()
  })

  it('shows current NAV stat chip', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText('Current NAV')).toBeInTheDocument()
  })

  it('shows units held stat chip', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText('Units held')).toBeInTheDocument()
  })

  it('shows purchase count matching history length', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders each purchase history row with date and units', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText(/60.*units.*20\.000|60.*CCQ/i)).toBeInTheDocument()
    expect(screen.getByText(/40.*units.*24\.000|40.*CCQ/i)).toBeInTheDocument()
  })

  it('shows loading state when loading=true', () => {
    render(<TransactionHistorySheet {...baseProps} purchaseHistory={[]} loading={true} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows empty state when no history and not loading', () => {
    render(<TransactionHistorySheet {...baseProps} purchaseHistory={[]} loading={false} />)
    expect(screen.getByText('No transaction history')).toBeInTheDocument()
  })

  it('calls onClose when back button is clicked', async () => {
    const onClose = vi.fn()
    render(<TransactionHistorySheet {...baseProps} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /back|close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not render when open=false', () => {
    render(<TransactionHistorySheet {...baseProps} open={false} />)
    expect(screen.queryByText('VNINDEX ETF')).not.toBeInTheDocument()
  })
})
