import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

// One entry, deliberately. The landing page is the whole public surface; the signed-in
// screens redirect to /auth/login, and the auth pages are disallowed in robots.ts, so
// listing any of them would just feed Search Console redirect warnings.
//
// Both languages live at the same URL — the locale comes from a cookie (i18n/request.ts),
// not the path — so the alternates point at `/` and simply tell crawlers the page is
// available in either language.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      changeFrequency: 'weekly',
      priority: 1,
      alternates: {
        languages: { vi: `${SITE_URL}/`, en: `${SITE_URL}/` },
      },
    },
  ]
}
