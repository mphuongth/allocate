import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import LoadError from '../LoadError'
import { reportSessionExpired, resetSessionExpiry } from '@/lib/sessionExpiry'

describe('LoadError', () => {
  beforeEach(() => resetSessionExpiry())

  it('offers a retry for a load that failed', () => {
    render(<LoadError isVI={false} onRetry={vi.fn()} />)

    expect(screen.getByTestId('load-error')).toBeTruthy()
    expect(screen.getByTestId('load-error-retry')).toBeTruthy()
  })

  // A 401 is not a load that failed: retrying it can only 401 again, and the
  // session-ended dialog is already saying what actually happened (#719).
  it('says nothing once the session has ended', () => {
    const { rerender } = render(<LoadError isVI={false} onRetry={vi.fn()} />)

    act(() => reportSessionExpired())
    rerender(<LoadError isVI={false} onRetry={vi.fn()} />)

    expect(screen.queryByTestId('load-error')).toBeNull()
  })
})
