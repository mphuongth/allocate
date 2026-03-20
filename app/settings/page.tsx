import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import SettingsClient from './SettingsClient'
import AuthenticatedLayout from '@/app/components/layouts/AuthenticatedLayout'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; goal?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { tab, goal } = await searchParams

  return (
    <AuthenticatedLayout>
      <SettingsClient initialTab={tab} initialGoalId={goal} />
    </AuthenticatedLayout>
  )
}
