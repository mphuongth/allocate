import { describe, it, expect } from 'vitest'
import { config } from '../proxy'

// The middleware matcher is a Next.js path pattern that is, in practice, a
// regular expression. Reconstruct it to assert which paths the middleware runs
// on. The behavioural contract we care about: API routes (which authenticate
// themselves) must NOT trigger the middleware's getUser(), while page
// navigations still must.
function middlewareRunsOn(path: string): boolean {
  const pattern = config.matcher[0]
  return new RegExp(`^${pattern}$`).test(path)
}

describe('proxy (middleware) matcher', () => {
  it('does NOT run on API routes — they self-authenticate, so a middleware getUser() is redundant', () => {
    expect(middlewareRunsOn('/api/v1/dashboard/overview')).toBe(false)
    expect(middlewareRunsOn('/api/v1/funds')).toBe(false)
    expect(middlewareRunsOn('/api/cron/refresh-navs')).toBe(false)
  })

  it('still runs on app page navigations (needs session refresh + login redirect)', () => {
    expect(middlewareRunsOn('/dashboard')).toBe(true)
    expect(middlewareRunsOn('/planning')).toBe(true)
    expect(middlewareRunsOn('/settings')).toBe(true)
  })

  it('still skips static assets, the service worker, and the offline page', () => {
    expect(middlewareRunsOn('/_next/static/chunk.js')).toBe(false)
    expect(middlewareRunsOn('/sw.js')).toBe(false)
    expect(middlewareRunsOn('/~offline')).toBe(false)
    expect(middlewareRunsOn('/icon.png')).toBe(false)
  })
})
