import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import DashboardClient from './DashboardClient'
import AuthenticatedLayout from '@/app/components/layouts/AuthenticatedLayout'

export default async function AssetsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <AuthenticatedLayout>
      <DashboardClient />
    </AuthenticatedLayout>
  )
}
