import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import SessionExpiredGate from '../SessionExpiredGate'
import { markSelfSignOut, resetSessionExpiry } from '@/lib/sessionExpiry'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/assets',
  useSearchParams: () => new URLSearchParams('goal=g1'),
}))

let authCallback: ((event: string, session: unknown) => void) | null = null
const unsubscribe = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authCallback = cb
        return { data: { subscription: { unsubscribe } } }
      },
    },
  }),
}))

function fire(event: string, session: unknown) {
  act(() => authCallback!(event, session))
}

describe('SessionExpiredGate', () => {
  beforeEach(() => {
    authCallback = null
    unsubscribe.mockClear()
    resetSessionExpiry()
  })

  it('renders nothing while the session is live', () => {
    render(<SessionExpiredGate />)
    fire('TOKEN_REFRESHED', { user: { id: 'u1' } })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // The case this exists for: two tabs, one cookie jar. Tab 1 signs out, and
  // tab 2 has to say so — instead of letting the next fetch fail as a load error.
  it('blocks the screen when the session ends in another tab', () => {
    render(<SessionExpiredGate />)
    fire('SIGNED_OUT', null)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('sessionEndedTitle')).toBeTruthy()
  })

  it('stays quiet in the tab that signed itself out', () => {
    render(<SessionExpiredGate />)
    markSelfSignOut()
    fire('SIGNED_OUT', null)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // A first auth event with no session is how Supabase reports "nothing stored
  // here yet" on a cold client, before it has read the cookie.
  it('ignores the initial event', () => {
    render(<SessionExpiredGate />)
    fire('INITIAL_SESSION', null)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // A token that simply expires emits no auth event at all — the 401 on the next
  // data fetch is the only signal there is.
  it('blocks the screen when an API call answers 401', async () => {
    const originalFetch = global.fetch
    global.fetch = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch
    render(<SessionExpiredGate />)

    await act(async () => {
      await fetch('/api/v1/investment-transactions?goal_id=g1')
    })

    expect(screen.getByRole('dialog')).toBeTruthy()
    global.fetch = originalFetch
  })

  // A link, not a button: re-entering the app has to be a full page load so the
  // server re-reads the cookies and no stale in-memory data survives.
  it('offers a way back that returns to the page the user was on', () => {
    render(<SessionExpiredGate />)
    fire('SIGNED_OUT', null)

    const link = screen.getByRole('link', { name: 'signInAgain' })
    expect(link.getAttribute('href')).toBe(
      '/auth/login?expired=true&next=%2Fassets%3Fgoal%3Dg1',
    )
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<SessionExpiredGate />)
    unmount()

    expect(unsubscribe).toHaveBeenCalled()
  })
})
