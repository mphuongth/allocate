import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { buildContentSecurityPolicy, localSupabaseConnectExtra } from '@/lib/csp'

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

  // Public routes (landing + auth): no session gate, but still nonce'd + CSP'd.
  if (pathname === '/' || pathname.startsWith('/auth/')) {
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
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.webmanifest|~offline|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
