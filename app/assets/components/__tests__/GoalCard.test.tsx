import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GoalCard from '../GoalCard'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }))

const baseProps = {
  goalId: 'goal-1',
  goalName: 'Emergency Fund',
  targetAmount: 100_000_000,
  currentValue: 60_000_000,
  totalInvested: 55_000_000,
  profitLoss: 5_000_000,
  profitLossPercentage: 9.09,
  progressPercentage: 60,
  transactionCount: 3,
  onClick: vi.fn(),
}

describe('GoalCard', () => {
  it('renders the goal name', () => {
    render(<GoalCard {...baseProps} />)
    expect(screen.getByText('Emergency Fund')).toBeInTheDocument()
  })

  it('renders the current value formatted', () => {
    render(<GoalCard {...baseProps} />)
    expect(screen.getByText('₫ 60.000.000')).toBeInTheDocument()
  })

  it('shows progress percentage chip', () => {
    render(<GoalCard {...baseProps} />)
    expect(screen.getByText('60%')).toBeInTheDocument()
  })

  it('shows positive P&L in pos color', () => {
    render(<GoalCard {...baseProps} />)
    const plSpan = screen.getByText(/\+.*9\.09%/)
    expect(plSpan).toHaveStyle({ color: 'var(--c-pos)' })
  })

  it('shows negative P&L in neg color', () => {
    render(<GoalCard {...baseProps} profitLoss={-2_000_000} profitLossPercentage={-3.6} />)
    // The P&L span contains the fmtCompact + fmtPct combination; just check color
    const button = screen.getByRole('button')
    // Find the span with neg color style
    const negSpan = button.querySelector('span[style*="var(--c-neg)"]')
    expect(negSpan).not.toBeNull()
  })

  it('hides progress bar and target when targetAmount is null', () => {
    render(<GoalCard {...baseProps} targetAmount={null} />)
    expect(screen.queryByText(/goalTarget/)).not.toBeInTheDocument()
  })

  it('calls onClick prop when card is clicked', async () => {
    const onClick = vi.fn()
    render(<GoalCard {...baseProps} onClick={onClick} />)
    await userEvent.click(screen.getByText('Emergency Fund'))
    expect(onClick).toHaveBeenCalled()
  })

  it('passes transactionCount to the transactions label so ICU pluralization can resolve', () => {
    // Mocked next-intl returns `${key}:${JSON.stringify(params)}` when params are passed.
    // Asserting on this confirms the call site sends the count to next-intl,
    // which is what enables "1 transaction" vs "5 transactions" in real en.json.
    render(<GoalCard {...baseProps} transactionCount={1} />)
    expect(screen.getByText('transactions:{"count":1}')).toBeInTheDocument()
  })

  it('passes plural transactionCount to the transactions label', () => {
    render(<GoalCard {...baseProps} transactionCount={5} />)
    expect(screen.getByText('transactions:{"count":5}')).toBeInTheDocument()
  })
})
