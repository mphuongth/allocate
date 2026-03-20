import { redirect } from 'next/navigation'

export default async function GoalDetailPage({ params }: { params: Promise<{ goalId: string }> }) {
  const { goalId } = await params
  redirect(`/settings?tab=goals&goal=${goalId}`)
}
