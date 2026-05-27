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
  targetDate: null,
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

describe('GoalDetailSheet — DCA pending row filtering', () => {
  it('excludes DCA-seeded rows with null units from transaction history', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockTx] }) })
      }
      if (url.includes('fund-investments')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            // real transaction
            { nav_at_purchase: 22_000, units_purchased: 100, investment_date: '2024-01-15', created_at: '2024-01-15T00:00:00Z', is_dca_seeded: false },
            // pending DCA placeholder — should be excluded
            { nav_at_purchase: null, units_purchased: null, investment_date: '2026-05-01', created_at: '2026-05-01T00:00:00Z', is_dca_seeded: true },
          ],
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<GoalDetailSheet {...baseProps} />)
    await waitFor(() => screen.getByText('VNINDEX ETF'))
    await userEvent.click(screen.getByRole('button', { name: /options/i }))
    await waitFor(() => screen.getAllByText('Transaction history').length > 0)
    await userEvent.click(screen.getAllByText('Transaction history')[0])
    await waitFor(() => screen.getByRole('heading', { name: 'VNINDEX ETF' }))

    // Only 1 real row — the pending DCA row must not appear
    expect(screen.getAllByText('Buy')).toHaveLength(1)
    // DCA row date (May 2026) must not be in the document
    expect(screen.queryByText(/May.*2026/i)).not.toBeInTheDocument()
  })
})

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
    await userEvent.click(screen.getByTestId('history-back-btn'))

    // TransactionHistorySheet should be gone (its h1 = fund name disappears)
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'VNINDEX ETF' })).not.toBeInTheDocument()
    )
  })
})

describe('GoalDetailSheet — unassign from goal', () => {
  it('InvestmentActionSheet exposes an "Unassign from goal" option', async () => {
    render(<GoalDetailSheet {...baseProps} />)
    await waitFor(() => screen.getByText('VNINDEX ETF'))
    await userEvent.click(screen.getByRole('button', { name: /options/i }))
    await waitFor(() =>
      expect(screen.getAllByText(/unassign from goal/i).length).toBeGreaterThan(0)
    )
  })

  it('opens the confirmation sheet when Unassign is tapped', async () => {
    render(<GoalDetailSheet {...baseProps} />)
    await waitFor(() => screen.getByText('VNINDEX ETF'))
    await userEvent.click(screen.getByRole('button', { name: /options/i }))
    await waitFor(() => screen.getAllByText(/unassign from goal/i).length > 0)
    // Click the action-sheet row labeled "Unassign from goal"
    await userEvent.click(screen.getAllByText(/unassign from goal/i)[0])
    // The confirm sheet uses a different title ("Unassign from goal?")
    await waitFor(() =>
      expect(screen.getByText(/unassign from goal\?/i)).toBeInTheDocument()
    )
  })

  it('fires PATCH on fund-investments/:id/goal with goal_id null when confirmed (fund row)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/investment-transactions') && (!init || init.method === undefined || init.method === 'GET')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockTx] }) })
      }
      if (url.includes('/api/v1/fund-investments?fund_id=')) {
        return Promise.resolve({ ok: true, json: async () => ({ investments: [{ id: 'fi-1' }, { id: 'fi-2' }] }) })
      }
      if (url.includes('/api/v1/fund-investments/') && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    global.fetch = fetchMock

    const onDataChanged = vi.fn()
    render(<GoalDetailSheet {...baseProps} onDataChanged={onDataChanged} />)
    await waitFor(() => screen.getByText('VNINDEX ETF'))
    await userEvent.click(screen.getByRole('button', { name: /options/i }))
    await waitFor(() => screen.getAllByText(/unassign from goal/i).length > 0)
    await userEvent.click(screen.getAllByText(/unassign from goal/i)[0])
    await waitFor(() => screen.getByText(/unassign from goal\?/i))

    // The confirm button is labeled "Unassign" (without ?), distinct from the action-row text
    const confirmBtn = screen.getByRole('button', { name: /^unassign$/i })
    await userEvent.click(confirmBtn)

    // Each fund-investment under this fund must be PATCHed to goal_id: null
    await waitFor(() => {
      const patchCalls = (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>).filter(
        ([url, init]) => url.includes('/api/v1/fund-investments/') && init?.method === 'PATCH'
      )
      expect(patchCalls.length).toBe(2)
      patchCalls.forEach(([, init]) => {
        expect(String(init?.body ?? '')).toContain('"goal_id":null')
      })
    })
    await waitFor(() => expect(onDataChanged).toHaveBeenCalled())
  })

  it('cancelling the confirm sheet does not fire any fetch', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/investment-transactions') && (!init || init.method === undefined)) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockTx] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    global.fetch = fetchMock

    render(<GoalDetailSheet {...baseProps} />)
    await waitFor(() => screen.getByText('VNINDEX ETF'))
    await userEvent.click(screen.getByRole('button', { name: /options/i }))
    await waitFor(() => screen.getAllByText(/unassign from goal/i).length > 0)
    await userEvent.click(screen.getAllByText(/unassign from goal/i)[0])
    await waitFor(() => screen.getByText(/unassign from goal\?/i))

    fetchMock.mockClear()
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    // No further fetch calls (especially no PATCH or PUT)
    const writes = (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>).filter(
      ([, init]) => init?.method === 'PATCH' || init?.method === 'PUT' || init?.method === 'DELETE'
    )
    expect(writes.length).toBe(0)
  })
})

