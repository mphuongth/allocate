import SettingsClient from './SettingsClient'
import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav')
  return { title: t('settings') }
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; goal?: string }>
}) {
  const { tab, goal } = await searchParams

  return <SettingsClient initialTab={tab} initialGoalId={goal} />
}
