import { redirect } from 'next/navigation'
import dynamic from 'next/dynamic'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import AuthenticatedLayout from '@/app/components/layouts/AuthenticatedLayout'

const ChatWidget = dynamic(() => import('@/components/ChatWidget'), { ssr: false })

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <AuthenticatedLayout email={user.email ?? ''}>
      {children}
      <ChatWidget />
    </AuthenticatedLayout>
  )
}
