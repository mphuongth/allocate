'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { NavigationProvider, useNavigation } from '../navigation/NavigationContext'
import Sidebar from '../navigation/Sidebar'
import Header from '../navigation/Header'
import MobileBottomTabs from '../navigation/MobileBottomTabs'
import MobileTopBar from '../navigation/MobileTopBar'
import OfflineBanner from '@/app/components/OfflineBanner'
import AddTransactionSheet from '@/app/assets/components/AddTransactionSheet'

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

// Pages that provide their own desktop top bar and don't need the shared Header.
// Checked synchronously via usePathname so there is no flash on hard refresh.
const PAGES_WITH_OWN_HEADER = new Set(['/dashboard', '/planning'])

// Pages that manage their own full-height desktop layout (no <main> padding/scroll on md+).
const PAGES_WITH_FULL_HEIGHT_DESKTOP = new Set(['/planning', '/funds'])

function AuthenticatedLayoutInner({ children, email, initials }: { children: React.ReactNode; email: string; initials: string }) {
  const { mobileTopBar } = useNavigation()
  const [showAddTx, setShowAddTx] = useState(false)
  const pathname = usePathname()
  const hideDesktopHeader = PAGES_WITH_OWN_HEADER.has(pathname)
  const isFullHeightDesktop = PAGES_WITH_FULL_HEIGHT_DESKTOP.has(pathname)

  return (
    <div className="flex h-screen bg-canvas dark:bg-gray-950 overflow-hidden">
      {/* Sidebar (tablet + desktop only) */}
      <div className="hidden md:flex shrink-0">
        <Sidebar email={email} initials={initials} />
      </div>

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Desktop header — hidden for pages that provide their own DTopBar */}
        {!hideDesktopHeader && (
          <div className="hidden md:block">
            <Header />
          </div>
        )}
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
        <main className={`flex-1 overflow-y-auto px-4 py-4 pb-20 md:pb-4${isFullHeightDesktop ? ' md:p-0 md:overflow-hidden md:flex md:flex-col' : ' md:px-6'}`}>
          {children}
        </main>
      </div>

      {/* Mobile FAB — add transaction */}
      <button
        onClick={() => setShowAddTx(true)}
        aria-label="Add transaction"
        className="md:hidden"
        style={{
          position: 'fixed', right: 16, bottom: 80,
          width: 52, height: 52, borderRadius: 26,
          background: 'var(--c-navy)', color: '#fff',
          border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 16px rgba(15, 42, 74, 0.25), 0 2px 4px rgba(15, 42, 74, 0.1)',
          cursor: 'pointer', zIndex: 35,
        }}
      >
        <Plus size={22} strokeWidth={2.2} />
      </button>

      {/* Mobile bottom tab navigation */}
      <MobileBottomTabs />
      <OfflineBanner />

      {/* Add transaction sheet */}
      <AddTransactionSheet
        open={showAddTx}
        onClose={() => setShowAddTx(false)}
      />
    </div>
  )
}

export default function AuthenticatedLayout({ children, email, displayName }: { children: React.ReactNode; email: string; displayName?: string }) {
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
  const userName = displayName || getDisplayName(email)

  return (
    <NavigationProvider userName={userName}>
      <AuthenticatedLayoutInner email={email} initials={initials}>
        {children}
      </AuthenticatedLayoutInner>
    </NavigationProvider>
  )
}
