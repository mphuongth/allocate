import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

// Only the landing page is publicly reachable — every other route redirects an anonymous
// visitor to /auth/login. Saying so keeps crawlers from spending budget on URLs that can
// only ever answer a redirect, and keeps Search Console's coverage report honest.
//
// Note this file is useless on its own: proxy.ts's matcher has to exclude /robots.txt, or
// the auth middleware answers the crawler with a 307 to the login page (which is exactly
// what production was doing before).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/auth/', '/api/', '/dashboard', '/planning', '/funds', '/settings', '/assets'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
