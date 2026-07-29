import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import AuthenticatedLayout from '@/app/components/layouts/AuthenticatedLayout'
import { buildCacheOwnerScript } from '@/lib/clientCache'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const meta = user.user_metadata ?? {}
  const displayName = (meta.display_name || meta.full_name) as string | undefined
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
      <AuthenticatedLayout userId={user.id} email={user.email ?? ''} displayName={displayName}>
        {children}
      </AuthenticatedLayout>
    </>
  )
}
