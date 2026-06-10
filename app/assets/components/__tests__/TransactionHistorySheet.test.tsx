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
  it('renders the fund name as the h1 title', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByRole('heading', { name: 'VNINDEX ETF' })).toBeInTheDocument()
  })

  it('renders "Holding" as the small subtitle', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText('Holding')).toBeInTheDocument()
  })

  it('renders the current value in compact format', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText('30.0M ₫')).toBeInTheDocument()
  })

  it('shows positive P/L with + sign and compact format', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText('+7.9M ₫')).toBeInTheDocument()
  })

  it('shows negative P/L with − sign', () => {
    render(<TransactionHistorySheet {...baseProps} profitLoss={-1_000_000} profitLossPercentage={-5} />)
    expect(screen.getByText('-1.0M ₫')).toBeInTheDocument()
  })

  it('shows Invested stat', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText('Invested')).toBeInTheDocument()
  })

  it('shows Units stat', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText('Units')).toBeInTheDocument()
  })

  it('shows NAV stat', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByText('NAV')).toBeInTheDocument()
  })

  it('renders each row with Buy label and date · units', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    const buyLabels = screen.getAllByText('Buy')
    expect(buyLabels).toHaveLength(2)
    expect(screen.getByText(/Jan.*2024.*60/i)).toBeInTheDocument()
    expect(screen.getByText(/Jun.*2024.*40/i)).toBeInTheDocument()
  })

  it('shows the row skeleton when loading=true', () => {
    render(<TransactionHistorySheet {...baseProps} purchaseHistory={[]} loading={true} />)
    expect(screen.getByTestId('skeleton-tx-rows')).toBeInTheDocument()
  })

  it('shows empty state when no history and not loading', () => {
    render(<TransactionHistorySheet {...baseProps} purchaseHistory={[]} loading={false} />)
    expect(screen.getByText('No transaction history')).toBeInTheDocument()
  })

  it('calls onClose when back button is clicked', async () => {
    const onClose = vi.fn()
    render(<TransactionHistorySheet {...baseProps} onClose={onClose} />)
    await userEvent.click(screen.getByTestId('history-back-btn'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not render when open=false', () => {
    render(<TransactionHistorySheet {...baseProps} open={false} />)
    expect(screen.queryByRole('heading', { name: 'VNINDEX ETF' })).not.toBeInTheDocument()
  })

  it('renders Add transaction button next to section title', () => {
    render(<TransactionHistorySheet {...baseProps} />)
    expect(screen.getByRole('button', { name: /add transaction/i })).toBeInTheDocument()
  })

  it('does not crash when a row has null units or nav', () => {
    const historyWithNulls = [
      { purchase_date: '2024-01-15', units: null as unknown as number, nav_at_purchase: null as unknown as number },
    ]
    expect(() =>
      render(<TransactionHistorySheet {...baseProps} purchaseHistory={historyWithNulls} />)
    ).not.toThrow()
  })

  it('calls onAddTransaction when Add transaction button is clicked', async () => {
    const onAddTransaction = vi.fn()
    render(<TransactionHistorySheet {...baseProps} onAddTransaction={onAddTransaction} />)
    await userEvent.click(screen.getByRole('button', { name: /add transaction/i }))
    expect(onAddTransaction).toHaveBeenCalledOnce()
  })
})
