'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { toast } from 'sonner'
import { NavigationProvider, useNavigation } from '../navigation/NavigationContext'
import Sidebar from '../navigation/Sidebar'
import Header from '../navigation/Header'
import MobileBottomTabs from '../navigation/MobileBottomTabs'
import MobileTopBar from '../navigation/MobileTopBar'
import OfflineBanner from '@/app/components/OfflineBanner'

function getInitials(email: string): string {
  const parts = email.split('@')[0].split(/[._-]/)
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2) || email[0]?.toUpperCase() || 'U'
}

function getDisplayName(email: string): string {
  const localPart = email.split('@')[0]
  const firstName = localPart.split(/[._-]/)[0]
  return firstName.charAt(0).toUpperCase() + firstName.slice(1)
}

function AuthenticatedLayoutInner({ children, email, initials }: { children: React.ReactNode; email: string; initials: string }) {
  const { mobileTopBar } = useNavigation()

  return (
    <div className="flex h-screen bg-canvas dark:bg-gray-950 overflow-hidden">
      {/* Sidebar (tablet + desktop only) */}
      <div className="hidden md:flex shrink-0">
        <Sidebar email={email} initials={initials} />
      </div>

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Desktop header */}
        <div className="hidden md:block">
          <Header />
        </div>
        {/* Mobile top bar — lives outside <main> so it never scrolls away */}
        {mobileTopBar.title && (
          <div className="md:hidden">
            <MobileTopBar
              title={mobileTopBar.title}
              subtitle={mobileTopBar.subtitle}
              trailing={mobileTopBar.trailing}
              dense={mobileTopBar.dense}
            />
          </div>
        )}
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
  const userName = getDisplayName(email)

  return (
    <NavigationProvider userName={userName}>
      <AuthenticatedLayoutInner email={email} initials={initials}>
        {children}
      </AuthenticatedLayoutInner>
    </NavigationProvider>
  )
}
