import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DesktopPlanningSkeleton, MobilePlanningSkeleton } from '../PlanningSkeleton'

// §04 of the loading design: "Screen first paint → Skeleton of that screen —
// never a spinner over an empty card", and "each breakpoint needs its OWN
// skeleton". Planning therefore has a desktop variant (summary strip + table
// sections) and a mobile variant (salary card + 3-col summary + stacked
// sections), both from the .sk shimmer primitive — no spinner.
describe('DesktopPlanningSkeleton', () => {
  it('renders shimmer primitives, not a spinner', () => {
    const { container, getByTestId } = render(<DesktopPlanningSkeleton />)
    expect(getByTestId('planning-skeleton')).toBeInTheDocument()
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0)
    expect(container.querySelector('.cairn-loader')).toBeNull()
  })

  it('mirrors the four-cell summary strip', () => {
    const { getByTestId } = render(<DesktopPlanningSkeleton />)
    expect(getByTestId('planning-skeleton-summary').children).toHaveLength(4)
  })

  it('renders allocation-section placeholders', () => {
    const { getAllByTestId } = render(<DesktopPlanningSkeleton />)
    expect(getAllByTestId('planning-skeleton-section').length).toBeGreaterThanOrEqual(2)
  })
})

describe('MobilePlanningSkeleton', () => {
  it('renders shimmer primitives, not a spinner', () => {
    const { container, getByTestId } = render(<MobilePlanningSkeleton />)
    expect(getByTestId('mobile-planning-skeleton')).toBeInTheDocument()
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0)
    expect(container.querySelector('.cairn-loader')).toBeNull()
  })

  it('mirrors the three-cell summary strip', () => {
    const { getByTestId } = render(<MobilePlanningSkeleton />)
    expect(getByTestId('mobile-planning-skeleton-summary').children).toHaveLength(3)
  })

  it('renders stacked section placeholders', () => {
    const { getAllByTestId } = render(<MobilePlanningSkeleton />)
    expect(getAllByTestId('mobile-planning-skeleton-section').length).toBeGreaterThanOrEqual(2)
  })
})
