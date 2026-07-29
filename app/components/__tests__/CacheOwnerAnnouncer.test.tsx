import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import CacheOwnerAnnouncer from '../CacheOwnerAnnouncer'

const announceCacheOwner = vi.fn()
vi.mock('@/lib/clientCache', () => ({
  announceCacheOwner: (...args: unknown[]) => announceCacheOwner(...args),
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
    unsubscribe.mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('announces the account already signed in when the app mounts', async () => {
    render(<CacheOwnerAnnouncer />)
    authCallback!('INITIAL_SESSION', { user: { id: 'user-a' } })

    await waitFor(() => expect(announceCacheOwner).toHaveBeenCalledWith('user-a'))
  })

  it('announces the new account when a different user signs in on the same browser', async () => {
    render(<CacheOwnerAnnouncer />)
    authCallback!('INITIAL_SESSION', { user: { id: 'user-a' } })
    authCallback!('SIGNED_IN', { user: { id: 'user-b' } })

    await waitFor(() => expect(announceCacheOwner).toHaveBeenLastCalledWith('user-b'))
  })

  it('does not announce anything when there is no session', async () => {
    render(<CacheOwnerAnnouncer />)
    authCallback!('SIGNED_OUT', null)

    await waitFor(() => expect(announceCacheOwner).not.toHaveBeenCalled())
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<CacheOwnerAnnouncer />)
    unmount()

    expect(unsubscribe).toHaveBeenCalled()
  })
})
