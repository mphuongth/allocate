import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer'],
  turbopack: {
    root: __dirname,
  },
  async headers() {
    // Permissive CSP baseline that doesn't break Supabase realtime, Google
    // Fonts, or Next.js inline runtime scripts. Tightening to a nonce-based
    // policy is a future follow-up.

    // When pointed at a local Supabase stack (E2E against `supabase start`),
    // allow that origin in connect-src — otherwise the browser blocks all
    // auth/data fetches. Only added for http://localhost|127.0.0.1 URLs, so
    // the production CSP (https://*.supabase.co only) is unaffected.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const localSupabase = /^http:\/\/(127\.0\.0\.1|localhost)/.test(supabaseUrl)
      ? ` ${supabaseUrl} ${supabaseUrl.replace(/^http/, 'ws')}`
      : ''

    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co${localSupabase}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')

    const securityHeaders = [
      { key: 'Content-Security-Policy', value: csp },
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
