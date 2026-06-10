import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlanningSkeleton } from '../PlanningSkeleton'

// §04 of the loading design: "Screen first paint → Skeleton of that screen —
// never a spinner over an empty card." Planning's first paint must therefore be
// a skeleton mirroring the plan layout (summary strip + allocation sections),
// not a CairnLoader spinner.
describe('PlanningSkeleton', () => {
  it('renders shimmer primitives, not a spinner', () => {
    const { container, getByTestId } = render(<PlanningSkeleton />)
    expect(getByTestId('planning-skeleton')).toBeInTheDocument()
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0)
    expect(container.querySelector('.cairn-loader')).toBeNull()
  })

  it('mirrors the four-cell summary strip', () => {
    const { getByTestId } = render(<PlanningSkeleton />)
    expect(getByTestId('planning-skeleton-summary').children).toHaveLength(4)
  })

  it('renders allocation-section placeholders', () => {
    const { getAllByTestId } = render(<PlanningSkeleton />)
    expect(getAllByTestId('planning-skeleton-section').length).toBeGreaterThanOrEqual(2)
  })
})
