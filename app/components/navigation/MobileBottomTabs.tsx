'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Mountain, Calendar, TrendingUp, Settings } from 'lucide-react'
import { useTranslations } from 'next-intl'

const TABS = [
  { href: '/dashboard', icon: Mountain,   key: 'dashboard' },
  { href: '/planning',  icon: Calendar,   key: 'planning'  },
  { href: '/funds',     icon: TrendingUp, key: 'funds'     },
  { href: '/settings',  icon: Settings,   key: 'settings'  },
] as const

export default function MobileBottomTabs() {
  const pathname = usePathname()
  const t = useTranslations('nav')

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden"
      style={{
        background: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'saturate(140%) blur(16px)',
        WebkitBackdropFilter: 'saturate(140%) blur(16px)',
        borderTop: '1px solid var(--c-line)',
        paddingBottom: 'env(safe-area-inset-bottom, 0)',
      }}
    >
      <div className="dark:bg-gray-900/90 dark:border-gray-700/80" style={{ borderTop: 'inherit', background: 'inherit' }}>
        <div className="grid grid-cols-4 px-1 py-1.5">
          {TABS.map(({ href, icon: Icon, key }) => {
            const isActive = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center gap-0.5 py-2 rounded-xl transition-colors"
                style={{
                  color: isActive ? 'var(--c-navy)' : 'var(--c-muted)',
                }}
              >
                <Icon size={22} strokeWidth={isActive ? 2.2 : 1.6} />
                <span
                  style={{
                    fontSize: '10.5px',
                    fontWeight: isActive ? 600 : 500,
                    letterSpacing: '0.01em',
                    lineHeight: 1,
                  }}
                >
                  {t(key)}
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
