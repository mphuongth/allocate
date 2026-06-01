import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DesktopGoalDetail from '../DesktopGoalDetail'
import type { GoalData } from '../../DashboardClient'

const mockGoal: GoalData = {
  goalId: 'goal-1',
  goalName: 'House Fund',
  targetAmount: 500_000_000,
  targetDate: null,
  currentValue: 9_000_000,
  totalInvested: 9_000_000,
  profitLoss: 0,
  profitLossPercentage: 0,
  progressPercentage: 1.8,
  transactionCount: 1,
  funds: [],
}

const baseProps = {
  goal: mockGoal,
  locale: 'en',
  onClose: vi.fn(),
  onDataChanged: vi.fn(),
}

describe('DesktopGoalDetail — gold sell uses current price (issue #251)', () => {
  // Bought 1 chỉ at 9,000,000. Current market price is 9,200,000.
  const mockGoldTx = {
    transaction_id: 'tx-gold-1',
    transaction_type: 'investment',
    asset_type: 'gold',
    fund_id: null,
    fund_name: null,
    investment_date: '2026-01-01',
    amount_vnd: 9_000_000,
    units: 1,
    interest_rate: null,
    notes: 'PNJ Gold',
    principal_withdrawn: null,
    units_withdrawn: null,
  }

  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockGoldTx] }) })
      }
      if (url.includes('gold-price')) {
        return Promise.resolve({ ok: true, json: async () => ({ price_per_chi: 9_200_000 }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  })

  it('prefills the sale price with the current gold price, not the buy price', async () => {
    render(<DesktopGoalDetail {...baseProps} />)
    await waitFor(() => screen.getByText('PNJ Gold'))

    await userEvent.click(screen.getByRole('button', { name: 'Options' }))
    await waitFor(() => expect(screen.getByText('Sell')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Sell'))

    const priceInput = await screen.findByTestId('sell-gold-price-input')
    // Must be the live market price (9,200,000), not the 9,000,000 buy price.
    await waitFor(() => expect((priceInput as HTMLInputElement).value).toBe('9200000'))
  })
})

describe('DesktopGoalDetail — bank withdrawal links to the goal (issue #261)', () => {
  const mockBankTx = {
    transaction_id: 'tx-bank-1',
    transaction_type: 'investment',
    asset_type: 'bank',
    fund_id: null,
    fund_name: null,
    parent_transaction_id: null,
    investment_date: '2026-01-01',
    amount_vnd: 10_000_000,
    units: null,
    interest_rate: 6,
    notes: 'Techcombank',
    principal_withdrawn: null,
    units_withdrawn: null,
  }

  let postBody: Record<string, unknown> | null

  beforeEach(() => {
    postBody = null
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('investment-transactions') && init?.method === 'POST') {
        postBody = JSON.parse(String(init.body))
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockBankTx] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  })

  it('posts the withdrawal with the goal_id so it is no longer shown at full value', async () => {
    render(<DesktopGoalDetail {...baseProps} />)
    await waitFor(() => screen.getByText('Techcombank'))

    await userEvent.click(screen.getByRole('button', { name: 'Options' }))
    await waitFor(() => expect(screen.getByText('Withdraw')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Withdraw'))

    // Fill the full balance, then confirm the withdrawal.
    await userEvent.click(await screen.findByRole('button', { name: 'All' }))
    await userEvent.click(await screen.findByRole('button', { name: /Confirm withdrawal/i }))

    await waitFor(() => expect(postBody).not.toBeNull())
    expect(postBody!.transaction_type).toBe('withdrawal')
    expect(postBody!.parent_transaction_id).toBe('tx-bank-1')
    expect(postBody!.goal_id).toBe('goal-1')
  })
})
