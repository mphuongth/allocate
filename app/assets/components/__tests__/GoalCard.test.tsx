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
    expect(screen.getByText('₫ 60.000.000')).toBeInTheDocument()
  })

  it('shows gain/loss in green when positive', () => {
    render(<GoalCard {...baseProps} />)
    const gainEl = screen.getByText('₫ 5.000.000')
    expect(gainEl).toHaveClass('text-green-600')
  })

  it('shows gain/loss in red when negative', () => {
    render(<GoalCard {...baseProps} profitLoss={-2_000_000} profitLossPercentage={-3.6} />)
    const lossEl = screen.getByText('₫ -2.000.000')
    expect(lossEl).toHaveClass('text-red-600')
  })

  it('shows exceeded-target text when progressPercentage >= 100', () => {
    render(<GoalCard {...baseProps} progressPercentage={100} currentValue={100_000_000} />)
    expect(screen.getByText('exceededTarget')).toBeInTheDocument()
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
