import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Via /auth/complete, not straight to /dashboard: this is a server
      // redirect, so nothing has told the service worker the account changed.
      // A dashboard navigation made while a previous account still owns the
      // caches can be answered from their cached HTML, which re-asserts their
      // ownership before anything corrects it (#565). /auth/complete hands
      // ownership over first and has no cached entry of its own.
      return NextResponse.redirect(`${origin}/auth/complete`)
    }
  }

  // Code exchange failed (or no code was returned). Navigate with a plain
  // server-side redirect to a dedicated error page rather than returning raw
  // HTML with an inline <script> redirect: production CSP is nonce-based
  // (`script-src` has no 'unsafe-inline'), so that script was blocked and the
  // user got stuck on the error page. The error page carries a normal link back
  // to login, so it works with JavaScript fully disabled too (#516).
  return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
