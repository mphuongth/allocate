import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GoalCard from '../GoalCard'

const mockPush = vi.fn()
vi.mock('next-intl', () => ({ useTranslations: () => (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

const baseProps = {
  goalId: 'goal-1',
  goalName: 'Emergency Fund',
  targetAmount: 100_000_000,
  currentValue: 60_000_000,
  totalInvested: 55_000_000,
  profitLoss: 5_000_000,
  profitLossPercentage: 9.09,
  progressPercentage: 60,
}

describe('GoalCard', () => {
  it('renders the goal name', () => {
    render(<GoalCard {...baseProps} />)
    expect(screen.getByText('Emergency Fund')).toBeInTheDocument()
  })

  it('renders the current value formatted', () => {
    render(<GoalCard {...baseProps} />)
    // currentValue uses fmt() → full precision e.g. ₫ 60.000.000
    expect(screen.getByText('₫ 60.000.000')).toBeInTheDocument()
  })

  it('shows gain/loss in positive color when positive', () => {
    render(<GoalCard {...baseProps} />)
    // P/L rendered as fmtCompact: "+5.0M ₫ · 9.09%" in one <span>
    const gainEl = screen.getByText(/\+5\.0M/)
    expect(gainEl).toHaveStyle({ color: 'var(--c-pos)' })
  })

  it('shows gain/loss in negative color when negative', () => {
    render(<GoalCard {...baseProps} profitLoss={-2_000_000} profitLossPercentage={-3.6} />)
    const lossEl = screen.getByText(/-2\.0M/)
    expect(lossEl).toHaveStyle({ color: 'var(--c-neg)' })
  })

  it('shows 100% progress badge when progressPercentage >= 100', () => {
    render(<GoalCard {...baseProps} progressPercentage={100} currentValue={100_000_000} />)
    // Progress chip shows "100%" with green styling when complete
    const badge = screen.getByText('100%')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveStyle({ color: 'var(--c-pos)' })
  })

  it('hides progress bar and target when targetAmount is null', () => {
    render(<GoalCard {...baseProps} targetAmount={null} />)
    expect(screen.queryByText(/goalTarget/)).not.toBeInTheDocument()
    expect(screen.queryByText(/goalProgress/)).not.toBeInTheDocument()
  })

  it('navigates to goal settings on click', async () => {
    render(<GoalCard {...baseProps} />)
    await userEvent.click(screen.getByText('Emergency Fund'))
    expect(mockPush).toHaveBeenCalledWith('/settings?tab=goals&goal=goal-1')
  })
})
