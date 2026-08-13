import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DesktopGoalCard from '../DesktopGoalCard'
import type { GoalData } from '@/features/dashboard/contracts'

const mockGoal: GoalData = {
  goalId: 'goal-1',
  goalName: 'Emergency Fund',
  targetAmount: 120_000_000,
  targetDate: null,
  currentValue: 60_000_000,
  progressValue: 60_000_000,
  totalInvested: 55_000_000,
  profitLoss: 5_000_000,
  profitLossPercentage: 9.09,
  progressPercentage: 50,
  transactionCount: 3,
  funds: [],
}

const baseProps = { goal: mockGoal, locale: 'en', onClick: vi.fn() }

describe('DesktopGoalCard — progress credit note', () => {
  it('shows a reconciling caption when progressValue exceeds the net-worth currentValue', () => {
    const goal = { ...mockGoal, currentValue: 90_900_000, progressValue: 121_900_000, progressPercentage: 100 }
    render(<DesktopGoalCard {...baseProps} goal={goal} />)
    expect(screen.getByTestId('progress-credit-note')).toHaveTextContent('31.0M ₫')
  })

  it('omits the caption when progressValue equals currentValue', () => {
    render(<DesktopGoalCard {...baseProps} />)
    expect(screen.queryByTestId('progress-credit-note')).not.toBeInTheDocument()
  })
})

describe('DesktopGoalCard — a finished goal (#650)', () => {
  // Its holdings were liquidated to pay for the thing it was for, so the live
  // balance is zero. Reading that would report the achievement as nothing.
  const finished: GoalData = {
    ...mockGoal,
    currentValue: 0,
    progressValue: 0,
    progressPercentage: 0,
    completedAt: '2026-08-13T02:00:00Z',
    completionValue: 121_900_000,
    completionPercentage: 100,
  }

  it('reads Completed · 100% off the snapshot, not off the empty balance', () => {
    render(<DesktopGoalCard {...baseProps} goal={finished} />)
    expect(screen.getByTestId('goal-completed-badge')).toHaveTextContent('Completed · 100%')
  })

  it('shows what the goal finished at, not its zero balance', () => {
    render(<DesktopGoalCard {...baseProps} goal={finished} />)
    expect(screen.getByText('₫ 121.900.000')).toBeInTheDocument()
  })

  it('leaves an active goal chip alone', () => {
    render(<DesktopGoalCard {...baseProps} />)
    expect(screen.queryByTestId('goal-completed-badge')).not.toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })
})
