import SettingsClient from './SettingsClient'
import { getTranslations } from 'next-intl/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav')
  return { title: t('settings') }
}

function getInitials(email: string): string {
  const parts = email.split('@')[0].split(/[._-]/)
  return parts
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2) || email[0]?.toUpperCase() || 'U'
}

function getDisplayName(email: string, userMetaName?: string): string {
  if (userMetaName) return userMetaName
  const localPart = email.split('@')[0]
  const firstName = localPart.split(/[._-]/)[0]
  return firstName.charAt(0).toUpperCase() + firstName.slice(1)
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const email = user?.email ?? ''

  return (
    <SettingsClient
      initialTab={tab}
      email={email}
      initials={getInitials(email)}
      displayName={getDisplayName(email, user?.user_metadata?.display_name)}
    />
  )
}
