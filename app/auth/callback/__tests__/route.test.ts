import { describe, it, expect, vi, beforeEach } from 'vitest'

// Production CSP is nonce-based (`script-src 'self' 'nonce-…' 'strict-dynamic'`,
// no 'unsafe-inline'), so an un-nonced inline <script> returned as raw HTML is
// blocked — the old callback error page's 2-second JS redirect never fired and
// the user got stuck (#516). A failed code exchange must instead navigate via a
// plain server-side redirect (no script at all).
const h = vi.hoisted(() => ({ exchangeError: null as unknown }))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { exchangeCodeForSession: async () => ({ error: h.exchangeError }) },
  }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}))

import { GET } from '../route'
import type { NextRequest } from 'next/server'

const req = (url: string) => ({ url } as unknown as NextRequest)

beforeEach(() => {
  h.exchangeError = null
})

describe('GET /auth/callback — CSP-safe failure navigation (#516)', () => {
  it('redirects to /dashboard on a successful code exchange', async () => {
    const res = await GET(req('http://localhost/auth/callback?code=good'))
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get('location')).toContain('/dashboard')
  })

  it('redirects to the dedicated error page (no inline script) when the exchange fails', async () => {
    h.exchangeError = { message: 'invalid grant' }
    const res = await GET(req('http://localhost/auth/callback?code=bad'))
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get('location')).toContain('/auth/auth-code-error')
    // A redirect has no body — but assert no executable script is ever returned.
    expect(await res.text()).not.toContain('<script')
  })

  it('redirects to the error page when no code is present at all', async () => {
    const res = await GET(req('http://localhost/auth/callback'))
    expect(res.headers.get('location')).toContain('/auth/auth-code-error')
    expect(await res.text()).not.toContain('<script')
  })
})
