import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer'],
  turbopack: {
    root: __dirname,
  },
  async headers() {
    // The Content-Security-Policy is set per-request in middleware.ts (it needs a
    // fresh nonce each request); the static security headers live here.
    const securityHeaders = [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ]

    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // Always revalidate the worker script so new deploys are detected
        // promptly instead of being masked by the HTTP cache.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
      {
        source: '/favicon.ico',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/favicon-32.png',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
