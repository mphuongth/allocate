import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import OfflineBanner from '../OfflineBanner'

// The banner reads navigator.onLine — browser state the component doesn't own.
// It used to seed that with `setIsOnline(navigator.onLine)` inside an effect,
// which is the set-state-in-effect shape (#537) and also means the first paint
// always claims "online" regardless of the truth.
//
// useSyncExternalStore is what this is for: React reads the live value during
// render and re-reads it whenever the online/offline events fire.

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

const fire = (type: 'online' | 'offline') =>
  act(() => { window.dispatchEvent(new Event(type)) })

describe('OfflineBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setOnline(true)
  })
  afterEach(() => {
    vi.useRealTimers()
    setOnline(true)
  })

  it('renders nothing while online', () => {
    const { container } = render(<OfflineBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  // The old effect-seeded version rendered "online" for a frame even here.
  it('shows the offline state on first paint when the browser is already offline', () => {
    setOnline(false)
    render(<OfflineBanner />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('appears when the connection drops', () => {
    render(<OfflineBanner />)
    setOnline(false)
    fire('offline')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows the reconnected notice only after having been offline', () => {
    render(<OfflineBanner />)
    setOnline(false)
    fire('offline')
    setOnline(true)
    fire('online')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('does not announce a reconnection that never followed a drop', () => {
    const { container } = render(<OfflineBanner />)
    setOnline(true)
    fire('online')
    expect(container).toBeEmptyDOMElement()
  })

  it('clears the reconnected notice after its timeout', () => {
    render(<OfflineBanner />)
    setOnline(false)
    fire('offline')
    setOnline(true)
    fire('online')
    expect(screen.getByRole('status')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
