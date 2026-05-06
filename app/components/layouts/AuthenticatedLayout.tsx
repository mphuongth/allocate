'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { toast } from 'sonner'
import { NavigationProvider } from '../navigation/NavigationContext'
import Sidebar from '../navigation/Sidebar'
import Header from '../navigation/Header'
import MobileBottomTabs from '../navigation/MobileBottomTabs'
import { PageTitle } from '../navigation/Breadcrumb'
import OfflineBanner from '@/app/components/OfflineBanner'

function getInitials(email: string): string {
  const parts = email.split('@')[0].split(/[._-]/)
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2) || email[0]?.toUpperCase() || 'U'
}

function AuthenticatedLayoutInner({ children, email, initials }: { children: React.ReactNode; email: string; initials: string }) {
  return (
    <div className="flex h-screen bg-canvas dark:bg-gray-950 overflow-hidden">
      {/* Sidebar (tablet + desktop only) */}
      <div className="hidden md:flex shrink-0">
        <Sidebar email={email} initials={initials} />
      </div>

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header />
        {/* Mobile page title */}
        <PageTitle />
        <main className="flex-1 overflow-y-auto px-4 md:px-6 py-4 pb-20 md:pb-4">
          {children}
        </main>
      </div>

      {/* Mobile bottom tab navigation */}
      <MobileBottomTabs />
      <OfflineBanner />
    </div>
  )
}

export default function AuthenticatedLayout({ children, email }: { children: React.ReactNode; email: string }) {
  const router = useRouter()

  // Watch for session expiry (e.g. token revoked or expired)
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session && event !== 'INITIAL_SESSION' && event !== 'SIGNED_OUT') {
        toast.error('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.', { duration: 5000 })
        router.push('/auth/login')
      }
    })

    return () => subscription.unsubscribe()
  }, [router])

  const initials = getInitials(email)

  return (
    <NavigationProvider>
      <AuthenticatedLayoutInner email={email} initials={initials}>
        {children}
      </AuthenticatedLayoutInner>
    </NavigationProvider>
  )
}
