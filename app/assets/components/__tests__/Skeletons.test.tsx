import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DashboardSkeleton } from '../Skeletons'

// The dashboard first-load skeleton must match the design (§02 · Skeleton
// screens → "Dashboard — first load"): net-worth card with a drawing-in
// sparkline + time-range chips, then a goals list. No insurance cards.
describe('DashboardSkeleton', () => {
  it('renders branded shimmer primitives, not the old animate-pulse blocks', () => {
    const { container, getByTestId } = render(<DashboardSkeleton />)
    expect(getByTestId('dashboard-skeleton')).toBeInTheDocument()
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0)
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('includes the drawing-in sparkline from the design', () => {
    const { container } = render(<DashboardSkeleton />)
    expect(container.querySelector('.spark-draw')).toBeInTheDocument()
  })

  it('renders the five time-range chips', () => {
    const { getByTestId } = render(<DashboardSkeleton />)
    expect(getByTestId('skeleton-range-chips').querySelectorAll('.sk')).toHaveLength(5)
  })

  it('renders two goal-card placeholders', () => {
    const { getAllByTestId } = render(<DashboardSkeleton />)
    expect(getAllByTestId('skeleton-goal-card')).toHaveLength(2)
  })
})
