import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GoalDetailSheet from '../GoalDetailSheet'
import type { GoalData } from '../../DashboardClient'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (k: string) => k,
}))

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

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

describe('GoalDetailSheet — add-to-goal CTA', () => {
  it('renders an "Add to this goal" CTA and calls onAddToGoal when clicked', async () => {
    const onAddToGoal = vi.fn()
    render(<GoalDetailSheet {...baseProps} onAddToGoal={onAddToGoal} />)

    await userEvent.click(await screen.findByTestId('goal-add-to-goal'))
    expect(onAddToGoal).toHaveBeenCalledTimes(1)
  })
})

describe('GoalDetailSheet — delete failure feedback', () => {
  it('shows an error toast and keeps the sheet open (no onClose) when the delete fails', async () => {
    toastErrorMock.mockClear()
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('savings-goals') && init?.method === 'DELETE') {
        return Promise.resolve({ ok: false, json: async () => ({}) })
      }
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    const onClose = vi.fn()
    const onDataChanged = vi.fn()

    render(<GoalDetailSheet {...baseProps} onClose={onClose} onDataChanged={onDataChanged} />)

    await userEvent.click(await screen.findByTestId('goal-options-btn'))
    await userEvent.click(await screen.findByTestId('goal-delete-action'))
    await userEvent.click(await screen.findByTestId('goal-delete-confirm'))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    expect(onDataChanged).not.toHaveBeenCalled()
  })
})

describe('GoalDetailSheet — investments load error vs empty', () => {
  // A goal with no overview funds, so the investments list depends entirely on
  // the (failing) transactions fetch.
  const noFundGoal: GoalData = { ...mockGoal, funds: [], currentValue: 9_000_000, transactionCount: 1 }
  const mockBankTx = {
    transaction_id: 'tx-bank-err', transaction_type: 'investment', asset_type: 'bank',
    fund_id: null, fund_name: null, investment_date: '2026-01-01', amount_vnd: 9_000_000,
    units: null, interest_rate: 6.5, notes: 'Techcombank', principal_withdrawn: null, units_withdrawn: null,
  }

  it('shows a retry state (not "No investments yet") when the transactions fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })

    render(<GoalDetailSheet {...baseProps} goal={noFundGoal} />)

    await waitFor(() => expect(screen.getByTestId('load-error')).toBeInTheDocument())
    expect(screen.queryByText('No investments yet')).not.toBeInTheDocument()
  })

  it('retry re-fetches and renders the investments on success', async () => {
    let call = 0
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        call += 1
        if (call === 1) return Promise.resolve({ ok: false, json: async () => ({}) })
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockBankTx] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<GoalDetailSheet {...baseProps} goal={noFundGoal} />)
    await waitFor(() => expect(screen.getByTestId('load-error')).toBeInTheDocument())

    await userEvent.click(screen.getByTestId('load-error-retry'))

    await waitFor(() => expect(screen.getByText('Techcombank')).toBeInTheDocument())
    expect(screen.queryByTestId('load-error')).not.toBeInTheDocument()
  })
})

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
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))
    await waitFor(() => screen.getAllByText('Transaction history').length > 0)
    await userEvent.click(screen.getAllByText('Transaction history')[0])
    await waitFor(() => screen.getByRole('heading', { name: 'VNINDEX ETF' }))

    // Only 1 real row — the pending DCA row must not appear
    expect(screen.getAllByText('Buy')).toHaveLength(1)
    // DCA row date (May 2026) must not be in the document
    expect(screen.queryByText(/May.*2026/i)).not.toBeInTheDocument()
  })
})

describe('GoalDetailSheet — History date matches Recent activity (issue #300)', () => {
  it('renders the History row date in the same "15 Jan 2024" format as the Recent activity card', async () => {
    render(<GoalDetailSheet {...baseProps} />)
    await waitFor(() => expect(screen.getByText('VNINDEX ETF')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'History' }))

    // Must match fmtTxDate (day: 2-digit, month: short, year: numeric — en-GB),
    // not the browser-default "1/15/2024" the History tab used to print.
    await waitFor(() => expect(screen.getByText('15 Jan 2024')).toBeInTheDocument())
    expect(screen.queryByText('1/15/2024')).not.toBeInTheDocument()
  })
})

