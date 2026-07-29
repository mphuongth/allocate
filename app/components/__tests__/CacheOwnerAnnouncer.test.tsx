import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import CacheOwnerAnnouncer from '../CacheOwnerAnnouncer'

const announceCacheOwner = vi.fn()
const clearAppCaches = vi.fn()
vi.mock('@/lib/clientCache', () => ({
  announceCacheOwner: (...args: unknown[]) => announceCacheOwner(...args),
  clearAppCaches: (...args: unknown[]) => clearAppCaches(...args),
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

describe('CacheOwnerAnnouncer', () => {
  beforeEach(() => {
    authCallback = null
    announceCacheOwner.mockClear()
    clearAppCaches.mockClear()
    unsubscribe.mockClear()
  })

  // The server already resolved the session to render this layout, so the id is
  // known at mount — waiting for Supabase's own auth-state round trip would let
  // the page's data fetches run first against caches still owned by whoever was
  // signed in before.
  it('announces the account the server rendered for, without waiting for an auth event', async () => {
    render(<CacheOwnerAnnouncer userId="user-a" />)

    await waitFor(() => expect(announceCacheOwner).toHaveBeenCalledWith('user-a'))
  })

  it('announces the new account when a different user signs in on the same browser', async () => {
    render(<CacheOwnerAnnouncer userId="user-a" />)
    authCallback!('SIGNED_IN', { user: { id: 'user-b' } })

    await waitFor(() => expect(announceCacheOwner).toHaveBeenLastCalledWith('user-b'))
  })

  // Token-refresh failures and expiries never run a sign-out handler, so this is
  // the only place that notices the session is gone. Leaving the owner in place
  // would let the worker keep serving that account's cached data offline.
  it('clears the caches when the session disappears without a sign-out', async () => {
    render(<CacheOwnerAnnouncer userId="user-a" />)
    authCallback!('TOKEN_REFRESHED', null)

    await waitFor(() => expect(clearAppCaches).toHaveBeenCalled())
  })

  it('clears the caches on sign-out', async () => {
    render(<CacheOwnerAnnouncer userId="user-a" />)
    authCallback!('SIGNED_OUT', null)

    await waitFor(() => expect(clearAppCaches).toHaveBeenCalled())
  })

  it('does not clear the caches while the session is healthy', async () => {
    render(<CacheOwnerAnnouncer userId="user-a" />)
    authCallback!('TOKEN_REFRESHED', { user: { id: 'user-a' } })

    await waitFor(() => expect(announceCacheOwner).toHaveBeenLastCalledWith('user-a'))
    expect(clearAppCaches).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<CacheOwnerAnnouncer userId="user-a" />)
    unmount()

    expect(unsubscribe).toHaveBeenCalled()
  })
})
