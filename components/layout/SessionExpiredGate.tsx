'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useTranslations } from 'next-intl'
import DialogShell from '@/components/ui/DialogShell'
import { reportSessionExpired, useSessionExpired, watchApiUnauthorized } from '@/lib/sessionExpiry'

/**
 * The one place the app answers "your session ended" (#719).
 *
 * Two tabs share one cookie jar, so a sign-out in one ends the session in all of
 * them. The other tabs used to notice nothing: they kept rendering stale data
 * until a fetch came back 401, which every sheet turns into an inline "couldn't
 * load data — try again" — the wrong cause, and a retry that can only 401 again.
 *
 * A blocking dialog rather than an immediate redirect: being thrown to the login
 * page mid-sentence would swallow whatever the user had typed into an open sheet,
 * and it hides where they were. The screen behind stays visible and untouchable;
 * leaving is the user's own click.
 */
export default function SessionExpiredGate() {
  const t = useTranslations('auth')
  const expired = useSessionExpired()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => watchApiUnauthorized(), [])

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Every event that leaves this tab without a session counts — a sign-out
      // broadcast from a sibling tab, a revoked token, a refresh that failed.
      // INITIAL_SESSION is the exception: a null there is the client saying it
      // has not read the cookie yet, on a page the server only rendered because
      // the session was good.
      if (!session && event !== 'INITIAL_SESSION') reportSessionExpired()
    })

    return () => subscription.unsubscribe()
  }, [])

  if (!expired) return null

  const query = searchParams.toString()
  const next = encodeURIComponent(pathname + (query ? `?${query}` : ''))

  return (
    <DialogShell
      // Not dismissible in any of the three ways: there is nothing behind this
      // dialog the user can still do, and a stray Escape would only put them
      // back in front of data that is no longer theirs to act on.
      onClose={() => {}}
      dismissOnClickAway={false}
      labelledBy="session-expired-title"
      panelStyle={{
        background: 'var(--c-card)', borderRadius: 14, padding: '24px 22px',
        width: 'min(380px, calc(100vw - 32px))', display: 'grid', gap: 12,
        boxShadow: '0 12px 40px rgba(15,23,42,0.18)',
      }}
      panelProps={{ 'data-testid': 'session-expired-dialog' }}
    >
      <h2 id="session-expired-title" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--c-ink)' }}>
        {t('sessionEndedTitle')}
      </h2>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--c-muted)' }}>
        {t('sessionEndedBody')}
      </p>
      {/* An anchor, not a router push: signing back in has to start from a clean
          document so the server re-reads the cookies and no in-memory data from
          the ended session survives the transition. */}
      <a
        href={`/auth/login?expired=true&next=${next}`}
        data-testid="session-expired-sign-in"
        style={{
          marginTop: 4, padding: '10px 16px', borderRadius: 9, textAlign: 'center',
          background: 'var(--c-ink)', color: 'var(--c-card)',
          fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
        }}
      >
        {t('signInAgain')}
      </a>
    </DialogShell>
  )
}
