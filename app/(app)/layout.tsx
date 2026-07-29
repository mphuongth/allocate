import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import AuthenticatedLayout from '@/app/components/layouts/AuthenticatedLayout'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const meta = user.user_metadata ?? {}
  const displayName = (meta.display_name || meta.full_name) as string | undefined

  return (
    <AuthenticatedLayout userId={user.id} email={user.email ?? ''} displayName={displayName}>
      {children}
    </AuthenticatedLayout>
  )
}
