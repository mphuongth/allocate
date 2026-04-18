import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard',
    name: 'Allocate',
    short_name: 'Allocate',
    description: 'Personal finance allocation manager',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f9fafb',
    theme_color: '#7c3aed',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [
      { src: '/screenshot-mobile.png', sizes: '390x844', type: 'image/png' },
      { src: '/screenshot-desktop.png', sizes: '1280x800', type: 'image/png', form_factor: 'wide' },
    ],
  }
}
