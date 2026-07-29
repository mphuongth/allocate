'use client'

import { useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { announceCacheOwner } from '@/lib/clientCache'

/**
 * Keeps the service worker's authenticated caches attached to the account that
 * owns them (#565).
 *
 * Mounted inside the authenticated layout, so it fires on every app load
 * (`INITIAL_SESSION`) and on every later auth-state change. The worker wipes its
 * `api-v1-*` / `pages-*` caches whenever the announced id differs from the one
 * it recorded — which is what covers the flow sign-out cleanup cannot: a session
 * that expires and is replaced by a different account without any sign-out.
 */
export default function CacheOwnerAnnouncer() {
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id
      // No session means signed out or expired; the sign-out path clears the
      // caches, and the worker refuses to serve them with no owner recorded.
      if (userId) void announceCacheOwner(userId)
    })

    return () => subscription.unsubscribe()
  }, [])

  return null
}
