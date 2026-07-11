import { describe, it, expect } from 'vitest'
import { buildContentSecurityPolicy } from '../csp'

describe('buildContentSecurityPolicy', () => {
  const nonce = 'abc123=='
  const csp = buildContentSecurityPolicy(nonce)
  const directives = Object.fromEntries(
    csp.split(';').map((d) => {
      const [k, ...v] = d.trim().split(/\s+/)
      return [k, v.join(' ')]
    }),
  )

  it('uses a nonce + strict-dynamic for scripts', () => {
    expect(directives['script-src']).toContain(`'nonce-${nonce}'`)
    expect(directives['script-src']).toContain("'strict-dynamic'")
  })

  it("drops 'unsafe-inline' and 'unsafe-eval' from script-src (the XSS vectors)", () => {
    expect(directives['script-src']).not.toContain("'unsafe-inline'")
    expect(directives['script-src']).not.toContain("'unsafe-eval'")
  })

  it('locks down base-uri, form-action, object-src and framing', () => {
    expect(directives['object-src']).toBe("'none'")
    expect(directives['base-uri']).toBe("'self'")
    expect(directives['form-action']).toBe("'self'")
    expect(directives['frame-ancestors']).toBe("'none'")
  })

  it('still allows Supabase (REST + realtime websocket) in connect-src', () => {
    expect(directives['connect-src']).toContain('https://*.supabase.co')
    expect(directives['connect-src']).toContain('wss://*.supabase.co')
  })

  it('appends an extra connect-src origin when given (local Supabase for E2E)', () => {
    const withLocal = buildContentSecurityPolicy(nonce, {
      connectExtra: ' http://127.0.0.1:54321 ws://127.0.0.1:54321',
    })
    expect(withLocal).toContain('http://127.0.0.1:54321')
    expect(withLocal).toContain('ws://127.0.0.1:54321')
  })
})
