import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard',
    name: 'Cairn',
    short_name: 'Cairn',
    description: 'Personal finance, one stone at a time. Plan, track, and grow toward every goal.',
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
