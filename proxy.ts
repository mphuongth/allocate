import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { buildContentSecurityPolicy, localSupabaseConnectExtra } from '@/lib/csp'
import { safeNextPath } from '@/lib/nextPath'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Per-request CSP nonce, production only: `next dev`'s HMR / React Refresh uses
  // eval + inline scripts that a nonce policy would block, so dev is left CSP-free
  // (local-only). The nonce is stamped on the forwarded request headers so
  // Next.js nonces the scripts it emits and the root layout can nonce its inline
  // theme-bootstrap script (via `x-nonce`); it's set on every response too. The
  // static security headers (HSTS, nosniff, …) live in next.config.ts.
  const isProd = process.env.NODE_ENV === 'production'
  const nonce = isProd ? btoa(crypto.randomUUID()) : ''
  const csp = isProd
    ? buildContentSecurityPolicy(nonce, {
        connectExtra: localSupabaseConnectExtra(process.env.NEXT_PUBLIC_SUPABASE_URL),
      })
    : ''

  const requestHeaders = new Headers(request.headers)
  if (isProd) {
    requestHeaders.set('x-nonce', nonce)
    requestHeaders.set('content-security-policy', csp)
  }
  const withCsp = (res: NextResponse) => {
    if (isProd) res.headers.set('content-security-policy', csp)
    return res
  }

  // The two doors into the app. They are reachable signed out, but a visitor who
  // already has a session has no business being shown a sign-in form — so unlike
  // the rest of the public routes these still cost a getUser() below.
  const isAuthEntry = pathname === '/auth/login' || pathname === '/auth/signup'

  // Public routes (landing + the rest of the auth flow): no session gate, but
  // still nonce'd + CSP'd. /auth/callback in particular must run its code
  // exchange even when a session is already present, and /auth/auth-code-error
  // has to stay reachable to explain why one wasn't.
  if (pathname === '/' || (pathname.startsWith('/auth/') && !isAuthEntry)) {
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }))
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: requestHeaders } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (isAuthEntry) {
    // Signed out: the form is exactly what they came for.
    if (!user) return withCsp(response)
    // Signed in: refreshing /auth/login used to re-render the form forever,
    // because nothing on the server ever looked. `next` carries the page they
    // were on when a session ended, so honour it over the default landing.
    const target = safeNextPath(request.nextUrl.searchParams.get('next')) ?? '/dashboard'
    return withCsp(NextResponse.redirect(new URL(target, request.url)))
  }

  if (!user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/auth/login'
    return withCsp(NextResponse.redirect(loginUrl))
  }

  return withCsp(response)
}

export const config = {
  // Skip `/api/*`: every route handler authenticates itself (user session or
  // CRON_SECRET) and can refresh the session cookie on its own, so running the
  // middleware there only adds a redundant getUser() round-trip to Supabase
  // Auth on each data fetch — and would wrongly redirect unauthenticated API
  // calls to the login HTML instead of returning a 401.
  // `robots.txt` and `sitemap.xml` are excluded for the same reason as sw.js and the
  // manifest: they are files for machines, not routes for people. Without them here the
  // middleware answered every crawler with a 307 to /auth/login, so the files were
  // unreachable in production no matter what app/robots.ts emitted.
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|~offline|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
