import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DesktopGoalDetail from '../DesktopGoalDetail'
import type { GoalData } from '../../DashboardClient'

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

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

describe('DesktopGoalDetail — delete failure feedback', () => {
  beforeEach(() => {
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
  })

  it('shows an error toast and keeps the goal (no onDataChanged) when the delete fails', async () => {
    const onDataChanged = vi.fn()
    render(<DesktopGoalDetail {...baseProps} onDataChanged={onDataChanged} />)

    await userEvent.click(screen.getByRole('button', { name: 'Goal options' }))
    await userEvent.click(await screen.findByText('Delete goal'))

    // Confirm modal
    await screen.findByText('Delete goal?')
    await userEvent.click(await screen.findByRole('button', { name: 'Delete goal' }))

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
    // A failed delete must NOT signal success.
    expect(onDataChanged).not.toHaveBeenCalled()
    // The confirm modal stays open so the user can retry.
    expect(screen.getByText('Delete goal?')).toBeInTheDocument()
  })
})

describe('DesktopGoalDetail — investments load error vs empty', () => {
  const mockBankTx = {
    transaction_id: 'tx-bank-err', transaction_type: 'investment', asset_type: 'bank',
    fund_id: null, fund_name: null, investment_date: '2026-01-01', amount_vnd: 9_000_000,
    units: null, interest_rate: 6.5, notes: 'Techcombank', principal_withdrawn: null, units_withdrawn: null,
  }

  it('shows a retry state (not "No investments yet") when the transactions fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })

    render(<DesktopGoalDetail {...baseProps} />)

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

    render(<DesktopGoalDetail {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('load-error')).toBeInTheDocument())

    await userEvent.click(screen.getByTestId('load-error-retry'))

    await waitFor(() => expect(screen.getByText('Techcombank')).toBeInTheDocument())
    expect(screen.queryByTestId('load-error')).not.toBeInTheDocument()
  })
})

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
    // Count-toward-progress defaults ON.
    expect(postBody!.affects_progress).toBe(true)
  })

  it('posts affects_progress=false when the progress toggle is switched off', async () => {
    render(<DesktopGoalDetail {...baseProps} />)
    await waitFor(() => screen.getByText('Techcombank'))

    await userEvent.click(screen.getByRole('button', { name: 'Options' }))
    await waitFor(() => expect(screen.getByText('Withdraw')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Withdraw'))

    // Switch off "Count toward goal progress", then withdraw the full balance.
    await userEvent.click(await screen.findByTestId('affects-progress-switch'))
    await userEvent.click(await screen.findByRole('button', { name: 'All' }))
    await userEvent.click(await screen.findByRole('button', { name: /Confirm withdrawal/i }))

    await waitFor(() => expect(postBody).not.toBeNull())
    expect(postBody!.affects_progress).toBe(false)
  })
})

describe('DesktopGoalDetail — History date matches Recent activity (issue #300)', () => {
  const mockTx = {
    transaction_id: 'tx-1',
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
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockTx] }) })
      }
      if (url.includes('gold-price')) {
        return Promise.resolve({ ok: true, json: async () => ({ price_per_chi: 9_200_000 }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  })

  it('renders the History row date in the same "01 Jan 2026" format as the Recent activity card', async () => {
    render(<DesktopGoalDetail {...baseProps} />)
    await waitFor(() => screen.getByText('PNJ Gold'))

    await userEvent.click(screen.getByRole('button', { name: 'History' }))

    // Must match fmtTxDate (day: 2-digit, month: short, year: numeric — en-GB),
    // not the browser-default "1/1/2026" the History tab used to print. The raw
    // `new Date('2026-01-01')` also parsed as UTC midnight, shifting the day in
    // negative-offset timezones — fmtTxDate pins it to local midnight.
    await waitFor(() => expect(screen.getByText('01 Jan 2026')).toBeInTheDocument())
    expect(screen.queryByText('1/1/2026')).not.toBeInTheDocument()
  })
})

