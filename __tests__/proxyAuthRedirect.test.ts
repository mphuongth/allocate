import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// The session the mocked Supabase server client will report for the next call.
let currentUser: { id: string } | null = null

// The proxy decides from the signed token alone (lib/sessionUser). getUser is
// kept on the mock only so a test can prove it is never reached for.
//
// `sessionRevoked` models a session ended elsewhere (signed out on another
// device, password changed): the token in the cookie still carries a good
// signature until it expires, but Supabase Auth no longer honours it.
let sessionRevoked = false
const getUserSpy = vi.fn(async () => ({ data: { user: sessionRevoked ? null : currentUser } }))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: getUserSpy,
      getClaims: async () =>
        currentUser ? { data: { claims: { sub: currentUser.id } }, error: null } : { data: null, error: null },
    },
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

describe('proxy — the session check stays off the network', () => {
  // The proxy runs ahead of every page. Asking Supabase Auth who the visitor is
  // made each navigation wait on a service that, on the free instance, takes
  // seconds to answer after sitting idle.
  beforeEach(() => { getUserSpy.mockClear() })

  it('lets a signed-in visitor through to a page without asking the Auth server', async () => {
    currentUser = { id: 'user-1' }
    const res = await get('/dashboard')

    expect(res.headers.get('location')).toBeNull()
    expect(getUserSpy).not.toHaveBeenCalled()
  })

  it('sends a signed-out visitor to the login page without asking either', async () => {
    currentUser = null
    const res = await get('/dashboard')

    expect(res.headers.get('location')).toBe('http://localhost/auth/login')
    expect(getUserSpy).not.toHaveBeenCalled()
  })
})

describe('proxy — a session ended elsewhere, with a token that still verifies', () => {
  // The session-ended dialog sends the visitor to /auth/login. If the proxy
  // judged that page by the token's signature too, it would see "signed in" and
  // bounce them straight back into the app, whose next API call 401s again —
  // round and round until the token expired, up to an hour later. The two doors
  // into the app therefore still ask the Auth server; they are the one place a
  // stale-but-valid token must not be believed.
  beforeEach(() => { currentUser = { id: 'user-1' }; sessionRevoked = true })
  afterEach(() => { sessionRevoked = false })

  it('is shown the login form rather than being bounced back into the app', async () => {
    const res = await get('/auth/login?expired=true&next=%2Fdashboard')

    expect(res.headers.get('location')).toBeNull()
  })

  it('is shown the sign-up form too', async () => {
    expect((await get('/auth/signup')).headers.get('location')).toBeNull()
  })
})
