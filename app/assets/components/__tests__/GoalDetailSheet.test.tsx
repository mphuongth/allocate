import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GoalDetailSheet from '../GoalDetailSheet'
import type { GoalData } from '../../DashboardClient'

vi.mock('next-intl', () => ({ useLocale: () => 'en' }))

const mockFund = {
  fundId: 'fund-1',
  fundName: 'VNINDEX ETF',
  fundType: 'equity',
  quantity: 100,
  currentNAV: 25_000,
  currentValue: 2_500_000,
  purchasePrice: 22_000,
  profitLoss: 300_000,
  profitLossPercentage: 13.64,
  goalId: 'goal-1',
}

const mockGoal: GoalData = {
  goalId: 'goal-1',
  goalName: 'House Fund',
  targetAmount: 500_000_000,
  currentValue: 2_500_000,
  totalInvested: 2_200_000,
  profitLoss: 300_000,
  profitLossPercentage: 13.64,
  progressPercentage: 0.5,
  transactionCount: 1,
  funds: [mockFund],
}

const mockTx = {
  transaction_id: 'tx-1',
  transaction_type: 'buy',
  asset_type: 'fund',
  fund_id: 'fund-1',
  fund_name: 'VNINDEX ETF',
  fund_code: 'VNIDX',
  investment_date: '2024-01-15',
  amount_vnd: 2_200_000,
  units: 100,
  unit_price: 22_000,
  interest_rate: null,
  expiry_date: null,
  notes: null,
  principal_withdrawn: null,
  units_withdrawn: null,
}

const mockPurchaseHistory = [
  { nav_at_purchase: 22_000, units_purchased: 100, investment_date: '2024-01-15', created_at: '2024-01-15T00:00:00Z' },
]

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('investment-transactions')) {
      return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockTx] }) })
    }
    if (url.includes('fund-investments')) {
      return Promise.resolve({ ok: true, json: async () => mockPurchaseHistory })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
})

const baseProps = {
  goal: mockGoal,
  open: true,
  onClose: vi.fn(),
  onDataChanged: vi.fn(),
}

describe('GoalDetailSheet — transaction history integration', () => {
  it('opens TransactionHistorySheet when "Transaction history" is tapped on a fund', async () => {
    render(<GoalDetailSheet {...baseProps} />)

    // Wait for the goal sheet and investments to load
    await waitFor(() => expect(screen.getByText('VNINDEX ETF')).toBeInTheDocument())

    // Tap the ⋯ options button on the fund row
    const optionsBtn = screen.getByRole('button', { name: /options/i })
    await userEvent.click(optionsBtn)

    // InvestmentActionSheet appears — tap "Transaction history" action
    await waitFor(() => expect(screen.getAllByText('Transaction history').length).toBeGreaterThan(0))
    await userEvent.click(screen.getAllByText('Transaction history')[0])

    // TransactionHistorySheet should now be visible with the fund name as h1
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'VNINDEX ETF' })).toBeInTheDocument()
    )
  })

  it('fetches purchase history when TransactionHistorySheet opens', async () => {
    render(<GoalDetailSheet {...baseProps} />)

    await waitFor(() => screen.getByText('VNINDEX ETF'))
    await userEvent.click(screen.getByRole('button', { name: /options/i }))
    await waitFor(() => screen.getAllByText('Transaction history').length > 0)
    await userEvent.click(screen.getAllByText('Transaction history')[0])

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('fund-investments?fund_id=fund-1')
    ))
  })

  it('closes TransactionHistorySheet and returns to goal view via Back button', async () => {
    render(<GoalDetailSheet {...baseProps} />)

    await waitFor(() => screen.getByText('VNINDEX ETF'))
    await userEvent.click(screen.getByRole('button', { name: /options/i }))
    await waitFor(() => screen.getAllByText('Transaction history').length > 0)
    await userEvent.click(screen.getAllByText('Transaction history')[0])
    await waitFor(() => screen.getByRole('heading', { name: 'VNINDEX ETF' }))

    // Click back in the history sheet
    await userEvent.click(screen.getByRole('button', { name: /back/i }))

    // TransactionHistorySheet should be gone (its h1 = fund name disappears)
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'VNINDEX ETF' })).not.toBeInTheDocument()
    )
  })
})
