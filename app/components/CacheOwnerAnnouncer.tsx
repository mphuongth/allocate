'use client'

import { useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { announceCacheOwner, clearAppCaches } from '@/lib/clientCache'

/**
 * Keeps the service worker's authenticated caches attached to the account that
 * owns them (#565).
 *
 * Mounted inside the authenticated layout, so it announces on every app load and
 * on every later auth-state change. The worker wipes its `api-v1-*` / `pages-*`
 * caches whenever the announced id differs from the one it recorded — which is
 * what covers the flows sign-out cleanup cannot reach:
 *
 *   • a session that expires and is replaced by a different account, and
 *   • a session that simply disappears (failed token refresh, revoked token),
 *     where no sign-out handler ever runs to clear anything.
 *
 * `userId` comes from the server component that already resolved the session to
 * render this layout, so the first announcement doesn't wait on Supabase's own
 * auth-state round trip — child effects run before this one, so the page's data
 * fetches would otherwise start against caches still owned by the last account.
 */
export default function CacheOwnerAnnouncer({ userId }: { userId: string }) {
  useEffect(() => {
    void announceCacheOwner(userId)
  }, [userId])

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id
      // No session: nothing here is attributable any more, so drop it all rather
      // than leave the worker holding an owner it can still serve cache for.
      if (id) void announceCacheOwner(id)
      else void clearAppCaches()
    })

    return () => subscription.unsubscribe()
  }, [])

  return null
}