describe('GoalDetailSheet — refreshKey triggers refetch', () => {
  it('refetches /investment-transactions when refreshKey changes', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockTx] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    global.fetch = fetchMock

    const { rerender } = render(<GoalDetailSheet {...baseProps} refreshKey={0} />)
    await waitFor(() =>
      expect(
        (fetchMock.mock.calls as Array<[string]>).filter(
          ([url]) => url.includes('/api/v1/investment-transactions?goal_id=goal-1')
        ).length
      ).toBe(1)
    )

    rerender(<GoalDetailSheet {...baseProps} refreshKey={1} />)
    await waitFor(() =>
      expect(
        (fetchMock.mock.calls as Array<[string]>).filter(
          ([url]) => url.includes('/api/v1/investment-transactions?goal_id=goal-1')
        ).length
      ).toBeGreaterThanOrEqual(2)
    )
  })

  it('shows a tx again on refetch even if it was previously unassigned in the same session', async () => {
    // Regression: the unassign flow appends the tx id to a local
    // unassignedIds[] to hide the row optimistically. If the user then
    // re-assigns the same tx (from Unallocated → goal A), the API
    // response includes it but the optimistic filter still hides it.
    // The refetch must clear unassignedIds so the new server response
    // is the source of truth.
    let assigned = true
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/investment-transactions') && (!init || init.method === undefined || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ transactions: assigned ? [mockTx] : [] }),
        })
      }
      if (url.includes('/api/v1/fund-investments?fund_id=')) {
        return Promise.resolve({ ok: true, json: async () => ({ investments: [{ id: 'fi-1' }] }) })
      }
      if (url.includes('/api/v1/fund-investments/') && init?.method === 'PATCH') {
        // Simulate that the unassign succeeded: the next GET will omit the tx
        assigned = false
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    global.fetch = fetchMock

    const { rerender } = render(<GoalDetailSheet {...baseProps} refreshKey={0} />)
    await waitFor(() => screen.getByText('VNINDEX ETF'))

    // 1) Unassign the tx
    await userEvent.click(screen.getByRole('button', { name: /options/i }))
    await waitFor(() => screen.getAllByText(/unassign from goal/i).length > 0)
    await userEvent.click(screen.getAllByText(/unassign from goal/i)[0])
    await waitFor(() => screen.getByText(/unassign from goal\?/i))
    await userEvent.click(screen.getByRole('button', { name: /^unassign$/i }))

    // 2) Row vanishes optimistically — unassignedIds contains the tx
    await waitFor(() => expect(screen.queryByText('VNINDEX ETF')).not.toBeInTheDocument())

    // 3) User re-assigns elsewhere; the server now returns the tx again.
    // A dashboard refresh (refreshKey bump) must clear unassignedIds so the
    // re-assigned tx becomes visible without a hard reload.
    assigned = true
    rerender(<GoalDetailSheet {...baseProps} refreshKey={1} />)

    await waitFor(() => expect(screen.getByText('VNINDEX ETF')).toBeInTheDocument(), { timeout: 3_000 })
  })
})