describe('GoalDetailSheet — held settlement reads neutrally in History', () => {
  // Mobile mirror of the desktop History check: a parked settlement must show the
  // neutral "For merge" pill, not a red "−" withdrawal. Locks that the mobile History
  // tab calls txKind at render time.
  const heldTx = {
    transaction_id: 'tx-held-m1',
    transaction_type: 'withdrawal',
    held_for_merge: true,
    consumed_by_inv_id: null,
    asset_type: 'bank',
    fund_id: null,
    fund_name: null,
    investment_date: '2026-06-01',
    amount_vnd: 10_000_000,
    units: null,
    unit_price: null,
    interest_rate: null,
    expiry_date: null,
    notes: 'Parked deposit',
    principal_withdrawn: 10_000_000,
    units_withdrawn: null,
  }

  it('shows the neutral "For merge" pill in the History tab', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [heldTx] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<GoalDetailSheet {...baseProps} />)
    await userEvent.click(await screen.findByRole('button', { name: 'History' }))
    expect(await screen.findByText('For merge')).toBeInTheDocument()
  })
})

describe('GoalDetailSheet — transaction history integration', () => {
  it('opens TransactionHistorySheet when "Transaction history" is tapped on a fund', async () => {
    render(<GoalDetailSheet {...baseProps} />)

    // Wait for the goal sheet and investments to load
    await waitFor(() => expect(screen.getByText('VNINDEX ETF')).toBeInTheDocument())

    // Tap the ⋯ options button on the fund row
    const optionsBtn = screen.getByRole('button', { name: /^Options$/ })
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
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))
    await waitFor(() => screen.getAllByText('Transaction history').length > 0)
    await userEvent.click(screen.getAllByText('Transaction history')[0])

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('fund-investments?fund_id=fund-1')
    ))
  })

  it('closes TransactionHistorySheet and returns to goal view via Back button', async () => {
    render(<GoalDetailSheet {...baseProps} />)

    await waitFor(() => screen.getByText('VNINDEX ETF'))
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))
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
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))
    await waitFor(() =>
      expect(screen.getAllByText(/unassign from goal/i).length).toBeGreaterThan(0)
    )
  })

  it('opens the confirmation sheet when Unassign is tapped', async () => {
    render(<GoalDetailSheet {...baseProps} />)
    await waitFor(() => screen.getByText('VNINDEX ETF'))
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))
    await waitFor(() => screen.getAllByText(/unassign from goal/i).length > 0)
    // Click the action-sheet row labeled "Unassign from goal"
    await userEvent.click(screen.getAllByText(/unassign from goal/i)[0])
    // The confirm sheet uses a different title ("Unassign from goal?")
    await waitFor(() =>
      expect(screen.getByText(/unassign from goal\?/i)).toBeInTheDocument()
    )
  })

  it('moves the fund out of this goal only when confirmed (fund row)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/investment-transactions') && (!init || init.method === undefined || init.method === 'GET')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockTx] }) })
      }
      if (url.includes('/api/v1/fund-investments?fund_id=')) {
        // Bare array — matches the real route (the object shape hid the #467 no-op).
        return Promise.resolve({ ok: true, json: async () => [{ id: 'fi-1' }, { id: 'fi-2' }] })
      }
      if (url.includes('/api/v1/fund-investments/assign')) {
        return Promise.resolve({ ok: true, json: async () => ({ moved: 2 }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    global.fetch = fetchMock

    const onDataChanged = vi.fn()
    render(<GoalDetailSheet {...baseProps} onDataChanged={onDataChanged} />)
    await waitFor(() => screen.getByText('VNINDEX ETF'))
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))
    await waitFor(() => screen.getAllByText(/unassign from goal/i).length > 0)
    await userEvent.click(screen.getAllByText(/unassign from goal/i)[0])
    await waitFor(() => screen.getByText(/unassign from goal\?/i))

    // The confirm button is labeled "Unassign" (without ?), distinct from the action-row text
    const confirmBtn = screen.getByRole('button', { name: /^unassign$/i })
    await userEvent.click(confirmBtn)

    // One scoped move: this fund, out of THIS goal, back to Unallocated (#589).
    await waitFor(() => {
      const moves = (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>).filter(
        ([url]) => url.includes('/api/v1/fund-investments/assign')
      )
      expect(moves.length).toBe(1)
      expect(JSON.parse(String(moves[0][1]?.body)))
        .toEqual({ fund_id: 'fund-1', from_goal_id: 'goal-1', to_goal_id: null })
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
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))
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

describe('GoalDetailSheet — investment options Sell / history (issue #224)', () => {
  const mockBankTx = {
    transaction_id: 'tx-bank-1',
    transaction_type: 'investment',
    asset_type: 'bank',
    fund_id: null,
    fund_name: null,
    fund_code: null,
    investment_date: '2026-01-01',
    amount_vnd: 5_000_000,
    units: null,
    unit_price: null,
    interest_rate: null,
    expiry_date: null,
    notes: 'Techcombank',
    principal_withdrawn: null,
    units_withdrawn: null,
  }
  const bankGoal: GoalData = { ...mockGoal, funds: [] }

  it('opens the Sell sheet when "Sell" is tapped on a fund investment', async () => {
    render(<GoalDetailSheet {...baseProps} />)
    await waitFor(() => screen.getByText('VNINDEX ETF'))
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))
    await waitFor(() => expect(screen.getByText('Sell')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Sell'))
    await waitFor(() => expect(screen.getByTestId('sell-sheet')).toBeInTheDocument())
  })

  it('opens the Withdraw sheet when "Withdraw" is tapped on a bank investment', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockBankTx] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<GoalDetailSheet {...baseProps} goal={bankGoal} />)
    await waitFor(() => screen.getByText('Techcombank'))
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))
    await waitFor(() => expect(screen.getByText('Withdraw')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Withdraw'))
    await waitFor(() => expect(screen.getByTestId('sell-sheet')).toBeInTheDocument())
  })

  it('switches to the History tab when "Transaction history" is tapped on a non-fund investment', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockBankTx] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<GoalDetailSheet {...baseProps} goal={bankGoal} />)
    await waitFor(() => screen.getByText('Techcombank'))
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))
    await waitFor(() => expect(screen.getByText('Transaction history')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Transaction history'))

    // Non-fund history has no per-investment sheet, so it falls back to the
    // goal's History tab (the tab button becomes active).
    await waitFor(() => {
      const historyTab = screen.getByRole('button', { name: 'History' })
      expect(historyTab.style.borderBottom).toContain('var(--c-navy)')
    })
  })
})

