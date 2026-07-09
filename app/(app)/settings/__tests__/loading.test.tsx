import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import SettingsLoading from '../loading'

// Route-level Suspense fallback for /settings. Settings renders synchronously
// from server props (no client fetch), so the only navigation delay is the
// server getUser() round-trip — this skeleton fills exactly that gap with a
// profile card + preference rows for each breakpoint.
describe('SettingsLoading', () => {
  it('renders mobile + desktop settings skeletons, not a spinner', () => {
    const { container, getByTestId } = render(<SettingsLoading />)
    expect(getByTestId('settings-loading-skeleton-mobile')).toBeInTheDocument()
    expect(getByTestId('settings-loading-skeleton-desktop')).toBeInTheDocument()
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0)
    expect(container.querySelector('.cairn-loader')).toBeNull()
  })
})
