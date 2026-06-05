import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginPage from '../page'

const { signInMock, pushMock, refreshMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({
    auth: { signInWithPassword: signInMock },
  }),
}))

async function submitLogin() {
  await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com')
  await userEvent.type(screen.getByLabelText(/password/i), 'secret123')
  await userEvent.click(screen.getByRole('button', { name: /loginBtn/i }))
}

describe('LoginPage — navigation after successful sign-in', () => {
  let assignMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    signInMock.mockReset()
    pushMock.mockReset()
    refreshMock.mockReset()
    // jsdom does not implement navigation; replace location with a spy so we can
    // observe a full-page navigation without it throwing.
    assignMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignMock, href: 'http://localhost/auth/login' },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('navigates to /dashboard via a full-page load (not a soft router.push) on success', async () => {
    // Sign-in succeeds — this is the exact state where the button flips to
    // "redirecting". A soft router.push() here can race with auth-cookie
    // propagation and bounce back to /login when a stale session cookie was
    // present, leaving the user stuck. A full-page navigation forces the server
    // to re-read the fresh cookies, so the user actually lands on the dashboard.
    signInMock.mockResolvedValue({ error: null })

    render(<LoginPage />)
    await submitLogin()

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith('/dashboard')
    })
    // A soft client-side push must NOT be the mechanism that moves the user off
    // the login route — that is the bug being fixed.
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('stays on the login page and shows an error when credentials are invalid', async () => {
    signInMock.mockResolvedValue({ error: { message: 'Invalid login credentials' } })

    render(<LoginPage />)
    await submitLogin()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(assignMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })
})
