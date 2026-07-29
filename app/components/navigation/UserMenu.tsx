'use client'

import { LogOut } from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { clearAppCaches } from '@/lib/clientCache'

export default function UserMenu() {
  const t = useTranslations('auth')
  const router = useRouter()

  async function handleLogout() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast.error(t('logoutFailed'), {
        action: { label: t('retryLabel'), onClick: handleLogout },
      })
    } else {
      // Drop this account's caches — localStorage snapshots and the service
      // worker's authenticated responses — before the next account can sign in.
      await clearAppCaches()
      toast.success(t('logoutSuccess'))
      router.push('/auth/login')
    }
  }

  return (
    <button
      onClick={handleLogout}
      aria-label={t('logoutLabel')}
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
    >
      <LogOut size={15} />
      <span className="hidden sm:inline">{t('logoutLabel')}</span>
    </button>
  )
}
