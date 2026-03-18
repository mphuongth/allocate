import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import SettingsClient from './SettingsClient'
import AuthenticatedLayout from '@/app/components/layouts/AuthenticatedLayout'

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <AuthenticatedLayout>
      <SettingsClient />
    </AuthenticatedLayout>
  )
}