describe('DesktopGoalDetail — held settlement reads neutrally in History', () => {
  // A parked ("Để dành gộp") settlement is a withdrawal whose cash is still held for
  // a merge. In History it must carry the neutral "For merge" pill, not render as a
  // red "−" withdrawal. Locks that the History tab calls txKind at render time.
  const heldTx = {
    transaction_id: 'tx-held-1',
    transaction_type: 'withdrawal',
    held_for_merge: true,
    consumed_by_inv_id: null,
    asset_type: 'bank',
    fund_id: null,
    fund_name: null,
    parent_transaction_id: 'src-1',
    investment_date: '2026-06-01',
    amount_vnd: 10_000_000,
    interest_rate: null,
    notes: 'Parked deposit',
    principal_withdrawn: 10_000_000,
    units_withdrawn: null,
  }

  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [heldTx] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  })

  it('shows the neutral "For merge" pill in the History tab', async () => {
    render(<DesktopGoalDetail {...baseProps} />)
    await userEvent.click(await screen.findByRole('button', { name: 'History' }))
    // The pill renders ONLY for kind held/consumed — its presence proves txKind ran
    // and the row did not fall through to the red withdrawal branch.
    expect(await screen.findByText('For merge')).toBeInTheDocument()
  })
})

describe('DesktopGoalDetail — bank maturity in Options modal (issue #263)', () => {
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
    expiry_date: '2030-08-15',
    notes: 'Techcombank',
    principal_withdrawn: null,
    units_withdrawn: null,
  }

  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [mockBankTx] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  })

  it('shows the maturity date and time-left for a bank deposit', async () => {
    render(<DesktopGoalDetail {...baseProps} />)
    await waitFor(() => screen.getByText('Techcombank'))

    await userEvent.click(screen.getByRole('button', { name: 'Options' }))

    // Bank info strip: interest rate + maturity date + time left.
    await waitFor(() => expect(screen.getByText('Maturity')).toBeInTheDocument())
    expect(screen.getByText('15 Aug 2030')).toBeInTheDocument()
    expect(screen.getByText('Time left')).toBeInTheDocument()
    expect(screen.getByText(/days left/)).toBeInTheDocument()
    expect(screen.getByText('6%/yr')).toBeInTheDocument()
  })

  it('does not show a maturity row when the deposit has no expiry', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [{ ...mockBankTx, expiry_date: null }] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<DesktopGoalDetail {...baseProps} />)
    await waitFor(() => screen.getByText('Techcombank'))
    await userEvent.click(screen.getByRole('button', { name: 'Options' }))

    await waitFor(() => expect(screen.getByText('6%/yr')).toBeInTheDocument())
    expect(screen.queryByText('Maturity')).not.toBeInTheDocument()
  })
})

describe('DesktopGoalDetail — progress credit note (decoupled progress vs net worth)', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: async () => ({ transactions: [] }) }),
    )
  })

  const creditedGoal: GoalData = {
    ...mockGoal,
    currentValue: 90_900_000,
    progressValue: 121_900_000,
    targetAmount: 120_000_000,
    progressPercentage: 100,
  }

  it('shows a reconciling caption when the bar (progressValue) exceeds net worth', () => {
    render(<DesktopGoalDetail {...baseProps} goal={creditedGoal} />)
    expect(screen.getByTestId('progress-credit-note')).toHaveTextContent('31.0M ₫')
  })

  it('omits the caption when there is no off-progress withdrawal credited', () => {
    render(<DesktopGoalDetail {...baseProps} goal={{ ...mockGoal, progressValue: mockGoal.currentValue }} />)
    expect(screen.queryByTestId('progress-credit-note')).not.toBeInTheDocument()
  })
})

