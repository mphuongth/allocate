import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/' || pathname.startsWith('/auth/')) {
    return NextResponse.next()
  }

  let response = NextResponse.next()

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
          response = NextResponse.next({ request })
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
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  // Skip `/api/*`: every route handler authenticates itself (user session or
  // CRON_SECRET) and can refresh the session cookie on its own, so running the
  // middleware there only adds a redundant getUser() round-trip to Supabase
  // Auth on each data fetch — and would wrongly redirect unauthenticated API
  // calls to the login HTML instead of returning a 401.
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.webmanifest|~offline|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
