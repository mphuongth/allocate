import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import PlanningClient from './PlanningClient'
import AuthenticatedLayout from '@/app/components/layouts/AuthenticatedLayout'

export default async function PlanningPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <AuthenticatedLayout>
      <PlanningClient />
    </AuthenticatedLayout>
  )
}