describe('DesktopGoalDetail — calculator reconciles its shortfall against net worth', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: async () => ({ transactions: [] }) }),
    )
  })

  // Bar reads complete (progressValue ≥ target) but the calculator runs off net
  // worth, so "Still needed" stays > 0. A note explains the gap.
  const creditedGoal: GoalData = {
    ...mockGoal,
    currentValue: 90_900_000,
    progressValue: 121_900_000,
    targetAmount: 120_000_000,
    progressPercentage: 100,
  }

  it('explains why the calculator shows a shortfall while the bar reads complete', async () => {
    render(<DesktopGoalDetail {...baseProps} goal={creditedGoal} />)
    await userEvent.click(screen.getByRole('button', { name: 'Calculator' }))
    await userEvent.type(screen.getByPlaceholderText('0'), '1000000')
    await waitFor(() => expect(screen.getByTestId('progress-gather-note')).toHaveTextContent('31.0M ₫'))
  })

  it('omits the gather note when progress equals net worth', async () => {
    render(<DesktopGoalDetail {...baseProps} goal={{ ...creditedGoal, progressValue: 90_900_000, progressPercentage: 76 }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Calculator' }))
    await userEvent.type(screen.getByPlaceholderText('0'), '1000000')
    await waitFor(() => expect(screen.getByText('Still needed')).toBeInTheDocument())
    expect(screen.queryByTestId('progress-gather-note')).not.toBeInTheDocument()
  })
})

describe('DesktopGoalDetail — singular month wording (issue #262)', () => {
  // 1,000,000₫ left to reach the target.
  const nearGoal: GoalData = { ...mockGoal, targetAmount: 10_000_000, currentValue: 9_000_000, targetDate: null }

  // Format a YYYY-MM string `n` months from today (deterministic regardless of run date).
  function monthsFromNow(n: number): string {
    const d = new Date()
    d.setMonth(d.getMonth() + n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: async () => ({ transactions: [] }) }),
    )
  })

  it('says "In 1 month" (not "1 months") when the projection is a single month', async () => {
    render(<DesktopGoalDetail {...baseProps} goal={nearGoal} />)
    await userEvent.click(screen.getByRole('button', { name: 'Calculator' }))

    // Contributing the full remaining amount finishes in exactly one month.
    await userEvent.type(screen.getByPlaceholderText('0'), '1000000')

    await waitFor(() => expect(screen.getByText('In 1 month')).toBeInTheDocument())
    expect(screen.queryByText('In 1 months')).not.toBeInTheDocument()
  })

  it('says "1 month early" (not "1 months early") when finishing one month ahead', async () => {
    // Deadline two months out; finishing in one month is one month early.
    render(<DesktopGoalDetail {...baseProps} goal={{ ...nearGoal, targetDate: monthsFromNow(2) }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Calculator' }))
    await userEvent.type(screen.getByPlaceholderText('0'), '1000000')

    await waitFor(() => expect(screen.getByText(/1 month early/)).toBeInTheDocument())
    expect(screen.queryByText(/months early/)).not.toBeInTheDocument()
  })

  it('shows "1 unit" (not "1 units") for a holding of a single unit', async () => {
    const oneUnitGold = {
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
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('investment-transactions')) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [oneUnitGold] }) })
      }
      if (url.includes('gold-price')) {
        return Promise.resolve({ ok: true, json: async () => ({ price_per_chi: 9_200_000 }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    render(<DesktopGoalDetail {...baseProps} />)
    await waitFor(() => screen.getByText('PNJ Gold'))

    expect(screen.getByText('1 unit')).toBeInTheDocument()
    expect(screen.queryByText('1 units')).not.toBeInTheDocument()
  })

  it('shows "1 month" (not "1 months") on the edit-sheet target badge', async () => {
    const { container } = render(<DesktopGoalDetail {...baseProps} goal={nearGoal} />)

    await userEvent.click(screen.getByRole('button', { name: 'Goal options' }))
    await waitFor(() => expect(screen.getByText('Edit goal')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Edit goal'))

    // A deadline one month out makes the target badge read "1 month".
    const dateInput = await waitFor(() => {
      const el = container.querySelector('input[type="month"]')
      if (!el) throw new Error('date input not mounted yet')
      return el as HTMLInputElement
    })
    fireEvent.change(dateInput, { target: { value: monthsFromNow(1) } })

    await waitFor(() => expect(screen.getByText('1 month')).toBeInTheDocument())
    expect(screen.queryByText('1 months')).not.toBeInTheDocument()
  })
})
