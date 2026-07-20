import { describe, it, expect } from 'vitest'
import robots from '../robots'
import sitemap from '../sitemap'
import { SITE_URL } from '@/lib/seo'

// The app had neither file, and the two URLs answered 307 → /auth/login (see the matcher
// tests in lib/__tests__/seo.test.ts). Only the landing page is publicly reachable —
// everything else redirects to login — so the crawl surface is deliberately tiny, and
// saying so explicitly keeps crawlers off routes that can only ever answer a redirect.

describe('robots.txt', () => {
  const rules = Array.isArray(robots().rules) ? robots().rules as Array<{ userAgent?: string; allow?: string | string[]; disallow?: string | string[] }> : [robots().rules as { allow?: string | string[]; disallow?: string | string[] }]
  const disallow = rules.flatMap(r => (Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : []))

  it('lets crawlers have the landing page', () => {
    const allow = rules.flatMap(r => (Array.isArray(r.allow) ? r.allow : r.allow ? [r.allow] : []))
    expect(allow).toContain('/')
  })

  it('keeps crawlers off the signed-in app, which can only answer a redirect', () => {
    for (const path of ['/dashboard', '/planning', '/funds', '/settings']) {
      expect(disallow.some(d => path.startsWith(d.replace(/\/$/, '')))).toBe(true)
    }
  })

  it('keeps crawlers off the auth pages and the API', () => {
    expect(disallow.some(d => d.startsWith('/auth'))).toBe(true)
    expect(disallow.some(d => d.startsWith('/api'))).toBe(true)
  })

  it('points at the sitemap with an absolute URL', () => {
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`)
  })
})

describe('sitemap.xml', () => {
  it('lists the landing page', () => {
    expect(sitemap().map(e => e.url)).toContain(`${SITE_URL}/`)
  })

  it('lists only what a crawler can actually fetch', () => {
    // Every other route redirects to /auth/login, so advertising them would just feed
    // Search Console a pile of redirect warnings.
    expect(sitemap()).toHaveLength(1)
  })

  it('offers both language variants of the landing page', () => {
    const entry = sitemap()[0]
    expect(Object.keys(entry.alternates?.languages ?? {})).toEqual(expect.arrayContaining(['vi', 'en']))
  })
})
