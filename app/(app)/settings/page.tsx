import SettingsClient from './SettingsClient'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; goal?: string }>
}) {
  const { tab, goal } = await searchParams

  return <SettingsClient initialTab={tab} initialGoalId={goal} />
}
