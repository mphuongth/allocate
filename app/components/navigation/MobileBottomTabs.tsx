'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Calendar, TrendingUp, Settings, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMaturingDepositsCount } from './useMaturingDepositsCount'

function MountainsIcon({ size = 22, strokeWidth = 1.75 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}>
      <path d="M3 19h18l-6-9-3 4-2-3z" />
      <circle cx="8" cy="7" r="1.5" />
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
    renderIcon: (active) => <MountainsIcon size={22} strokeWidth={active ? 2.2 : 1.6} />,
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

export default function MobileBottomTabs({ onAdd }: { onAdd: () => void }) {
  const pathname = usePathname()
  const t = useTranslations('nav')
  const maturingCount = useMaturingDepositsCount()

  const renderTab = ({ href, key, renderIcon }: TabDef) => {
    const isActive = pathname.startsWith(href)
    const badge = key === 'dashboard' && maturingCount > 0 ? maturingCount : 0
    return (
      <Link
        key={href}
        href={href}
        className="relative flex flex-col items-center gap-0.5 py-2 rounded-xl transition-colors"
        style={{ color: isActive ? 'var(--c-navy)' : 'var(--c-muted)' }}
      >
        {badge > 0 && (
          <span
            data-testid="nav-maturity-badge"
            aria-label={`${badge} ${t('dashboard')}`}
            style={{
              position: 'absolute', top: 2, right: '50%', marginRight: -18,
              minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999,
              background: 'var(--c-warn)', color: '#fff', fontSize: 9.5, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
            }}
          >
            {badge}
          </span>
        )}
        {renderIcon(isActive)}
        <span style={{ fontSize: '10.5px', fontWeight: isActive ? 600 : 500, letterSpacing: '0.01em', lineHeight: 1 }}>
          {t(key)}
        </span>
      </Link>
    )
  }

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
      {/* 2 tabs · center add · 2 tabs. The add action lives in the fixed nav (not a
          floating FAB) so it's consistent on every page and can never cover the
          Overview "Cần xử lý" card's action button (#447 follow-up). */}
      <div className="grid grid-cols-5 items-center px-1 py-1.5">
        {TABS.slice(0, 2).map(renderTab)}
        <div className="flex justify-center">
          <button
            onClick={onAdd}
            aria-label="Add transaction"
            className="flex items-center justify-center"
            style={{
              width: 48, height: 48, borderRadius: 24,
              marginTop: -24, // lift half the circle proud of the bar for prominence
              background: 'var(--c-btn-primary)', color: '#fff', border: '3px solid var(--c-tab-bg)',
              boxShadow: '0 6px 16px rgba(15, 42, 74, 0.30)',
              cursor: 'pointer',
            }}
          >
            <Plus size={24} strokeWidth={2.4} />
          </button>
        </div>
        {TABS.slice(2).map(renderTab)}
      </div>
    </nav>
  )
}
