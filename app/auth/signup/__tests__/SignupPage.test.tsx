import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SignupPage from '../page'

const { signUpMock, pushMock, refreshMock, announceCacheOwnerMock } = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  announceCacheOwnerMock: vi.fn(async () => {}),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}))

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({ auth: { signUp: signUpMock } }),
}))

vi.mock('@/lib/clientCache', () => ({
  announceCacheOwner: (...args: unknown[]) => announceCacheOwnerMock(...(args as [])),
}))

async function submitSignup() {
  await userEvent.type(screen.getByLabelText(/fullNameLabel/i), 'Minh')
  await userEvent.type(screen.getByLabelText(/emailLabel/i), 'user@example.com')
  await userEvent.type(screen.getByLabelText(/^passwordLabel/i), 'secret123')
  await userEvent.click(screen.getByRole('button', { name: /signupBtn/i }))
}

// A machine where a previous account's session expired while the app was closed
// still has that account recorded as the service worker's cache owner. A brand
// new account must take ownership before it reaches the dashboard, or the
// worker can answer its first failed request from the old account's cache
// (#565).
describe('SignupPage — cache ownership', () => {
  beforeEach(() => {
    signUpMock.mockReset()
    pushMock.mockReset()
    refreshMock.mockReset()
    announceCacheOwnerMock.mockReset()
    announceCacheOwnerMock.mockResolvedValue(undefined)
  })

  it('hands the service worker the new account before routing to the dashboard', async () => {
    signUpMock.mockResolvedValue({ data: { session: {}, user: { id: 'user-new' } }, error: null })
    const order: string[] = []
    announceCacheOwnerMock.mockImplementation(async () => { order.push('announce') })
    pushMock.mockImplementation(() => { order.push('navigate') })

    render(<SignupPage />)
    await submitSignup()

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'))
    expect(announceCacheOwnerMock).toHaveBeenCalledWith('user-new')
    expect(order).toEqual(['announce', 'navigate'])
  })

  it('does not claim ownership when signup only sends a confirmation email', async () => {
    signUpMock.mockResolvedValue({ data: { session: null, user: { id: 'user-new' } }, error: null })

    render(<SignupPage />)
    await submitSignup()

    await waitFor(() => expect(signUpMock).toHaveBeenCalled())
    expect(announceCacheOwnerMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })
})
