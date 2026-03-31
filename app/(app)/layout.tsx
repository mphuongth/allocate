import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import AuthenticatedLayout from '@/app/components/layouts/AuthenticatedLayout'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getLocale } from 'next-intl/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const messages = await getMessages()
  const locale = await getLocale()

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <AuthenticatedLayout email={user.email ?? ''}>
        {children}
      </AuthenticatedLayout>
    </NextIntlClientProvider>
  )
}
