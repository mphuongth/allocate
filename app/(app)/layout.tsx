import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/sessionUser'
import AuthenticatedLayout from '@/components/layout/AuthenticatedLayout'
import AddTransactionOverlay from './AddTransactionOverlay'
import { buildCacheOwnerScript } from '@/lib/clientCache'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient()
  // Read from the signed token (lib/sessionUser) — the proxy has already let
  // this request through on the same check, and asking Supabase Auth again here
  // only added a network round-trip ahead of the first byte of HTML.
  const user = await getSessionUser(supabase)
  if (!user) redirect('/auth/login')
  // Per-request CSP nonce set by middleware; undefined in dev, where React omits
  // the attribute and the inline script runs unrestricted.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <>
      {/* Claims the service worker's cache ownership for this account while the
          HTML is still parsing — ahead of hydration and of any data fetch, and
          on entries that no client code precedes, such as the email-confirmation
          callback redirecting straight here. CacheOwnerAnnouncer below keeps
          handling every later auth-state change. */}
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: buildCacheOwnerScript(user.id) }} />
      <AuthenticatedLayout
        userId={user.id}
        email={user.email}
        displayName={user.displayName}
        overlays={<AddTransactionOverlay />}
      >
        {children}
      </AuthenticatedLayout>
    </>
  )
}
