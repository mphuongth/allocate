import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import AuthenticatedLayout from '@/app/components/layouts/AuthenticatedLayout'
import GoalDetailClient from './GoalDetailClient'

export default async function GoalDetailPage({ params }: { params: Promise<{ goalId: string }> }) {
  const { goalId } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <AuthenticatedLayout>
      <GoalDetailClient goalId={goalId} />
    </AuthenticatedLayout>
  )
}
