import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/sessionUser'
import DashboardClient from '@/app/assets/DashboardClient'
import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav')
  return { title: t('dashboard') }
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/auth/login')
  return <DashboardClient userId={user.id} />
}
