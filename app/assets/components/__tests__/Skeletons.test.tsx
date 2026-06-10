import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { NetWorthSkeleton, GoalSkeleton, InsuranceSkeleton } from '../Skeletons'

// The dashboard first-load skeletons must use the branded shimmer primitive
// (.sk) rather than the old static animate-pulse gray blocks (issue #235).
describe('dashboard skeletons', () => {
  it('NetWorthSkeleton renders shimmer primitives', () => {
    const { container, getByTestId } = render(<NetWorthSkeleton />)
    expect(getByTestId('net-worth-skeleton')).toBeInTheDocument()
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0)
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('GoalSkeleton renders shimmer primitives', () => {
    const { container, getByTestId } = render(<GoalSkeleton />)
    expect(getByTestId('goal-skeleton')).toBeInTheDocument()
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0)
  })

  it('InsuranceSkeleton renders shimmer primitives', () => {
    const { container, getByTestId } = render(<InsuranceSkeleton />)
    expect(getByTestId('insurance-skeleton')).toBeInTheDocument()
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0)
  })
})