describe('GoalDetailSheet — bank maturity in Options sheet (issue #263)', () => {
  const mockBankTx = {
    transaction_id: 'tx-bank-1',
    transaction_type: 'investment',
    asset_type: 'bank',
    fund_id: null,
    fund_name: null,
    fund_code: null,
    investment_date: '2026-01-01',
    amount_vnd: 5_000_000,
    units: null,
    unit_price: null,
    interest_rate: 6,
    expiry_date: '2030-08-15',
    notes: 'Techcombank',
    principal_withdrawn: null,
    units_withdrawn: null,
  }
  const bankGoal: GoalData = { ...mockGoal, funds: [] }

  it('shows the maturity date and time-left for a bank deposit', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockBankTx] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<GoalDetailSheet {...baseProps} goal={bankGoal} />)
    await waitFor(() => screen.getByText('Techcombank'))
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))

    await waitFor(() => expect(screen.getByText('Maturity')).toBeInTheDocument())
    expect(screen.getByText('15 Aug 2030')).toBeInTheDocument()
    expect(screen.getByText('Time left')).toBeInTheDocument()
    expect(screen.getByText(/days left/)).toBeInTheDocument()
    expect(screen.getByText('6%/yr')).toBeInTheDocument()
  })
})

describe('GoalDetailSheet — gold sell uses current price (issue #251)', () => {
  // Bought 1 chỉ at 9,000,000. Current market price is 9,200,000.
  const mockGoldTx = {
    transaction_id: 'tx-gold-1',
    transaction_type: 'investment',
    asset_type: 'gold',
    fund_id: null,
    fund_name: null,
    fund_code: null,
    investment_date: '2026-01-01',
    amount_vnd: 9_000_000,
    units: 1,
    unit_price: 9_000_000,
    interest_rate: null,
    expiry_date: null,
    notes: 'PNJ Gold',
    principal_withdrawn: null,
    units_withdrawn: null,
  }
  const goldGoal: GoalData = { ...mockGoal, funds: [] }

  it('prefills the sale price with the current gold price, not the buy price', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockGoldTx] }) })
      }
      if (url.includes('gold-price')) {
        return Promise.resolve({ ok: true, json: async () => ({ price_per_chi: 9_200_000 }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<GoalDetailSheet {...baseProps} goal={goldGoal} />)
    await waitFor(() => screen.getByText('PNJ Gold'))
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))
    await waitFor(() => expect(screen.getByText('Sell')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Sell'))

    const priceInput = await screen.findByTestId('sell-gold-price-input')
    // Must be the live market price (9.200.000), not the 9.000.000 buy price.
    await waitFor(() => expect((priceInput as HTMLInputElement).value).toBe('9.200.000'))
  })
})

