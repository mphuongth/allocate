import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The session the mocked Supabase server client will report for the next call.
let currentUser: { id: string } | null = null

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
  }),
}))

const { proxy } = await import('../proxy')

const get = (url: string) => proxy(new NextRequest(new URL(url, 'http://localhost')))

describe('proxy — a signed-in visitor to the auth entry pages', () => {
  beforeEach(() => { currentUser = { id: 'user-1' } })

  // Refreshing /auth/login while already signed in used to re-render the login
  // form forever: the auth paths short-circuited before any session look-up, so
  // the server had no opinion about a visitor who was already in.
  it('is sent into the app instead of being shown the login form again', async () => {
    const res = await get('/auth/login')

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/dashboard')
  })

  it('is sent into the app from the sign-up page too', async () => {
    const res = await get('/auth/signup')

    expect(res.headers.get('location')).toBe('http://localhost/dashboard')
  })

  // The session-ended dialog links to /auth/login?next=<where they were>. If the
  // user signed back in elsewhere first, that link should still land them there.
  it('honours ?next when it names a path inside the app', async () => {
    const res = await get('/auth/login?next=%2Fassets%3Fgoal%3Dg1')

    expect(res.headers.get('location')).toBe('http://localhost/assets?goal=g1')
  })

  it('ignores a ?next pointing off this site', async () => {
    const res = await get('/auth/login?next=https%3A%2F%2Fevil.example%2Fphish')

    expect(res.headers.get('location')).toBe('http://localhost/dashboard')
  })

  // The callback route exchanges the OAuth code for the session; bouncing a
  // signed-in visitor off it would break re-authentication. The error page has
  // to stay reachable for the same reason.
  it('leaves the rest of the auth flow alone', async () => {
    for (const path of ['/auth/callback?code=abc', '/auth/complete', '/auth/auth-code-error']) {
      expect((await get(path)).headers.get('location'), path).toBeNull()
    }
  })

  it('leaves the landing page alone', async () => {
    expect((await get('/')).headers.get('location')).toBeNull()
  })
})

describe('proxy — a signed-out visitor', () => {
  beforeEach(() => { currentUser = null })

  it('can still reach the login and sign-up pages', async () => {
    expect((await get('/auth/login')).headers.get('location')).toBeNull()
    expect((await get('/auth/signup')).headers.get('location')).toBeNull()
  })

  it('is still redirected away from the app', async () => {
    const res = await get('/dashboard')

    expect(res.headers.get('location')).toBe('http://localhost/auth/login')
  })
})
