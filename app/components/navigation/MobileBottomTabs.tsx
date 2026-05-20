'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Calendar, TrendingUp, Settings } from 'lucide-react'
import { useTranslations } from 'next-intl'

function CairnNavIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ display: 'block', flexShrink: 0 }}>
      <path d="M12 3l6.5 11H5.5z" fill="currentColor" />
      <path d="M12 10.5l4.5 7H7.5z" fill="currentColor" opacity="0.55" />
      <path d="M12 16.5l2.5 4H9.5z" fill="currentColor" opacity="0.3" />
    </svg>
  )
}

type TabDef = {
  href: string
  key: 'dashboard' | 'planning' | 'funds' | 'settings'
  renderIcon: (active: boolean) => React.ReactNode
}

const TABS: TabDef[] = [
  {
    href: '/dashboard',
    key: 'dashboard',
    renderIcon: (_active) => <CairnNavIcon size={22} />,
  },
  {
    href: '/planning',
    key: 'planning',
    renderIcon: (active) => <Calendar size={22} strokeWidth={active ? 2.2 : 1.6} />,
  },
  {
    href: '/funds',
    key: 'funds',
    renderIcon: (active) => <TrendingUp size={22} strokeWidth={active ? 2.2 : 1.6} />,
  },
  {
    href: '/settings',
    key: 'settings',
    renderIcon: (active) => <Settings size={22} strokeWidth={active ? 2.2 : 1.6} />,
  },
]

export default function MobileBottomTabs() {
  const pathname = usePathname()
  const t = useTranslations('nav')

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden"
      style={{
        background: 'var(--c-tab-bg)',
        backdropFilter: 'saturate(140%) blur(16px)',
        WebkitBackdropFilter: 'saturate(140%) blur(16px)',
        borderTop: '1px solid var(--c-line)',
        paddingBottom: 'env(safe-area-inset-bottom, 0)',
      }}
    >
      <div className="grid grid-cols-4 px-1 py-1.5">
        {TABS.map(({ href, key, renderIcon }) => {
          const isActive = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-0.5 py-2 rounded-xl transition-colors"
              style={{ color: isActive ? 'var(--c-navy)' : 'var(--c-muted)' }}
            >
              {renderIcon(isActive)}
              <span style={{ fontSize: '10.5px', fontWeight: isActive ? 600 : 500, letterSpacing: '0.01em', lineHeight: 1 }}>
                {t(key)}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
