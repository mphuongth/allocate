'use client'

import { LogOut } from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export default function UserMenu() {
  const router = useRouter()

  async function handleLogout() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast.error('Đăng xuất thất bại. Vui lòng thử lại.', {
        action: { label: 'Thử lại', onClick: handleLogout },
      })
    } else {
      // Clear all page caches on logout
      Object.keys(localStorage)
        .filter(k => k.startsWith('dashboardOverviewCache') || k.startsWith('planningCache_') || k.startsWith('savingsGoalsCache') || k.startsWith('fixedExpensesCache') || k.startsWith('insuranceMembersCache') || k.startsWith('fundLibraryCache'))
        .forEach(k => localStorage.removeItem(k))
      toast.success('Đã đăng xuất thành công')
      router.push('/auth/login')
    }
  }

  return (
    <button
      onClick={handleLogout}
      aria-label="Đăng xuất"
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
    >
      <LogOut size={15} />
      <span className="hidden sm:inline">Đăng xuất</span>
    </button>
  )
}