describe('GoalDetailSheet — singular month wording (issue #262)', () => {
  // 1,000,000₫ left to reach the target, no deadline.
  const nearGoal: GoalData = { ...mockGoal, targetAmount: 10_000_000, currentValue: 9_000_000, targetDate: null, funds: [] }

  it('says "In 1 month" (not "1 months") when the projection is a single month', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: async () => ({ transactions: [] }) }),
    )

    render(<GoalDetailSheet {...baseProps} goal={nearGoal} />)
    await userEvent.click(screen.getByRole('button', { name: 'Calculator' }))

    // Contributing the full remaining amount finishes in exactly one month.
    await userEvent.type(screen.getByPlaceholderText('0'), '1000000')

    await waitFor(() => expect(screen.getByText('In 1 month')).toBeInTheDocument())
    expect(screen.queryByText('In 1 months')).not.toBeInTheDocument()
  })

  it('shows "1 unit" (not "1 units") for a holding of a single unit', async () => {
    const oneUnitGold = {
      transaction_id: 'tx-gold-1',
      transaction_type: 'investment',
      asset_type: 'gold',
      fund_id: null,
      fund_name: null,
      fund_code: null,
      investment_date: '2026-01-01',
      amount_vnd: 9_000_000,
      units: 1,
      unit_price: 9_000_000,
      interest_rate: null,
      expiry_date: null,
      notes: 'PNJ Gold',
      principal_withdrawn: null,
      units_withdrawn: null,
    }
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [oneUnitGold] }) })
      }
      if (url.includes('gold-price')) {
        return Promise.resolve({ ok: true, json: async () => ({ price_per_chi: 9_200_000 }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<GoalDetailSheet {...baseProps} goal={nearGoal} />)
    await waitFor(() => screen.getByText('PNJ Gold'))

    expect(screen.getByText('1 unit')).toBeInTheDocument()
    expect(screen.queryByText('1 units')).not.toBeInTheDocument()
  })
})

describe('GoalDetailSheet — progress credit note (decoupled progress vs net worth)', () => {
  // Net worth held = 90.9M (after a 31M off-progress withdrawal); the bar still
  // counts the 31M, so progressValue = 121.9M against a 120M target → 100%.
  const creditedGoal: GoalData = {
    ...mockGoal,
    funds: [],
    currentValue: 90_900_000,
    progressValue: 121_900_000,
    targetAmount: 120_000_000,
    progressPercentage: 100,
  }

  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: async () => ({ transactions: [] }) }),
    )
  })

  it('keeps net worth as the big number but runs the bar fraction off progressValue so it matches the bar', () => {
    render(<GoalDetailSheet {...baseProps} goal={creditedGoal} />)
    // Big "current value" stays net worth.
    expect(screen.getByText('₫ 90.900.000')).toBeInTheDocument()
    // Fraction next to the bar uses progressValue (matches the 100% bar), not net worth.
    expect(screen.getByText(/121\.9M ₫ \/ 120\.0M ₫ target/)).toBeInTheDocument()
    expect(screen.queryByText(/90\.9M ₫ \/ 120\.0M ₫ target/)).not.toBeInTheDocument()
  })

  it('explains the gap with a reconciling caption naming the credited amount', () => {
    render(<GoalDetailSheet {...baseProps} goal={creditedGoal} />)
    expect(screen.getByTestId('progress-credit-note')).toHaveTextContent('31.0M ₫')
  })

  it('omits the caption and keeps the fraction on net worth when progress equals net worth', () => {
    render(<GoalDetailSheet {...baseProps} goal={{ ...creditedGoal, progressValue: 90_900_000, progressPercentage: 76 }} />)
    expect(screen.queryByTestId('progress-credit-note')).not.toBeInTheDocument()
    expect(screen.getByText(/90\.9M ₫ \/ 120\.0M ₫ target/)).toBeInTheDocument()
  })

  it('explains the shortfall in the Calculator tab (net worth based) while the bar reads complete', async () => {
    render(<GoalDetailSheet {...baseProps} goal={creditedGoal} />)
    await userEvent.click(screen.getByRole('button', { name: 'Calculator' }))
    await userEvent.type(screen.getByPlaceholderText('0'), '1000000')
    await waitFor(() => expect(screen.getByTestId('progress-gather-note')).toHaveTextContent('31.0M ₫'))
  })

  it('omits the calculator gather note when progress equals net worth', async () => {
    render(<GoalDetailSheet {...baseProps} goal={{ ...creditedGoal, progressValue: 90_900_000, progressPercentage: 76 }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Calculator' }))
    await userEvent.type(screen.getByPlaceholderText('0'), '1000000')
    await waitFor(() => expect(screen.getByText('Still needed')).toBeInTheDocument())
    expect(screen.queryByTestId('progress-gather-note')).not.toBeInTheDocument()
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
        return Promise.resolve({ ok: true, json: async () => [{ id: 'fi-1' }] })
      }
      if (url.includes('/api/v1/fund-investments/assign')) {
        // Simulate that the unassign succeeded: the next GET will omit the tx
        assigned = false
        return Promise.resolve({ ok: true, json: async () => ({ moved: 1 }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    global.fetch = fetchMock

    const { rerender } = render(<GoalDetailSheet {...baseProps} refreshKey={0} />)
    await waitFor(() => screen.getByText('VNINDEX ETF'))

    // 1) Unassign the tx
    await userEvent.click(screen.getByRole('button', { name: /^Options$/ }))
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
