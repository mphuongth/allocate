'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { toast } from 'sonner'
import { NavigationProvider, useNavigation } from '../navigation/NavigationContext'
import Sidebar from '../navigation/Sidebar'
import Header from '../navigation/Header'
import MobileDrawer from '../navigation/MobileDrawer'
import { PageTitle } from '../navigation/Breadcrumb'

function getInitials(email: string): string {
  const parts = email.split('@')[0].split(/[._-]/)
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2) || email[0]?.toUpperCase() || 'U'
}

interface AuthenticatedLayoutInnerProps {
  children: React.ReactNode
  email: string
  initials: string
}

function AuthenticatedLayoutInner({ children, email, initials }: AuthenticatedLayoutInnerProps) {
  const { sidebarCollapsed } = useNavigation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex shrink-0">
        <Sidebar email={email} initials={initials} />
      </div>

      {/* Tablet sidebar */}
      <div className="hidden md:flex lg:hidden shrink-0">
        <Sidebar email={email} initials={initials} />
      </div>

      {/* Mobile drawer */}
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        email={email}
        initials={initials}
      />

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header
          email={email}
          initials={initials}
          onMobileMenuToggle={() => setDrawerOpen(true)}
        />
        {/* Mobile page title */}
        <PageTitle />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/auth/login')
        return
      }
      setEmail(session.user.email ?? 'User')
      setReady(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session && event !== 'INITIAL_SESSION' && event !== 'SIGNED_OUT') {
        toast.error('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.', { duration: 5000 })
        router.push('/auth/login')
      }
    })

    return () => subscription.unsubscribe()
  }, [router])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-500 dark:text-gray-400">Đang tải...</span>
        </div>
      </div>
    )
  }

  const initials = getInitials(email)

  return (
    <NavigationProvider>
      <AuthenticatedLayoutInner email={email} initials={initials}>
        {children}
      </AuthenticatedLayoutInner>
    </NavigationProvider>
  )
}
