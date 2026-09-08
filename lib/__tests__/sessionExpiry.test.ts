import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  cancelSelfSignOut,
  markSelfSignOut,
  reportSessionExpired,
  resetSessionExpiry,
  useSessionExpired,
  watchApiUnauthorized,
} from '../sessionExpiry'

describe('sessionExpiry — the expiry signal', () => {
  beforeEach(() => resetSessionExpiry())

  it('starts false and flips once the session is reported gone', () => {
    const { result } = renderHook(() => useSessionExpired())
    expect(result.current).toBe(false)

    act(() => reportSessionExpired())
    expect(result.current).toBe(true)
  })

  // The tab that pressed "sign out" is not a tab whose session died under it:
  // it already navigates to the login page on its own, and a modal telling it
  // the session ended would be a second, contradictory answer to its own action.
  it('stays quiet in the tab that signed itself out', () => {
    const { result } = renderHook(() => useSessionExpired())

    act(() => {
      markSelfSignOut()
      reportSessionExpired()
    })

    expect(result.current).toBe(false)
  })

  // A sign-out that failed leaves the session live, so the next expiry in this
  // tab is real news again.
  it('speaks up again once a failed sign-out is cancelled', () => {
    const { result } = renderHook(() => useSessionExpired())

    act(() => {
      markSelfSignOut()
      cancelSelfSignOut()
      reportSessionExpired()
    })

    expect(result.current).toBe(true)
  })
})

describe('sessionExpiry — watching API responses', () => {
  let restore: () => void
  const originalFetch = global.fetch

  beforeEach(() => {
    resetSessionExpiry()
    restore = () => {}
  })
  afterEach(() => {
    restore()
    global.fetch = originalFetch
  })

  function stubFetch(status: number) {
    const spy = vi.fn(async () => new Response(null, { status }))
    global.fetch = spy as unknown as typeof fetch
    return spy
  }

  it('reports expiry when any API call answers 401', async () => {
    stubFetch(401)
    restore = watchApiUnauthorized()
    const { result } = renderHook(() => useSessionExpired())

    await act(async () => {
      await fetch('/api/v1/investment-transactions?goal_id=g1')
    })

    expect(result.current).toBe(true)
  })

  it('passes the response through untouched', async () => {
    stubFetch(401)
    restore = watchApiUnauthorized()

    const res = await fetch('/api/v1/savings-goals')

    expect(res.status).toBe(401)
  })

  it('ignores a 401 that is not the app API', async () => {
    stubFetch(401)
    restore = watchApiUnauthorized()
    const { result } = renderHook(() => useSessionExpired())

    await act(async () => {
      // Supabase auth itself answers 401 on a bad password — that is a failed
      // sign-in, not a session that ended.
      await fetch('https://project.supabase.co/auth/v1/token')
    })

    expect(result.current).toBe(false)
  })

  it('leaves a successful API call alone', async () => {
    stubFetch(200)
    restore = watchApiUnauthorized()
    const { result } = renderHook(() => useSessionExpired())

    await act(async () => {
      await fetch('/api/v1/savings-goals')
    })

    expect(result.current).toBe(false)
  })

  it('restores the original fetch when the watch is torn down', () => {
    const spy = stubFetch(200)
    watchApiUnauthorized()()

    expect(global.fetch).toBe(spy)
  })
})
