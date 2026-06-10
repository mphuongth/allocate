import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { FullPageLoader } from '../FullPageLoader'

describe('FullPageLoader', () => {
  it('renders the brand Cairn loader with a status role', () => {
    const { getByRole, container } = render(<FullPageLoader title="Loading your portfolio" />)
    expect(getByRole('status')).toBeInTheDocument()
    expect(container.querySelectorAll('.cairn-loader .stone')).toHaveLength(3)
  })

  it('shows the title caption', () => {
    const { getByText } = render(<FullPageLoader title="Loading your portfolio" />)
    expect(getByText('Loading your portfolio')).toBeInTheDocument()
  })

  it('shows the subtitle when provided', () => {
    const { getByText } = render(
      <FullPageLoader title="Loading your portfolio" subtitle="Syncing latest balances…" />,
    )
    expect(getByText('Syncing latest balances…')).toBeInTheDocument()
  })

  it('uses the title as the loader accessible label', () => {
    const { getByRole } = render(<FullPageLoader title="Loading your portfolio" />)
    expect(getByRole('status')).toHaveAttribute('aria-label', 'Loading your portfolio')
  })
})
