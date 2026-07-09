import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import FundsLoading from '../loading'

// Route-level Suspense fallback for /funds — a fund-list shimmer for each
// breakpoint so tapping the tab paints instantly, bridging to the view's own
// funds-loading-skeleton once useFundsData resolves.
describe('FundsLoading', () => {
  it('renders mobile + desktop fund-list skeletons from the shimmer primitive', () => {
    const { container, getByTestId } = render(<FundsLoading />)
    expect(getByTestId('funds-loading-skeleton-mobile')).toBeInTheDocument()
    expect(getByTestId('funds-loading-skeleton-desktop')).toBeInTheDocument()
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0)
    expect(container.querySelector('.cairn-loader')).toBeNull()
  })
})
