import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import DashboardLoading from '../loading'

// Route-level Suspense fallback for /dashboard. The App Router paints this the
// instant the tab is tapped — before the server component resolves getUser() —
// so navigation feels immediate instead of dead for the auth round-trip. It
// shows the same mobile + desktop Overview skeletons DashboardClient uses for
// its own first-load, so there's no flash when the client component takes over.
describe('DashboardLoading', () => {
  it('renders both breakpoint Overview skeletons, not a spinner', () => {
    const { container, getByTestId } = render(<DashboardLoading />)
    expect(getByTestId('dashboard-skeleton')).toBeInTheDocument()
    expect(getByTestId('dashboard-skeleton-desktop')).toBeInTheDocument()
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0)
    expect(container.querySelector('.cairn-loader')).toBeNull()
  })
})
