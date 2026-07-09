import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PlanningLoading from '../loading'

// Route-level Suspense fallback for /planning — mirrors PlanningClient's own
// first-load state (mobile stack + desktop tables) so tapping the tab paints a
// skeleton instantly and hands off to the client component with no flash.
describe('PlanningLoading', () => {
  it('renders both breakpoint planning skeletons, not a spinner', () => {
    const { container, getByTestId } = render(<PlanningLoading />)
    expect(getByTestId('mobile-planning-skeleton')).toBeInTheDocument()
    expect(getByTestId('planning-skeleton')).toBeInTheDocument()
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0)
    expect(container.querySelector('.cairn-loader')).toBeNull()
  })
})
