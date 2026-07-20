import type { MetadataRoute } from 'next'
import { getTranslations } from 'next-intl/server'

// The install prompt is the only place this copy is user-facing, and it was English-only
// on a Vietnamese-by-default app — so tapping "Add to home screen" pitched the app in a
// language the user may not read. Reading the locale makes this route dynamic, which is
// fine: it is excluded from the auth middleware (see proxy.ts) and is fetched once per
// install prompt, not per page view. Everything the prompt depends on structurally —
// name, start_url, display, icons, screenshots — stays static.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations('meta')

  return {
    id: '/dashboard',
    name: 'Cairn',
    short_name: 'Cairn',
    description: t('description'),
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0F2A4A',
    theme_color: '#0F2A4A',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png?v=3', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png?v=3', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png?v=3', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [
      { src: '/screenshot-mobile.png', sizes: '390x844', type: 'image/png' },
      { src: '/screenshot-desktop.png', sizes: '1280x800', type: 'image/png', form_factor: 'wide' },
    ],
  }
}
