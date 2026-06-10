import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AppBootSplash } from '../AppBootSplash'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) =>
    ({ loadingPortfolio: 'Loading your portfolio', syncingBalances: 'Syncing latest balances…' })[key] ?? key,
}))

describe('AppBootSplash', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows a full-screen brand loader on first mount', () => {
    const { container } = render(<AppBootSplash />)
    expect(container.querySelector('.app-boot-splash')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Loading your portfolio')).toBeInTheDocument()
    expect(screen.getByText('Syncing latest balances…')).toBeInTheDocument()
  })

  it('is not yet fading on the initial frame', () => {
    const { container } = render(<AppBootSplash />)
    expect(container.querySelector('.app-boot-splash')).not.toHaveClass('hiding')
  })

  it('begins fading after hydration', () => {
    const { container } = render(<AppBootSplash />)
    act(() => { vi.advanceTimersByTime(1) })
    expect(container.querySelector('.app-boot-splash')).toHaveClass('hiding')
  })

  it('unmounts once the fade has played', () => {
    const { container } = render(<AppBootSplash />)
    act(() => { vi.advanceTimersByTime(1) }) // start fade
    act(() => { vi.advanceTimersByTime(400) }) // fade completes
    expect(container.querySelector('.app-boot-splash')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
