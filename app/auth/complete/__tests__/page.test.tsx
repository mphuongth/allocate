import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import CompletePage from '../page'

const clearAppCaches = vi.fn(async () => {})
vi.mock('@/lib/clientCache', () => ({
  clearAppCaches: () => clearAppCaches(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// The email-confirmation callback is a *server* redirect, so no client code has
// run to tell the service worker the account changed. Landing on /dashboard
// directly could therefore be answered from a previous account's cached page —
// which carries that account's own ownership claim and re-asserts it. This page
// exists to hand ownership over before any authenticated page is requested
// (#565).
describe('CompletePage — ownership handoff after the auth callback', () => {
  let replaceMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clearAppCaches.mockClear()
    replaceMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, replace: replaceMock, href: 'http://localhost/auth/complete' },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('drops the previous account caches before entering the app', async () => {
    const order: string[] = []
    clearAppCaches.mockImplementation(async () => { order.push('clear') })
    replaceMock.mockImplementation(() => { order.push('navigate') })

    render(<CompletePage />)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'))
    expect(order).toEqual(['clear', 'navigate'])
  })

  it('still enters the app when the caches cannot be cleared', async () => {
    clearAppCaches.mockRejectedValueOnce(new Error('storage unavailable'))

    render(<CompletePage />)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'))
  })

  it('tells the user something is happening rather than showing a blank page', () => {
    render(<CompletePage />)

    expect(screen.getByText(/completingSignIn/i)).toBeInTheDocument()
  })
})
