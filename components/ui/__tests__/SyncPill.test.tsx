import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SyncPill } from '../SyncPill'

describe('SyncPill', () => {
  it('renders the floating pill with an XS Cairn and label when shown', () => {
    const { container, getByText, getByRole } = render(<SyncPill label="Syncing fund prices…" show />)
    expect(container.querySelector('.sync-bar')).toBeInTheDocument()
    expect(getByRole('status')).toBeInTheDocument()
    expect(container.querySelector('.cairn-loader')).toBeInTheDocument()
    expect(getByText('Syncing fund prices…')).toBeInTheDocument()
  })

  it('renders nothing when not shown', () => {
    const { container } = render(<SyncPill label="Syncing fund prices…" show={false} />)
    expect(container.querySelector('.sync-bar')).toBeNull()
  })
})
